import { Controller, Get, Post, Put, Body, Param, UseGuards } from '@nestjs/common';
import { MenuService } from './menu.service';
import { CreateMenuItemDto } from './dto/create-menu-item.dto';
import { UpdateMenuItemDto } from './dto/update-menu-item.dto';
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

  /**
   * PUT /api/canteen/admin/menu/:id
   * Cập nhật thông tin món ăn (Lưu trạng thái cũ vào Stack)
   * Quyền hạn: Admin / Manager
   */
  @Put('admin/menu/:id')
  @Roles('admin', 'manager')
  async updateMenuItem(
    @Param('id') id: string,
    @Body() updateMenuItemDto: UpdateMenuItemDto,
  ) {
    return this.menuService.updateMenuItem(id, updateMenuItemDto);
  }

  /**
   * POST /api/canteen/admin/menu/undo
   * Hoàn tác (Undo) thao tác sửa đổi vừa thực hiện trên Menu
   * Quyền hạn: Admin / Manager
   */
  @Post('admin/menu/undo')
  @Roles('admin', 'manager')
  async undoMenuItemChange() {
    return this.menuService.undoMenuItemChange();
  }

  /**
   * POST /api/canteen/admin/menu/redo
   * Làm lại (Redo) thao tác vừa hoàn tác trên Menu
   * Quyền hạn: Admin / Manager
   */
  @Post('admin/menu/redo')
  @Roles('admin', 'manager')
  async redoMenuItemChange() {
    return this.menuService.redoMenuItemChange();
  }
}
