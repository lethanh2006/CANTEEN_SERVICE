import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { MenuService } from './menu.service';
import { CreateMenuItemDto } from './dto/create-menu-item.dto';
import { UpdateMenuItemDto } from './dto/update-menu-item.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { User } from '../../common/decorators/user.decorator';
import { Role } from '../../common/enums/role.enum';

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
  @Roles(Role.ADMIN, Role.MANAGER)
  async createMenuItem(
    @Body() createMenuItemDto: CreateMenuItemDto,
    @User() user: any,
  ) {
    const userId = user?._id || user?.id || 'system';
    return this.menuService.createMenuItem(createMenuItemDto, userId);
  }

  /**
   * PUT /api/canteen/admin/menu/:id
   * Cập nhật thông tin món ăn (Lưu trạng thái cũ vào Stack)
   * Quyền hạn: Admin / Manager
   */
  @Put('admin/menu/:id')
  @Roles(Role.ADMIN, Role.MANAGER)
  async updateMenuItem(
    @Param('id') id: string,
    @Body() updateMenuItemDto: UpdateMenuItemDto,
    @User() user: any,
  ) {
    const userId = user?._id || user?.id || 'system';
    return this.menuService.updateMenuItem(id, updateMenuItemDto, userId);
  }

  /**
   * DELETE /api/canteen/admin/menu/:id
   * Xóa món ăn khỏi menu (Soft delete)
   * Quyền hạn: Admin / Manager
   */
  @Delete('admin/menu/:id')
  @Roles(Role.ADMIN, Role.MANAGER)
  async deleteMenuItem(
    @Param('id') id: string,
    @User() user: any,
  ) {
    const userId = user?._id || user?.id || 'system';
    return this.menuService.deleteMenuItem(id, userId);
  }

  /**
   * POST /api/canteen/admin/menu/undo
   * Hoàn tác (Undo) thao tác sửa đổi vừa thực hiện trên Menu
   * Quyền hạn: Admin / Manager
   */
  @Post('admin/menu/undo')
  @Roles(Role.ADMIN, Role.MANAGER)
  async undoMenuItemChange(@User() user: any) {
    const userId = user?._id || user?.id || 'system';
    return this.menuService.undoMenuItemChange(userId);
  }

  /**
   * POST /api/canteen/admin/menu/redo
   * Làm lại (Redo) thao tác vừa hoàn tác trên Menu
   * Quyền hạn: Admin / Manager
   */
  @Post('admin/menu/redo')
  @Roles(Role.ADMIN, Role.MANAGER)
  async redoMenuItemChange(@User() user: any) {
    const userId = user?._id || user?.id || 'system';
    return this.menuService.redoMenuItemChange(userId);
  }
}
