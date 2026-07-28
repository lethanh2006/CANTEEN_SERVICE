import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Table, TableDocument } from '../../schemas/tables.schema';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableStatusDto } from './dto/update-table-status.dto';
import { AllocateTableDto } from './dto/allocate-table.dto';
import { TableAllocationService, TableItem } from './utils/table-allocation';

@Injectable()
export class TableService {
  constructor(
    @InjectModel(Table.name) private readonly tableModel: Model<TableDocument>,
  ) {}

  /**
   * GET /api/canteen/tables
   * Lấy danh sách tất cả các bàn ăn
   */
  async getAllTables(): Promise<Table[]> {
    return await this.tableModel.find().sort({ name: 1 }).exec();
  }

  /**
   * GET /api/canteen/tables/:id
   * Lấy thông tin bàn ăn theo ID
   */
  async getTableById(id: string): Promise<Table> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('ID bàn ăn không đúng định dạng ObjectId');
    }

    const table = await this.tableModel.findById(id).exec();
    if (!table) {
      throw new NotFoundException(`Bàn ăn với ID '${id}' không tồn tại`);
    }
    return table;
  }

  /**
   * POST /api/canteen/tables
   * Tạo mới bàn ăn & tự động sinh QR code url
   */
  async createTable(dto: CreateTableDto): Promise<Table> {
    const existing = await this.tableModel.findOne({ name: dto.name.trim() }).exec();
    if (existing) {
      throw new BadRequestException(`Bàn ăn với tên '${dto.name}' đã tồn tại`);
    }

    const newTable = new this.tableModel({
      name: dto.name.trim(),
      capacity: dto.capacity,
      qrCodeUrl: dto.qrCodeUrl || `https://canteen.domain.com/qr/tables/${encodeURIComponent(dto.name.trim())}`,
      status: 'empty',
    });

    return await newTable.save();
  }

  /**
   * PATCH /api/canteen/tables/:id/status
   * Cập nhật trạng thái bàn ăn (empty, occupied, reserved)
   */
  async updateTableStatus(id: string, dto: UpdateTableStatusDto): Promise<Table> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('ID bàn ăn không đúng định dạng ObjectId');
    }

    const table = await this.tableModel.findById(id).exec();
    if (!table) {
      throw new NotFoundException(`Bàn ăn với ID '${id}' không tồn tại`);
    }

    table.status = dto.status;
    return await table.save();
  }

  /**
   * POST /api/canteen/tables/allocate
   * Giải thuật Phân Bổ & Gộp Bàn Tự Động cho số lượng khách truyền vào
   */
  async allocateTables(dto: AllocateTableDto): Promise<any> {
    const emptyTableDocs = await this.tableModel.find({ status: 'empty' }).exec();

    const emptyTables: TableItem[] = emptyTableDocs.map((t) => ({
      id: t._id.toString(),
      name: t.name,
      capacity: t.capacity,
      status: t.status as 'empty',
    }));

    const result = TableAllocationService.allocateTables(emptyTables, dto.partySize);
    if (!result) {
      throw new BadRequestException(
        `Không đủ bàn trống để xếp chỗ cho nhóm ${dto.partySize} người (Tổng sức chứa hiện có: ${emptyTables.reduce((acc, t) => acc + t.capacity, 0)})`
      );
    }

    // Automatically update status of allocated tables to occupied
    const objectIds = result.allocatedTableIds.map((id) => new Types.ObjectId(id));
    await this.tableModel.updateMany(
      { _id: { $in: objectIds } },
      { $set: { status: 'occupied' } }
    ).exec();

    const allocatedTables = await this.tableModel.find({ _id: { $in: objectIds } }).exec();

    return {
      message: result.isMerged
        ? `Đã gộp ${result.allocatedTableIds.length} bàn thành công cho nhóm ${dto.partySize} người`
        : `Đã phân bổ 1 bàn phù hợp cho nhóm ${dto.partySize} người`,
      allocationDetails: result,
      tables: allocatedTables,
    };
  }
}
