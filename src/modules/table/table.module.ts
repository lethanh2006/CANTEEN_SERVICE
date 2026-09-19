import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Table, TableSchema } from '../../schemas/tables.schema';
import { TableController } from './table.controller';
import { TableService } from './table.service';
import { DefaultTablesService } from './default-tables.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Table.name, schema: TableSchema }]),
  ],
  controllers: [TableController],
  providers: [TableService, DefaultTablesService],
  exports: [TableService],
})
export class TableModule {}
