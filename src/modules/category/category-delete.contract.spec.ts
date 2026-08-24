import { ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { CategoryService } from './category.service';

describe('Xóa danh mục căn tin', () => {
  function createService(hasMenuItem: boolean) {
    const category = {
      _id: new Types.ObjectId(),
      name: 'Món chính',
      deleteOne: jest.fn().mockResolvedValue(undefined),
    };
    const categoryModel = {
      findById: jest.fn(() => ({
        exec: jest.fn().mockResolvedValue(category),
      })),
    };
    const menuItemModel = {
      exists: jest.fn(() => ({
        exec: jest
          .fn()
          .mockResolvedValue(hasMenuItem ? { _id: new Types.ObjectId() } : null),
      })),
    };

    return {
      category,
      categoryModel,
      menuItemModel,
      service: new CategoryService(
        categoryModel as never,
        menuItemModel as never,
      ),
    };
  }

  it('chặn xóa danh mục vẫn còn món ăn', async () => {
    const { category, menuItemModel, service } = createService(true);

    await expect(service.delete(category._id.toString())).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(menuItemModel.exists).toHaveBeenCalledWith({
      categoryId: category._id,
    });
    expect(category.deleteOne).not.toHaveBeenCalled();
  });

  it('cho phép xóa danh mục trống', async () => {
    const { category, service } = createService(false);

    await expect(service.delete(category._id.toString())).resolves.toBe(
      category,
    );
    expect(category.deleteOne).toHaveBeenCalledTimes(1);
  });
});
