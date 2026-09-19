import { Controller, UseGuards } from '@nestjs/common';
import { createCrudController } from '../../common/crud';
import { Role } from '../../common/enums/role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { IngredientDocument } from '../../schemas/ingredients.schema';
import { CreateIngredientDto } from './dto/create-ingredient.dto';
import { UpdateIngredientDto } from './dto/update-ingredient.dto';
import { IngredientService } from './ingredient.service';

const IngredientCrudController = createCrudController<
  IngredientDocument,
  CreateIngredientDto,
  UpdateIngredientDto
>({
  createDto: CreateIngredientDto,
  updateDto: UpdateIngredientDto,
  idFieldName: 'ID nguyên liệu',
  writeRoles: [Role.ADMIN],
});

@Controller('api/canteen/inventory/ingredients')
@UseGuards(RolesGuard)
export class IngredientController extends IngredientCrudController {
  constructor(ingredientService: IngredientService) {
    super(ingredientService);
  }
}
