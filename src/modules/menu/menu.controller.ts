import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { MenuService } from './menu.service';
import { CreateMenuItemDto } from './dto/create-menu-item.dto';
import { UpdateMenuItemDto } from './dto/update-menu-item.dto';
import { type AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { Role } from '../../common/enums/role.enum';
import { Roles } from '../../common/decorators/roles.decorator';
import { User } from '../../common/decorators/user.decorator';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { RolesGuard } from '../../common/guards/roles.guard';

@Controller('api/canteen')
@UseGuards(RolesGuard)
export class MenuController {
  constructor(private readonly menuService: MenuService) {}

  /**
   * GET /api/canteen/menu
   * Lấy toàn bộ thực đơn đang bán và phân nhóm theo danh mục.
   * Quyền hạn: Công khai.
   */
  @Get('menu')
  async getMenu() {
    return this.menuService.getMenu();
  }

  /**
   * GET /api/canteen/menu/search?q=...
   * Tìm kiếm món ăn đang bán theo tên.
   * Quyền hạn: Công khai.
   */
  @Get('menu/search')
  async searchMenu(@Query('q') query: string) {
    return this.menuService.searchMenuItems(query || '');
  }

  /**
   * GET /api/canteen/admin/menu
   * Lấy cả món/danh mục đang ẩn để quản trị viên có thể bật lại hoặc chỉnh sửa.
   */
  @Get('admin/menu')
  @Roles(Role.ADMIN)
  async getAdminMenu() {
    return this.menuService.getAdminMenu();
  }

  /**
   * POST /api/canteen/admin/menu
   * Tạo mới món ăn
   * Quyền hạn: Quản trị viên hoặc quản lý.
   */
  @Post('admin/menu')
  @Roles(Role.ADMIN)
  async createMenuItem(
    @Body() createMenuItemDto: CreateMenuItemDto,
    @User() user: AuthenticatedUser,
  ) {
    const userId = user?._id || user?.id || 'system';
    return this.menuService.createMenuItem(createMenuItemDto, userId);
  }

  /**
   * PUT /api/canteen/admin/menu/:id
   * Cập nhật món ăn và lưu trạng thái cũ vào ngăn xếp lịch sử.
   * Quyền hạn: Quản trị viên hoặc quản lý.
   */
  @Put('admin/menu/:id')
  @Roles(Role.ADMIN)
  async updateMenuItem(
    @Param('id', new ParseObjectIdPipe('ID món ăn')) id: string,
    @Body() updateMenuItemDto: UpdateMenuItemDto,
    @User() user: AuthenticatedUser,
  ) {
    const userId = user?._id || user?.id || 'system';
    return this.menuService.updateMenuItem(id, updateMenuItemDto, userId);
  }

  /**
   * DELETE /api/canteen/admin/menu/:id
   * Xóa vĩnh viễn món ăn khỏi thực đơn.
   * Quyền hạn: Quản trị viên hoặc quản lý.
   */
  @Delete('admin/menu/:id')
  @Roles(Role.ADMIN)
  async deleteMenuItem(
    @Param('id', new ParseObjectIdPipe('ID món ăn')) id: string,
    @User() user: AuthenticatedUser,
  ) {
    const userId = user?._id || user?.id || 'system';
    return this.menuService.deleteMenuItem(id, userId);
  }

  /**
   * POST /api/canteen/admin/menu/undo
   * Hoàn tác thay đổi gần nhất trên thực đơn.
   * Quyền hạn: Quản trị viên hoặc quản lý.
   */
  @Post('admin/menu/undo')
  @Roles(Role.ADMIN)
  async undoMenuItemChange(@User() user: AuthenticatedUser) {
    const userId = user?._id || user?.id || 'system';
    return this.menuService.undoMenuItemChange(userId);
  }

  /**
   * POST /api/canteen/admin/menu/redo
   * Làm lại thay đổi vừa được hoàn tác trên thực đơn.
   * Quyền hạn: Quản trị viên hoặc quản lý.
   */
  @Post('admin/menu/redo')
  @Roles(Role.ADMIN)
  async redoMenuItemChange(@User() user: AuthenticatedUser) {
    const userId = user?._id || user?.id || 'system';
    return this.menuService.redoMenuItemChange(userId);
  }
}
