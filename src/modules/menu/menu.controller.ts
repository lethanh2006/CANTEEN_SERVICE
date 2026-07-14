import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { MenuService } from './menu.service';
import { CreateMenuItemDto } from './dto/create-menu-item.dto';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';

@Controller('api/canteen')
@UseGuards(RolesGuard)
export class MenuController {
  constructor(private readonly menuService: MenuService) { }

  /**
   * GET /api/canteen/menu
   * Lấy toàn bộ thực đơn đang bán (phân nhóm theo Category)
   * Quyền hạn: Tất cả (Public)
   */
  @Get('menu')
  async getMenu() {
    return this.menuService.getMenu();
  }

  /**
   * POST /api/canteen/admin/menu
   * Tạo mới món ăn
   * Quyền hạn: Admin / Manager
   */
  @Post('admin/menu')
  @Roles('admin', 'manager')
  async createMenuItem(@Body() createMenuItemDto: CreateMenuItemDto) {
    return this.menuService.createMenuItem(createMenuItemDto);
  }
}
