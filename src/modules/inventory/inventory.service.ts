import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Ingredient,
  IngredientDocument,
} from '../../schemas/ingredients.schema';
import {
  InventoryBatch,
  InventoryBatchDocument,
} from '../../schemas/inventory_batches.schema';
import { CreateInventoryBatchDto } from './dto/create-inventory-batch.dto';
import { ConsumeIngredientDto } from './dto/consume-ingredient.dto';
import {
  calculateFefoConsumption,
  ConsumableBatch,
} from './utils/fefo-consumption';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';

export interface InventoryBatchSummary {
  batchId: string;
  ingredientId: string;
  ingredientName: string;
  unit: string;
  expiryDate: Date;
  quantity: number;
  originalQuantity: number;
  costPrice: number;
  supplier: string;
  status: string;
}

@Injectable()
export class InventoryService {
  constructor(
    @InjectModel(Ingredient.name)
    private readonly ingredientModel: Model<IngredientDocument>,
    @InjectModel(InventoryBatch.name)
    private readonly batchModel: Model<InventoryBatchDocument>,
    private readonly rabbitMQService: RabbitMQService,
  ) {}

  /**
   * POST /api/canteen/inventory/batches
   * Nhập một lô nguyên liệu mới.
   */
  async createBatch(dto: CreateInventoryBatchDto): Promise<InventoryBatch> {
    const ingredient = await this.ingredientModel
      .findById(dto.ingredientId)
      .exec();
    if (!ingredient) {
      throw new NotFoundException(
        `Nguyên liệu với ID '${dto.ingredientId}' không tồn tại`,
      );
    }

    const expiryDate = new Date(dto.expiryDate);
    if (isNaN(expiryDate.getTime())) {
      throw new BadRequestException('Hạn sử dụng không hợp lệ');
    }

    const newBatch = new this.batchModel({
      ingredientId: new Types.ObjectId(dto.ingredientId),
      quantity: dto.quantity,
      originalQuantity: dto.quantity,
      expiryDate: expiryDate,
      importDate: new Date(),
      costPrice: dto.costPrice,
      supplier: dto.supplier || '',
      status: 'ACTIVE',
    });

    return await newBatch.save();
  }

  /**
   * GET /api/canteen/inventory/expiry-alerts
   * Lấy danh sách lô nguyên liệu theo thứ tự hết hạn sớm nhất.
   */
  async getExpiryAlerts(): Promise<InventoryBatchSummary[]> {
    const batches = await this.batchModel
      .find({ status: 'ACTIVE', quantity: { $gt: 0 } })
      .sort({ expiryDate: 1 })
      .populate<{ ingredientId: IngredientDocument }>('ingredientId')
      .exec();

    return batches.map((batch) => {
      const ing = batch.ingredientId;
      return {
        batchId: batch._id.toString(),
        ingredientId: ing._id.toString(),
        ingredientName: ing.name,
        unit: ing.unit,
        expiryDate: batch.expiryDate,
        quantity: batch.quantity,
        originalQuantity: batch.originalQuantity,
        costPrice: batch.costPrice,
        supplier: batch.supplier,
        status: batch.status,
      };
    });
  }

  /**
   * POST /api/canteen/inventory/consume
   * Khấu trừ nguyên liệu theo nguyên tắc lô hết hạn trước được dùng trước.
   */
  async consumeIngredient(dto: ConsumeIngredientDto): Promise<unknown> {
    const ingredient = await this.ingredientModel
      .findById(dto.ingredientId)
      .exec();
    if (!ingredient) {
      throw new NotFoundException(
        `Nguyên liệu với ID '${dto.ingredientId}' không tồn tại`,
      );
    }

    // Lấy các lô còn hàng và đang hoạt động từ cơ sở dữ liệu.
    const activeBatches = await this.batchModel
      .find({
        ingredientId: new Types.ObjectId(dto.ingredientId),
        status: 'ACTIVE',
        quantity: { $gt: 0 },
      })
      .sort({ expiryDate: 1 })
      .exec();

    const batchesByExpiry: ConsumableBatch[] = activeBatches.map((batch) => ({
      batchId: batch._id.toString(),
      expiryDate: batch.expiryDate,
      quantity: batch.quantity,
    }));

    const report = calculateFefoConsumption(
      ingredient._id.toString(),
      dto.quantity,
      batchesByExpiry,
      ingredient.minimumThreshold,
    );

    if (!report.isFullyFulfilled) {
      const currentAvailable = activeBatches.reduce(
        (acc, b) => acc + b.quantity,
        0,
      );
      throw new ConflictException(
        `Số lượng nguyên liệu trong kho không đủ (Hiện có: ${currentAvailable} ${ingredient.unit}, yêu cầu: ${dto.quantity} ${ingredient.unit})`,
      );
    }

    // Lưu số lượng và trạng thái mới của các lô đã bị khấu trừ.
    for (const affected of report.affectedBatches) {
      await this.batchModel
        .findByIdAndUpdate(affected.batchId, {
          $set: {
            quantity: affected.remainingBatchQuantity,
            status: affected.status,
          },
        })
        .exec();
    }

    // Phát sự kiện cảnh báo khi tồn kho xuống dưới ngưỡng tối thiểu.
    if (report.isLowStockAlert) {
      await this.rabbitMQService.publish('inventory.low_stock', {
        ingredientId: ingredient._id.toString(),
        ingredientName: ingredient.name,
        currentStock: report.remainingTotalStock,
        minimumThreshold: ingredient.minimumThreshold,
        unit: ingredient.unit,
        alertTime: new Date(),
      });
    }

    return {
      ingredient: {
        id: ingredient._id,
        name: ingredient.name,
        unit: ingredient.unit,
        minimumThreshold: ingredient.minimumThreshold,
        totalRemainingStock: report.remainingTotalStock,
        isLowStock: report.isLowStockAlert,
      },
      consumedQuantity: dto.quantity,
      report,
    };
  }
}
