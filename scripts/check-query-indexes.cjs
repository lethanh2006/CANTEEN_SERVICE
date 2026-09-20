// Chạy trên container MongoDB tạm; không đọc MONGO_URL hay dữ liệu ứng dụng.
require('reflect-metadata');
require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const mongoose = require('mongoose');
const { OrderSchema } = require('../src/schemas/orders.schema');
const { TableSchema } = require('../src/schemas/tables.schema');
const { OrderCounterSchema } = require('../src/schemas/order-counter.schema');
const {
  OrderSettlementService,
} = require('../src/modules/order/order-settlement.service');
const { MenuItemSchema } = require('../src/schemas/menu_items.schema');
const { CategorySchema } = require('../src/schemas/categories.schema');
const { MenuService } = require('../src/modules/menu/menu.service');
const { OrderService } = require('../src/modules/order/order.service');

const docker = (...args) =>
  execFileSync('docker', args, { encoding: 'utf8' }).trim();
let container;
let connection;

function summarize(explain) {
  const stages = new Set();
  const indexes = new Set();
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.stage) stages.add(node.stage);
    if (node.indexName) indexes.add(node.indexName);
    for (const value of Object.values(node)) visit(value);
  }
  visit(explain.queryPlanner.winningPlan);
  return {
    returned: explain.executionStats.nReturned,
    docs: explain.executionStats.totalDocsExamined,
    keys: explain.executionStats.totalKeysExamined,
    stages: [...stages],
    indexes: [...indexes],
  };
}

async function main() {
  try {
    container = docker(
      'run',
      '-d',
      '-p',
      '127.0.0.1::27017',
      'mongo:7.0',
      '--bind_ip_all',
      '--wiredTigerCacheSizeGB',
      '0.25',
      '--quiet',
    );
    const address = docker('port', container, '27017/tcp');
    assert.match(address, /^127\.0\.0\.1:\d+$/);
    connection = mongoose.createConnection(`mongodb://${address}/index_check`, {
      autoIndex: false,
      serverSelectionTimeoutMS: 20_000,
    });
    await connection.asPromise();
    const Order = connection.model('Order', OrderSchema);
    const Table = connection.model('Table', TableSchema);
    const Counter = connection.model('OrderCounter', OrderCounterSchema);
    const MenuItem = connection.model('MenuItem', MenuItemSchema);
    const Category = connection.model('Category', CategorySchema);
    const models = [Order, MenuItem, Category, Table, Counter];
    const objectIds = (count) =>
      Array.from({ length: count }, () => new mongoose.Types.ObjectId());
    const users = objectIds(1_000);
    const tables = objectIds(200);
    const categories = objectIds(40);
    const menuIds = objectIds(800);
    const now = new Date('2030-01-01T00:00:00Z');
    const orders = Array.from({ length: 20_000 }, (_, i) => ({
      _id: new mongoose.Types.ObjectId(),
      orderNumber: `#${1001 + i}`,
      userId: users[i % users.length],
      tableId: tables[i % tables.length],
      status: i % 100 < 4 ? 'CREATED' : 'COMPLETED',
      paymentStatus: i % 100 < 4 ? 'PENDING' : 'PAID',
      createdAt: new Date(now.getTime() + Math.floor(i / 4) * 60_000),
      items: [
        {
          menuItemId: menuIds[i % menuIds.length],
          name: 'Cơm',
          quantity: 1,
          unitPrice: 30_000,
        },
      ],
      totalAmount: 30_000,
      finalAmount: 30_000,
    }));
    await Order.collection.insertMany(orders);
    await Category.collection.insertMany(
      categories.map((_id, i) => ({
        _id,
        name: `Danh mục ${i}`,
        displayOrder: i % 5,
        isActive: i % 3 === 0,
      })),
    );
    await MenuItem.collection.insertMany(
      menuIds.map((_id, i) => ({
        _id,
        categoryId: categories[i % categories.length],
        name: `Món ${i}`,
        isAvailable: i % 7 !== 0,
        price: 30_000,
        options: [],
      })),
    );
    // Baseline giữ unique giống ứng dụng, chỉ chưa có các index tối ưu mới.
    for (const model of models) {
      for (const [key, options] of model.schema.indexes()) {
        if (options.unique) await model.collection.createIndex(key, options);
      }
    }
    const unsettled = {
      tableId: tables[42],
      status: { $ne: 'CANCELLED' },
      paymentStatus: { $ne: 'PAID' },
    };
    const queries = [
      [
        'orders/list',
        () => Order.find({}).sort({ createdAt: -1, _id: -1 }).limit(20),
      ],
      [
        'orders/status',
        () =>
          Order.find({ status: 'CREATED' })
            .sort({ createdAt: -1, _id: -1 })
            .limit(20),
      ],
      [
        'orders/history',
        () =>
          Order.find({ userId: users[42] }).sort({ createdAt: -1, _id: -1 }),
      ],
      ['orders/table', () => Order.find(unsettled).select({ _id: 1 }).limit(1)],
      [
        'menu/category',
        () => MenuItem.find({ categoryId: categories[0], isAvailable: true }),
      ],
      [
        'categories/admin',
        () => Category.find({}).sort({ displayOrder: 1, name: 1 }),
      ],
    ];
    const before = new Map();
    for (const [name, query] of queries)
      before.set(name, summarize(await query().explain('executionStats')));
    for (const model of models) await model.createIndexes();
    const report = [];
    for (const [name, query] of queries) {
      const after = summarize(await query().explain('executionStats'));
      const baseline = before.get(name);
      assert.equal(after.returned, baseline.returned, `${name}: số kết quả`);
      assert.ok(after.stages.includes('IXSCAN'), `${name}: phải dùng index`);
      assert.ok(
        !after.stages.includes('SORT'),
        `${name}: không cần sort riêng`,
      );
      assert.ok(
        after.docs <= baseline.docs,
        `${name}: không đọc thêm document`,
      );
      report.push({
        query: name,
        beforeDocs: baseline.docs,
        afterDocs: after.docs,
        afterKeys: after.keys,
        indexes: after.indexes.join(', '),
      });
    }
    // Giữ đúng kết quả phân trang khi nhiều đơn có cùng thời gian tạo.
    const orderService = new OrderService(
      Order,
      MenuItem,
      Category,
      new OrderSettlementService(Order, Table),
      Table,
      Counter,
    );
    const firstPage = await orderService.listOrders({ page: 1, limit: 20 });
    const secondPage = await orderService.listOrders({ page: 2, limit: 20 });
    assert.equal(firstPage.pagination.total, orders.length);
    const actual = [...firstPage.orders, ...secondPage.orders].map((order) =>
      order._id.toString(),
    );
    const expected = [...orders]
      .sort(
        (a, b) =>
          b.createdAt - a.createdAt ||
          b._id.toString().localeCompare(a._id.toString()),
      )
      .slice(0, 40)
      .map((order) => order._id.toString());
    assert.deepEqual(actual, expected);

    // Món của danh mục ẩn hoặc ngưng bán không lọt vào menu sau khi tối ưu.
    const menuService = new MenuService(Category, MenuItem, {});
    const publicMenu = await menuService.getMenu();
    assert.ok(publicMenu.length > 0);
    for (const group of publicMenu) {
      assert.equal(group.category.isActive, true);
      for (const item of group.items) {
        assert.equal(item.isAvailable, true);
        assert.equal(item.categoryId.toString(), group.category._id.toString());
      }
    }
    const searchResults = await menuService.searchMenuItems('mÓN 1');
    assert.ok(searchResults.length > 0);
    const publicIds = new Set(
      publicMenu.flatMap((group) =>
        group.items.map((item) => item._id.toString()),
      ),
    );
    assert.ok(
      searchResults.every((item) => publicIds.has(item._id.toString())),
    );
    assert.equal((await menuService.searchMenuItems('.*')).length, 0);

    // Kiểm tra luồng tiền mặt với MongoDB thật trên dữ liệu riêng của script.
    const table = await Table.create({ name: 'Bàn kiểm thử', capacity: 4 });
    const user = { _id: users[0].toString(), role: 'user' };
    const admin = { _id: users[1].toString(), role: 'admin' };
    const payload = {
      tableId: table._id.toString(),
      paymentMethod: 'CASH',
      items: [{ menuItemId: menuIds[3].toString(), quantity: 2 }],
    };
    const firstOrder = await orderService.createOrder(payload, user);
    const secondOrder = await orderService.createOrder(payload, user);
    assert.equal(firstOrder.finalAmount, 60_000);
    assert.notEqual(firstOrder.orderNumber, secondOrder.orderNumber);
    assert.equal((await Table.findById(table._id)).status, 'occupied');
    const paid = await orderService.confirmCashPayment(
      firstOrder._id.toString(),
      admin,
    );
    assert.equal(paid.status, 'COMPLETED');
    assert.equal(paid.paymentStatus, 'PAID');
    assert.equal(paid.paidBy.toString(), admin._id);
    assert.equal((await Table.findById(table._id)).status, 'occupied');
    await orderService.cancelOrder(secondOrder._id.toString(), user, 'Đổi món');
    assert.equal((await Table.findById(table._id)).status, 'empty');
    const repeated = await orderService.confirmCashPayment(
      firstOrder._id.toString(),
      admin,
    );
    assert.equal(repeated.paidAt.getTime(), paid.paidAt.getTime());

    const racing = await orderService.createOrder(payload, user);
    await Promise.allSettled([
      orderService.confirmCashPayment(racing._id.toString(), admin),
      orderService.cancelOrder(racing._id.toString(), user),
    ]);
    const finalOrder = await Order.findById(racing._id);
    assert.ok(
      (finalOrder.status === 'COMPLETED' &&
        finalOrder.paymentStatus === 'PAID') ||
        (finalOrder.status === 'CANCELLED' &&
          finalOrder.paymentStatus === 'PENDING'),
      'Thu tiền và hủy đồng thời phải giữ trạng thái nhất quán',
    );
    assert.equal((await Table.findById(table._id)).status, 'empty');
    console.table(report);
    console.log(
      'Đạt: query plans, phân trang, menu, tạo đơn, thu tiền và hủy đồng thời.',
    );
  } finally {
    try {
      if (connection) await connection.close();
    } finally {
      if (container) docker('rm', '-f', '-v', container);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
