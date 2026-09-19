import { Controller, UseGuards } from '@nestjs/common';
import { Role } from '../../common/enums/role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { createCrudController } from '../../common/crud';
import { CategoryDocument } from '../../schemas/categories.schema';
import { CategoryService } from './category.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

const CategoryCrudController = createCrudController<
  CategoryDocument,
  CreateCategoryDto,
  UpdateCategoryDto
>({
  createDto: CreateCategoryDto,
  updateDto: UpdateCategoryDto,
  idFieldName: 'ID danh mục',
  writeRoles: [Role.ADMIN],
});

@Controller('api/canteen/categories')
@UseGuards(RolesGuard)
export class CategoryController extends CategoryCrudController {
  constructor(categoryService: CategoryService) {
    super(categoryService);
  }
}
