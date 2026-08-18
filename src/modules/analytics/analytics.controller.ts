import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';

@Controller('api/canteen/analytics')
@UseGuards(RolesGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  /**
   * GET /api/canteen/analytics/top-dishes
   * Trả về các món ăn bán chạy nhất.
   * Quyền hạn: Quản trị viên hoặc quản lý.
   */
  @Get('top-dishes')
  @Roles(Role.ADMIN, Role.MANAGER)
  async getTopDishes(@Query('limit') limit?: number) {
    return this.analyticsService.getTopDishes(limit ? Number(limit) : 10);
  }
}
