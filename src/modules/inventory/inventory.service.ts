import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Ingredient, IngredientDocument } from '../../schemas/ingredients.schema';
import { InventoryBatch, InventoryBatchDocument } from '../../schemas/inventory_batches.schema';
import { CreateIngredientDto } from './dto/create-ingredient.dto';
import { CreateInventoryBatchDto } from './dto/create-inventory-batch.dto';
import { ConsumeIngredientDto } from './dto/consume-ingredient.dto';
import { InventoryMinHeap, InventoryBatchNode } from './utils/min-heap';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';

@Injectable()
export class InventoryService {
  constructor(
    @InjectModel(Ingredient.name) private readonly ingredientModel: Model<IngredientDocument>,
    @InjectModel(InventoryBatch.name) private readonly batchModel: Model<InventoryBatchDocument>,
    private readonly rabbitMQService: RabbitMQService,
  ) {}

  /**
   * POST /api/canteen/inventory/ingredients
   * Khởi tạo nguyên liệu mới.
   */
  async createIngredient(dto: CreateIngredientDto): Promise<Ingredient> {
    const existing = await this.ingredientModel.findOne({ name: dto.name.trim() }).exec();
    if (existing) {
      throw new BadRequestException(`Nguyên liệu '${dto.name}' đã tồn tại trong hệ thống`);
    }

    const newIngredient = new this.ingredientModel({
      name: dto.name.trim(),
      unit: dto.unit.trim(),
      minimumThreshold: dto.minimumThreshold,
    });

    return await newIngredient.save();
  }

  /**
   * POST /api/canteen/inventory/batches
   * Nhập lô hàng mới (đẩy vào Min Heap quản lý hạn sử dụng).
   */
  async createBatch(dto: CreateInventoryBatchDto): Promise<InventoryBatch> {
    if (!Types.ObjectId.isValid(dto.ingredientId)) {
      throw new BadRequestException('ID nguyên liệu (ingredientId) không đúng định dạng ObjectId');
    }

    const ingredient = await this.ingredientModel.findById(dto.ingredientId).exec();
    if (!ingredient) {
      throw new NotFoundException(`Nguyên liệu với ID '${dto.ingredientId}' không tồn tại`);
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
   * Lấy danh sách nguyên liệu sắp hết hạn cần sử dụng trước (Min Heap FEFO).
   */
  async getExpiryAlerts(): Promise<InventoryBatchNode[]> {
    const batches = await this.batchModel
      .find({ status: 'ACTIVE', quantity: { $gt: 0 } })
      .populate<{ ingredientId: IngredientDocument }>('ingredientId')
      .exec();

    const minHeap = new InventoryMinHeap();

    for (const batch of batches) {
      const ing = batch.ingredientId as unknown as IngredientDocument;
      minHeap.push({
        batchId: batch._id.toString(),
        ingredientId: ing?._id ? ing._id.toString() : batch.ingredientId.toString(),
        ingredientName: ing?.name || 'Unknown',
        unit: ing?.unit || '',
        expiryDate: batch.expiryDate,
        quantity: batch.quantity,
        originalQuantity: batch.originalQuantity,
        costPrice: batch.costPrice,
        supplier: batch.supplier,
        status: batch.status,
      });
    }

    return minHeap.getSortedBatches();
  }

  /**
   * POST /api/canteen/inventory/consume
   * Khấu trừ nguyên liệu sau khi nấu ăn (tự động trừ lô hết hạn trước - FEFO).
   */
  async consumeIngredient(dto: ConsumeIngredientDto): Promise<any> {
    if (!Types.ObjectId.isValid(dto.ingredientId)) {
      throw new BadRequestException('ID nguyên liệu (ingredientId) không đúng định dạng ObjectId');
    }

    const ingredient = await this.ingredientModel.findById(dto.ingredientId).exec();
    if (!ingredient) {
      throw new NotFoundException(`Nguyên liệu với ID '${dto.ingredientId}' không tồn tại`);
    }

    // Retrieve active batches sorted by expiryDate (FEFO order)
    const activeBatches = await this.batchModel
      .find({ ingredientId: new Types.ObjectId(dto.ingredientId), status: 'ACTIVE', quantity: { $gt: 0 } })
      .sort({ expiryDate: 1 })
      .exec();

    const totalAvailable = activeBatches.reduce((acc, b) => acc + b.quantity, 0);
    if (totalAvailable < dto.quantity) {
      throw new BadRequestException(
        `Số lượng nguyên liệu trong kho không đủ (Hiện có: ${totalAvailable} ${ingredient.unit}, yêu cầu: ${dto.quantity} ${ingredient.unit})`
      );
    }

    let remainingToDeduct = dto.quantity;
    const updatedBatchesSummary: any[] = [];

    for (const batch of activeBatches) {
      if (remainingToDeduct <= 0) break;

      let deducted = 0;
      if (batch.quantity <= remainingToDeduct) {
        deducted = batch.quantity;
        remainingToDeduct -= batch.quantity;
        batch.quantity = 0;
        batch.status = 'DEPLETED';
      } else {
        deducted = remainingToDeduct;
        batch.quantity -= remainingToDeduct;
        remainingToDeduct = 0;
      }

      await batch.save();
      updatedBatchesSummary.push({
        batchId: batch._id,
        expiryDate: batch.expiryDate,
        deducted,
        remainingInBatch: batch.quantity,
        status: batch.status,
      });
    }

    // Check total remaining stock after deduction
    const remainingBatches = await this.batchModel
      .find({ ingredientId: new Types.ObjectId(dto.ingredientId), status: 'ACTIVE' })
      .exec();
    const currentTotalStock = remainingBatches.reduce((acc, b) => acc + b.quantity, 0);

    // If stock is below minimumThreshold, publish 'inventory.low_stock' event
    if (currentTotalStock <= ingredient.minimumThreshold) {
      await this.rabbitMQService.publish('inventory.low_stock', {
        ingredientId: ingredient._id.toString(),
        ingredientName: ingredient.name,
        currentStock: currentTotalStock,
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
        totalRemainingStock: currentTotalStock,
        isLowStock: currentTotalStock <= ingredient.minimumThreshold,
      },
      consumedQuantity: dto.quantity,
      consumedBatches: updatedBatchesSummary,
    };
  }
}
