import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Table, TableDocument } from '../../schemas/tables.schema';

const DEFAULT_TABLES = Array.from({ length: 20 }, (_, index) => {
  const name = `Bàn ${String(index + 1).padStart(2, '0')}`;
  return {
    name,
  };
});

/** Khởi tạo bàn mặc định một lần, không ghi đè dữ liệu đang có. */
@Injectable()
export class DefaultTablesService implements OnApplicationBootstrap {
  constructor(
    @InjectModel(Table.name) private readonly tableModel: Model<TableDocument>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.tableModel.bulkWrite(
      DEFAULT_TABLES.map(({ name }) => ({
        updateOne: {
          filter: { name },
          update: {
            $setOnInsert: {
              name,
              capacity: 4,
              status: 'empty',
            },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }
}
