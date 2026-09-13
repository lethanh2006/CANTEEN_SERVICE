// Chạy trên container MongoDB tạm; không đọc MONGO_URL hay dữ liệu ứng dụng.
require('reflect-metadata');
require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const mongoose = require('mongoose');
const { OrderSchema } = require('../src/schemas/orders.schema');
const {
  InventoryBatchSchema,
} = require('../src/schemas/inventory_batches.schema');
const { MenuItemSchema } = require('../src/schemas/menu_items.schema');
const { CategorySchema } = require('../src/schemas/categories.schema');
const { IngredientSchema } = require('../src/schemas/ingredients.schema');
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
    const Batch = connection.model('InventoryBatch', InventoryBatchSchema);
    const MenuItem = connection.model('MenuItem', MenuItemSchema);
    const Category = connection.model('Category', CategorySchema);
    const Ingredient = connection.model('Ingredient', IngredientSchema);
    const models = [Order, Batch, MenuItem, Category, Ingredient];
    const objectIds = (count) =>
      Array.from({ length: count }, () => new mongoose.Types.ObjectId());
    const users = objectIds(1_000);
    const tables = objectIds(200);
    const ingredients = objectIds(300);
    const categories = objectIds(40);
    const menuIds = objectIds(800);
    const now = new Date('2030-01-01T00:00:00Z');
    const orders = Array.from({ length: 20_000 }, (_, i) => ({
      _id: new mongoose.Types.ObjectId(),
      orderNumber: `#${1001 + i}`,
      userId: users[i % users.length],
      tableId: tables[i % tables.length],
      status: i % 100 < 2 ? 'CONFIRMED' : i % 100 < 4 ? 'READY' : 'COMPLETED',
      paymentStatus: i % 100 < 4 ? 'PENDING' : 'PAID',
      priorityScore: i % 7,
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
    const batches = Array.from({ length: 12_000 }, (_, i) => ({
      ingredientId: ingredients[i % ingredients.length],
      status:
        Math.floor(i / ingredients.length) % 4 === 0 ? 'ACTIVE' : 'DEPLETED',
      quantity: i % 17 === 0 ? 0 : 10,
      expiryDate: new Date(
        now.getTime() + (Math.floor(i / ingredients.length) - 20) * 86_400_000,
      ),
    }));
    await Order.collection.insertMany(orders);
    await Batch.collection.insertMany(batches);
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
    await Ingredient.collection.insertMany(
      ingredients.map((_id, i) => ({
        _id,
        name: `Nguyên liệu ${i}`,
        unit: 'kg',
        minimumThreshold: 1,
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
      $nor: [
        { status: 'CANCELLED' },
        { status: { $in: ['COMPLETED', 'PAID'] }, paymentStatus: 'PAID' },
      ],
    };
    const queries = [
      [
        'orders/list',
        () => Order.find({}).sort({ createdAt: -1, _id: -1 }).limit(20),
      ],
      [
        'orders/status',
        () =>
          Order.find({ status: 'READY' })
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
        'kitchen/queue',
        () =>
          Order.find({ status: 'CONFIRMED' }).sort({
            priorityScore: -1,
            createdAt: 1,
          }),
      ],
      [
        'kitchen/next',
        () =>
          Order.find({ status: 'CONFIRMED' })
            .sort({ priorityScore: -1, createdAt: 1 })
            .limit(1),
      ],
      [
        'inventory/fefo',
        () =>
          Batch.find(
            {
              ingredientId: ingredients[42],
              status: 'ACTIVE',
              quantity: { $gt: 0 },
              expiryDate: { $gt: now },
            },
            { expiryDate: 1, quantity: 1 },
          ).sort({ expiryDate: 1, _id: 1 }),
      ],
      [
        'inventory/expiry',
        () =>
          Batch.find({
            status: 'ACTIVE',
            quantity: { $gt: 0 },
            expiryDate: { $gt: now },
          }).sort({ expiryDate: 1 }),
      ],
      [
        'inventory/expired',
        () =>
          Batch.find({
            ingredientId: ingredients[42],
            status: 'ACTIVE',
            expiryDate: { $lte: now },
          }),
      ],
      [
        'inventory/ingredient',
        () =>
          Batch.find({ ingredientId: ingredients[42] })
            .select({ _id: 1 })
            .limit(1),
      ],
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
      {},
      {},
      {},
      {},
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

    // Unique sparse vẫn cho phép thiếu mã nhưng chặn một mã gắn vào hai đơn.
    for (const field of [
      'paymentId',
      'paymentEventId',
      'providerTransactionId',
    ]) {
      await Order.collection.updateOne(
        { _id: orders[0]._id },
        { $set: { [field]: `test-${field}` } },
      );
      await assert.rejects(
        Order.collection.updateOne(
          { _id: orders[1]._id },
          { $set: { [field]: `test-${field}` } },
        ),
        (error) => error.code === 11000,
      );
    }
    const next = await Order.findOneAndUpdate(
      { status: 'CONFIRMED' },
      { $set: { status: 'COOKING' } },
      { sort: { priorityScore: -1, createdAt: 1 }, returnDocument: 'after' },
    );
    assert.ok(next);
    assert.equal(next.status, 'COOKING');
    assert.equal(
      await Order.countDocuments({ status: 'CONFIRMED', _id: next._id }),
      0,
    );
    console.table(report);
    console.log(
      'Đạt: query plans, phân trang, menu công khai, unique thanh toán và chuyển trạng thái bếp.',
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
