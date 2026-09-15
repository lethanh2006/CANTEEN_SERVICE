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
  InventoryDeductionReport,
} from './utils/fefo-consumption';
import { OutboxService } from '../outbox/outbox.service';

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
    private readonly outboxService: OutboxService,
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
    if (expiryDate.getTime() <= Date.now()) {
      throw new BadRequestException('Hạn sử dụng phải ở trong tương lai');
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
    const now = new Date();
    const batches = await this.batchModel
      .find({
        status: 'ACTIVE',
        quantity: { $gt: 0 },
        expiryDate: { $gt: now },
      })
      .sort({ expiryDate: 1 })
      .populate<{ ingredientId: IngredientDocument }>(
        'ingredientId',
        'name unit',
      )
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
    const session = await this.batchModel.db.startSession();
    let committed:
      | {
          ingredient: IngredientDocument;
          report: InventoryDeductionReport;
        }
      | undefined;

    try {
      committed = await session.withTransaction(
        async () => {
          const ingredient = await this.ingredientModel
            .findById(dto.ingredientId)
            .session(session)
            .exec();
          if (!ingredient) {
            throw new NotFoundException(
              `Nguyên liệu với ID '${dto.ingredientId}' không tồn tại`,
            );
          }

          const now = new Date();
          const ingredientId = new Types.ObjectId(dto.ingredientId);

          // Đồng bộ trạng thái để các lô hết hạn không thể tiếp tục tham gia FEFO.
          await this.batchModel
            .updateMany(
              {
                ingredientId,
                status: 'ACTIVE',
                expiryDate: { $lte: now },
              },
              { $set: { status: 'EXPIRED' } },
              { session, runValidators: true },
            )
            .exec();

          const activeBatches = await this.batchModel
            .find(
              {
                ingredientId,
                status: 'ACTIVE',
                quantity: { $gt: 0 },
                expiryDate: { $gt: now },
              },
              { expiryDate: 1, quantity: 1 },
            )
            .sort({ expiryDate: 1, _id: 1 })
            .session(session)
            .exec();

          const batchesByExpiry: ConsumableBatch[] = activeBatches.map(
            (batch) => ({
              batchId: batch._id.toString(),
              expiryDate: batch.expiryDate,
              quantity: batch.quantity,
            }),
          );

          const report = calculateFefoConsumption(
            ingredient._id.toString(),
            dto.quantity,
            batchesByExpiry,
            ingredient.minimumThreshold,
          );

          if (!report.isFullyFulfilled) {
            const currentAvailable = activeBatches.reduce(
              (acc, batch) => acc + batch.quantity,
              0,
            );
            throw new ConflictException(
              `Số lượng nguyên liệu trong kho không đủ (Hiện có: ${currentAvailable} ${ingredient.unit}, yêu cầu: ${dto.quantity} ${ingredient.unit})`,
            );
          }

          const originalQuantityByBatch = new Map(
            activeBatches.map((batch) => [
              batch._id.toString(),
              batch.quantity,
            ]),
          );

          for (const affected of report.affectedBatches) {
            const originalQuantity = originalQuantityByBatch.get(
              affected.batchId,
            );
            if (originalQuantity === undefined) {
              throw new ConflictException('Không tìm thấy lô cần khấu trừ');
            }

            const updateResult = await this.batchModel
              .updateOne(
                {
                  _id: new Types.ObjectId(affected.batchId),
                  ingredientId,
                  status: 'ACTIVE',
                  expiryDate: { $gt: now },
                  quantity: originalQuantity,
                },
                {
                  $set: {
                    quantity: affected.remainingBatchQuantity,
                    status: affected.status,
                  },
                },
                { session, runValidators: true },
              )
              .exec();

            if (updateResult.matchedCount !== 1) {
              throw new ConflictException(
                'Tồn kho vừa thay đổi, vui lòng thực hiện lại yêu cầu',
              );
            }
          }

          if (report.isLowStockAlert) {
            await this.outboxService.enqueue(
              {
                eventType: 'inventory.low_stock',
                queueName: 'inventory.low_stock',
                aggregateId: ingredient._id.toString(),
                payload: {
                  ingredientId: ingredient._id.toString(),
                  ingredientName: ingredient.name,
                  currentStock: report.remainingTotalStock,
                  minimumThreshold: ingredient.minimumThreshold,
                  unit: ingredient.unit,
                  alertTime: new Date(),
                },
              },
              session,
            );
          }

          return { ingredient, report };
        },
        {
          readConcern: { level: 'snapshot' },
          writeConcern: { w: 'majority' },
        },
      );
    } finally {
      await session.endSession();
    }

    if (!committed) {
      throw new ConflictException('Không thể hoàn tất giao dịch khấu trừ kho');
    }

    const { ingredient, report } = committed;

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
