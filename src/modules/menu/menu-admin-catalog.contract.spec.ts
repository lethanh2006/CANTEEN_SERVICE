import { MenuService } from './menu.service';

describe('Danh mục thực đơn quản trị', () => {
  it('trả cả danh mục và món đang ẩn theo thứ tự ổn định', async () => {
    const categories = [
      { _id: 'category-1', name: 'Món chính', isActive: false },
    ];
    const items = [{ _id: 'item-1', name: 'Cơm', isAvailable: false }];
    const categoryExec = jest.fn().mockResolvedValue(categories);
    const categorySort = jest.fn(() => ({ exec: categoryExec }));
    const menuExec = jest.fn().mockResolvedValue(items);
    const menuSort = jest.fn(() => ({ exec: menuExec }));
    const categoryModel = {
      find: jest.fn(() => ({ sort: categorySort })),
    };
    const menuItemModel = {
      find: jest.fn(() => ({ sort: menuSort })),
    };
    const service = new MenuService(
      categoryModel as never,
      menuItemModel as never,
      {} as never,
    );

    await expect(service.getAdminMenu()).resolves.toEqual({
      categories,
      items,
    });
    expect(categoryModel.find).toHaveBeenCalledWith({});
    expect(categorySort).toHaveBeenCalledWith({ displayOrder: 1, name: 1 });
    expect(menuItemModel.find).toHaveBeenCalledWith({});
    expect(menuSort).toHaveBeenCalledWith({ name: 1 });
  });
});
