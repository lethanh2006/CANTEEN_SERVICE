import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role, Roles } from '../../common/auth';
import { ParseObjectIdPipe } from '../../common/parse-object-id.pipe';
import { RolesGuard } from '../../common/roles.guard';
import { CategoryService } from './category.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { ListCategoriesQueryDto } from './dto/list-categories-query.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Controller('api/canteen/categories')
@UseGuards(RolesGuard)
export class CategoryController {
  constructor(private readonly categoryService: CategoryService) {}

  @Get()
  async findAll(@Query() query: ListCategoriesQueryDto) {
    const result = await this.categoryService.findAll(query);
    return { success: true, ...result };
  }

  @Get(':id')
  async findOne(@Param('id', new ParseObjectIdPipe('ID danh mục')) id: string) {
    return { success: true, data: await this.categoryService.findOne(id) };
  }

  @Post()
  @Roles(Role.ADMIN)
  async create(@Body() dto: CreateCategoryDto) {
    return { success: true, data: await this.categoryService.create(dto) };
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  async update(
    @Param('id', new ParseObjectIdPipe('ID danh mục')) id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return {
      success: true,
      data: await this.categoryService.update(id, dto),
    };
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  async delete(@Param('id', new ParseObjectIdPipe('ID danh mục')) id: string) {
    return {
      success: true,
      data: await this.categoryService.delete(id),
      message: 'Xóa dữ liệu thành công',
    };
  }
}
