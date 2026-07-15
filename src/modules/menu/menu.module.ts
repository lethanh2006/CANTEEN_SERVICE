import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Category, CategorySchema } from '../../schemas/categories.schema';
import { MenuItem, MenuItemSchema } from '../../schemas/menu_items.schema';
import { MenuController } from './menu.controller';
import { MenuService } from './menu.service';
import { MenuHistoryManager } from './utils/undo-stack';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Category.name, schema: CategorySchema },
      { name: MenuItem.name, schema: MenuItemSchema },
    ]),
  ],
  controllers: [MenuController],
  providers: [MenuService, MenuHistoryManager],
  exports: [MenuService, MenuHistoryManager],
})
export class MenuModule {}
