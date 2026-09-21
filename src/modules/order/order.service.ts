import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter, Types } from 'mongoose';
import { Order, OrderDocument, OrderItem } from '../../schemas/orders.schema';
import { MenuItem, MenuItemDocument } from '../../schemas/menu_items.schema';
import { Category, CategoryDocument } from '../../schemas/categories.schema';
import { CreateOrderDto } from './dto/create-order.dto';
import { AuthenticatedUser } from '../../common/auth';
import { OrderSettlementService } from './order-settlement.service';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { Table, TableDocument } from '../../schemas/tables.schema';
import {
  ORDER_NUMBER_COUNTER_KEY,
  OrderCounter,
  OrderCounterDocument,
} from '../../schemas/order-counter.schema';
import { toError } from '../../common/error.util';

type OrderTableClaim = {
  tableId: Types.ObjectId;
  transitionedFromEmpty: boolean;
};

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
    @InjectModel(MenuItem.name)
    private readonly menuItemModel: Model<MenuItemDocument>,
    @InjectModel(Category.name)
    private readonly categoryModel: Model<CategoryDocument>,
    private readonly orderSettlementService: OrderSettlementService,
    @InjectModel(Table.name)
    private readonly tableModel: Model<TableDocument>,
    @InjectModel(OrderCounter.name)
    private readonly orderCounterModel: Model<OrderCounterDocument>,
  ) {}

  /**
   * Tạo đơn hàng với trạng thái ban đầu là CREATED.
   */
  async createOrder(
    dto: CreateOrderDto,
    user: AuthenticatedUser,
  ): Promise<Order> {
    const rawUserId = user._id ?? user.id;
    if (!rawUserId || !Types.ObjectId.isValid(rawUserId)) {
      throw new UnauthorizedException(
        'Thông tin người dùng không hợp lệ hoặc thiếu ID người dùng',
      );
    }
    const userId = new Types.ObjectId(rawUserId);
    const userRole = (user.role ?? 'user').toLowerCase();

    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Đơn hàng phải có ít nhất một món ăn');
    }

    const orderItems: OrderItem[] = [];
    let totalAmount = 0;

    // Đọc món và danh mục theo lô, không truy vấn lại theo từng dòng giỏ hàng.
    const menuItemIds = [
      ...new Set(
        dto.items.map((item) =>
          new Types.ObjectId(item.menuItemId).toHexString(),
        ),
      ),
    ].map((id) => new Types.ObjectId(id));
    const menuItems = await this.menuItemModel
      .find({ _id: { $in: menuItemIds } })
      .exec();
    const menuItemsById = new Map(
      menuItems.map((item) => [item._id.toString(), item]),
    );
    const categoryIds = [
      ...new Map(
        menuItems.map((item) => [item.categoryId.toString(), item.categoryId]),
      ).values(),
    ];
    const activeCategoryIds =
      categoryIds.length > 0
        ? await this.categoryModel
            .distinct('_id', { _id: { $in: categoryIds }, isActive: true })
            .exec()
        : [];
    const activeCategories = new Set(
      activeCategoryIds.map((id) => id.toString()),
    );

    for (const itemDto of dto.items) {
      const menuItem = menuItemsById.get(itemDto.menuItemId.toLowerCase());
      if (!menuItem) {
        throw new NotFoundException(
          `Món ăn với ID '${itemDto.menuItemId}' không tồn tại`,
        );
      }

      if (menuItem.isAvailable === false) {
        throw new ConflictException(
          `Món ăn '${menuItem.name}' tạm thời ngưng phục vụ`,
        );
      }

      if (!activeCategories.has(menuItem.categoryId.toString())) {
        throw new ConflictException(
          `Danh mục của món '${menuItem.name}' đang tạm ẩn`,
        );
      }

      const selectedOptions = this.resolveSelectedOptions(
        menuItem,
        itemDto.selectedOptions,
      );
      const optionsTotalPrice = selectedOptions.reduce(
        (total, option) => total + option.price,
        0,
      );

      const unitPrice = menuItem.price;
      if (!Number.isSafeInteger(unitPrice) || unitPrice < 0) {
        throw new ConflictException(
          `Giá món '${menuItem.name}' không phải số nguyên VND hợp lệ`,
        );
      }
      const lineAmount = (unitPrice + optionsTotalPrice) * itemDto.quantity;
      if (
        !Number.isSafeInteger(itemDto.quantity) ||
        itemDto.quantity < 1 ||
        !Number.isSafeInteger(lineAmount) ||
        lineAmount < 0 ||
        !Number.isSafeInteger(totalAmount + lineAmount)
      ) {
        throw new ConflictException(
          'Tổng tiền đơn hàng không phải số nguyên VND an toàn',
        );
      }
      totalAmount += lineAmount;

      orderItems.push({
        menuItemId: menuItem._id,
        name: menuItem.name,
        quantity: itemDto.quantity,
        unitPrice: unitPrice,
        selectedOptions: selectedOptions,
        note: itemDto.note || '',
      });
    }

    if (dto.paymentMethod && dto.paymentMethod !== 'CASH') {
      throw new BadRequestException(
        'Phương thức thanh toán hiện chỉ hỗ trợ tiền mặt (CASH)',
      );
    }
    const paymentMethod = 'CASH';

    if (!dto.tableId) {
      throw new BadRequestException('Cần chọn bàn trước khi gọi món');
    }

    const tableClaim = await this.occupyTableForOrder(dto.tableId);
    try {
      const orderNumber = await this.nextOrderNumber();
      const newOrder = new this.orderModel({
        orderNumber,
        userId,
        userRole,
        tableId: tableClaim.tableId,
        items: orderItems,
        totalAmount,
        finalAmount: totalAmount,
        status: 'CREATED',
        paymentStatus: 'PENDING',
        paymentMethod,
      });

      const savedOrder = await newOrder.save();
      await this.ensureTableOccupied(tableClaim.tableId);
      return savedOrder;
    } catch (error) {
      if (tableClaim.transitionedFromEmpty) {
        await this.rollbackTableOccupancy(tableClaim.tableId);
      }
      throw error;
    }
  }

  /**
   * Cấp số đơn hàng bằng document counter. Khi nâng cấp từ dữ liệu cũ,
   * counter được seed từ orderNumber lớn nhất để tiếp tục dãy số đơn hàng.
   */
  private async nextOrderNumber(): Promise<string> {
    const incrementExisting = () =>
      this.orderCounterModel
        .findOneAndUpdate(
          { key: ORDER_NUMBER_COUNTER_KEY },
          { $inc: { sequence: 1 } },
          { new: true, runValidators: true },
        )
        .exec();

    let counter = await incrementExisting();
    if (!counter) {
      const seed = await this.readLegacyOrderNumberSeed();
      try {
        counter = await this.orderCounterModel
          .findOneAndUpdate(
            { key: ORDER_NUMBER_COUNTER_KEY },
            [
              {
                $set: {
                  key: ORDER_NUMBER_COUNTER_KEY,
                  sequence: {
                    $add: [{ $ifNull: ['$sequence', seed] }, 1],
                  },
                },
              },
            ],
            { new: true, upsert: true, updatePipeline: true },
          )
          .exec();
      } catch (error) {
        if (!this.isDuplicateKeyError(error)) throw error;
        counter = await incrementExisting();
      }
    }

    const sequence = Number(counter?.sequence);
    if (!Number.isSafeInteger(sequence) || sequence < 1001) {
      throw new InternalServerErrorException(
        'Không thể cấp mã đơn hàng hợp lệ',
      );
    }
    return `#${sequence}`;
  }

  private async readLegacyOrderNumberSeed(): Promise<number> {
    const [result] = await this.orderModel
      .aggregate<{ sequence?: number }>([
        { $match: { orderNumber: { $regex: '^#[0-9]+$' } } },
        {
          $project: {
            sequence: {
              $convert: {
                input: {
                  $substrBytes: [
                    '$orderNumber',
                    1,
                    { $subtract: [{ $strLenBytes: '$orderNumber' }, 1] },
                  ],
                },
                to: 'double',
                onError: 1000,
                onNull: 1000,
              },
            },
          },
        },
        { $group: { _id: null, sequence: { $max: '$sequence' } } },
      ])
      .exec();
    const sequence = Number(result?.sequence ?? 1000);
    return Number.isSafeInteger(sequence) && sequence >= 1000 ? sequence : 1000;
  }

  /**
   * Bàn empty hoặc occupied đều nhận thêm đơn. Trạng thái reserved bị giữ lại
   * vì hệ thống chưa có thông tin chủ đặt bàn để xác thực quyền sử dụng.
   */
  private async occupyTableForOrder(tableId: string): Promise<OrderTableClaim> {
    if (!Types.ObjectId.isValid(tableId)) {
      throw new BadRequestException('ID bàn ăn không đúng định dạng ObjectId');
    }
    const objectId = new Types.ObjectId(tableId);
    const previous = await this.tableModel
      .findOneAndUpdate(
        { _id: objectId, status: { $in: ['empty', 'occupied'] } },
        { $set: { status: 'occupied' } },
        { new: false, runValidators: true },
      )
      .exec();
    if (previous) {
      return {
        tableId: objectId,
        transitionedFromEmpty: previous.status === 'empty',
      };
    }

    const existing = await this.tableModel.findById(objectId).exec();
    if (!existing) {
      throw new NotFoundException(`Bàn ăn với ID '${tableId}' không tồn tại`);
    }
    throw new ConflictException(
      `Bàn '${existing.name}' đang ở trạng thái '${existing.status}' và không thể nhận đơn`,
    );
  }

  /**
   * Sau khi lưu đơn, xác nhận lại occupied để khép cửa sổ race với một request
   * tạo đơn khác đang rollback. Lỗi ở bước best-effort này không làm client tạo
   * trùng đơn đã được lưu thành công.
   */
  private async ensureTableOccupied(tableId: Types.ObjectId): Promise<void> {
    try {
      await this.tableModel
        .updateOne({ _id: tableId }, { $set: { status: 'occupied' } })
        .exec();
    } catch (error) {
      this.logger.error(
        `Không thể xác nhận trạng thái occupied cho bàn ${tableId.toString()}: ${toError(error).message}`,
      );
    }
  }

  /**
   * Chỉ hoàn tác bàn do request hiện tại chuyển từ empty. Nếu save có kết quả
   * không chắc chắn hoặc đã có đơn khác cùng bàn, dữ liệu Order là nguồn quyết
   * định và bàn vẫn giữ occupied.
   */
  private async rollbackTableOccupancy(tableId: Types.ObjectId): Promise<void> {
    try {
      const unsettledOrder = await this.orderModel
        .exists({
          tableId,
          status: { $ne: 'CANCELLED' },
          paymentStatus: { $ne: 'PAID' },
        })
        .exec();
      if (unsettledOrder) return;

      await this.tableModel
        .updateOne(
          { _id: tableId, status: 'occupied' },
          { $set: { status: 'empty' } },
        )
        .exec();
    } catch (error) {
      this.logger.error(
        `Không thể hoàn tác trạng thái bàn ${tableId.toString()}: ${toError(error).message}`,
      );
    }
  }

  private isDuplicateKeyError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 11000
    );
  }

  /**
   * Giá tùy chọn luôn được lấy từ MenuItem trong MongoDB.
   */
  private resolveSelectedOptions(
    menuItem: MenuItemDocument,
    requestedOptions: Array<{ name: string }> | undefined,
  ): Array<{ name: string; price: number }> {
    if (!requestedOptions?.length) {
      return [];
    }

    const availableOptions = new Map(
      (menuItem.options ?? []).map((option) => [
        this.normalizeOptionName(option.name),
        option,
      ]),
    );
    const selectedNames = new Set<string>();

    return requestedOptions.map((requested) => {
      const normalizedName = this.normalizeOptionName(requested.name);
      const authoritative = availableOptions.get(normalizedName);
      if (!authoritative) {
        throw new BadRequestException(
          `Tùy chọn '${requested.name}' không tồn tại trong món '${menuItem.name}'`,
        );
      }
      if (selectedNames.has(normalizedName)) {
        throw new BadRequestException(
          `Tùy chọn '${requested.name}' bị chọn trùng trong món '${menuItem.name}'`,
        );
      }
      if (
        !Number.isSafeInteger(authoritative.price) ||
        authoritative.price < 0
      ) {
        throw new ConflictException(
          `Giá tùy chọn '${authoritative.name}' của món '${menuItem.name}' không hợp lệ`,
        );
      }

      selectedNames.add(normalizedName);
      return {
        name: authoritative.name,
        price: authoritative.price,
      };
    });
  }

  private normalizeOptionName(name: string): string {
    return name.trim().normalize('NFKC').toLocaleLowerCase('vi-VN');
  }

  /**
   * Xem lịch sử đơn hàng cá nhân
   */
  async getMyOrders(user: AuthenticatedUser): Promise<Order[]> {
    const rawUserId = user._id ?? user.id;
    if (!rawUserId || !Types.ObjectId.isValid(rawUserId)) {
      throw new UnauthorizedException(
        'Thông tin người dùng không hợp lệ hoặc thiếu ID người dùng',
      );
    }

    return await this.orderModel
      .find({ userId: new Types.ObjectId(rawUserId) })
      .sort({ createdAt: -1, _id: -1 })
      .exec();
  }

  /**
   * Danh sách đơn dành cho màn hình vận hành căn tin.
   */
  async listOrders(query: ListOrdersQueryDto) {
    const filter: QueryFilter<OrderDocument> = {};
    if (query.status) filter.status = query.status;
    if (query.paymentStatus) filter.paymentStatus = query.paymentStatus;
    if (query.userId) filter.userId = new Types.ObjectId(query.userId);
    if (query.tableId) filter.tableId = new Types.ObjectId(query.tableId);

    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    if (from && to && from > to) {
      throw new BadRequestException(
        'Thời gian bắt đầu phải nhỏ hơn hoặc bằng thời gian kết thúc',
      );
    }
    if (from || to) {
      filter.createdAt = {
        ...(from ? { $gte: from } : {}),
        ...(to ? { $lte: to } : {}),
      };
    }

    const page = query.page || 1;
    const limit = query.limit || 20;
    const [orders, total] = await Promise.all([
      this.orderModel
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.orderModel
        .countDocuments(
          filter,
          Object.keys(filter).length === 0 ? { hint: '_id_' } : {},
        )
        .exec(),
    ]);

    return {
      orders,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Lấy thông tin chi tiết của một đơn hàng
   */
  async getOrderById(id: string, user?: AuthenticatedUser): Promise<Order> {
    const order = await this.orderModel.findById(id).exec();
    if (!order) {
      throw new NotFoundException(`Đơn hàng với ID '${id}' không tồn tại`);
    }

    if (user) {
      const requesterId = user._id ?? user.id;
      const privilegedRoles = new Set(['admin']);
      if (
        order.userId.toString() !== requesterId &&
        !privilegedRoles.has(user.role?.toLowerCase() ?? '')
      ) {
        throw new ForbiddenException('Bạn không có quyền xem đơn hàng này');
      }
    }

    return order;
  }

  /**
   * Hủy đơn có kiểm tra chủ sở hữu, vai trò và trạng thái hiện tại.
   */
  async cancelOrder(
    id: string,
    user: AuthenticatedUser,
    reason?: string,
  ): Promise<Order> {
    const rawUserId = user._id ?? user.id;
    if (!rawUserId || !Types.ObjectId.isValid(rawUserId)) {
      throw new UnauthorizedException(
        'Thông tin người dùng không hợp lệ hoặc thiếu ID người dùng',
      );
    }

    const order = await this.orderModel.findById(id).exec();
    if (!order) {
      throw new NotFoundException(`Đơn hàng với ID '${id}' không tồn tại`);
    }

    const isOwner = order.userId.toString() === rawUserId;
    const isOperator = user.role?.toLowerCase() === 'admin';
    if (!isOwner && !isOperator) {
      throw new ForbiddenException('Bạn không có quyền hủy đơn hàng này');
    }

    if (order.status === 'CANCELLED') {
      return order;
    }
    if (order.paymentStatus === 'PAID') {
      throw new ConflictException('Đơn hàng đã thanh toán không thể hủy');
    }
    if (order.status !== 'CREATED') {
      throw new ConflictException(
        `Đơn hàng ở trạng thái '${order.status}' không thể hủy`,
      );
    }

    const cancellationReason = reason?.trim();
    const cancelledOrder = await this.orderModel
      .findOneAndUpdate(
        {
          _id: order._id,
          status: 'CREATED',
          paymentStatus: 'PENDING',
        },
        {
          $set: {
            status: 'CANCELLED',
            cancelledAt: new Date(),
            cancelledBy: new Types.ObjectId(rawUserId),
            ...(cancellationReason ? { cancellationReason } : {}),
          },
        },
        { new: true, runValidators: true },
      )
      .exec();
    if (!cancelledOrder) {
      throw new ConflictException(
        'Đơn hàng đã thay đổi trạng thái hoặc thanh toán; vui lòng tải lại',
      );
    }
    await this.orderSettlementService.reconcileTableForOrder(
      cancelledOrder._id,
    );
    return cancelledOrder;
  }

  /** Admin xác nhận đã thu tiền mặt; đây là thao tác thanh toán duy nhất hiện tại. */
  async confirmCashPayment(
    id: string,
    admin: AuthenticatedUser,
  ): Promise<Order> {
    const rawAdminId = admin._id ?? admin.id;
    if (!rawAdminId || !Types.ObjectId.isValid(rawAdminId)) {
      throw new UnauthorizedException('Thông tin quản trị viên không hợp lệ');
    }
    if (admin.role?.toLowerCase() !== 'admin') {
      throw new ForbiddenException('Chỉ admin được xác nhận thu tiền mặt');
    }

    const order = await this.orderModel.findById(id).exec();
    if (!order) {
      throw new NotFoundException(`Đơn hàng với ID '${id}' không tồn tại`);
    }
    if (order.status === 'CANCELLED') {
      throw new ConflictException('Đơn hàng đã hủy không thể thu tiền');
    }
    if (order.paymentMethod !== 'CASH') {
      throw new ConflictException(
        'Đơn hàng không thuộc phương thức thanh toán tiền mặt',
      );
    }
    if (order.paymentStatus === 'PAID') {
      await this.orderSettlementService.reconcileTableForOrder(order._id);
      return order;
    }

    const updatedOrder = await this.orderModel
      .findOneAndUpdate(
        {
          _id: order._id,
          status: { $ne: 'CANCELLED' },
          paymentMethod: 'CASH',
          paymentStatus: 'PENDING',
        },
        {
          $set: {
            paymentStatus: 'PAID',
            status: 'COMPLETED',
            paidAt: new Date(),
            paidBy: new Types.ObjectId(rawAdminId),
          },
        },
        { new: true, runValidators: true },
      )
      .exec();
    if (!updatedOrder) {
      throw new ConflictException(
        'Đơn hàng đã thay đổi trạng thái hoặc thanh toán; vui lòng tải lại',
      );
    }
    await this.orderSettlementService.reconcileTableForOrder(updatedOrder._id);
    return updatedOrder;
  }
}
