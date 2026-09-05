import { MenuService } from './menu.service';

describe('Thực đơn công khai', () => {
  it('chỉ tìm món đang bán thuộc danh mục đang hoạt động', async () => {
    const activeCategoryIds = ['category-active'];
    const categoryExec = jest.fn().mockResolvedValue(activeCategoryIds);
    const categoryDistinct = jest.fn(() => ({ exec: categoryExec }));
    const menuItems = [{ _id: 'item-1', name: 'Cơm tấm' }];
    const menuExec = jest.fn().mockResolvedValue(menuItems);
    const menuSort = jest.fn(() => ({ exec: menuExec }));
    const menuFind = jest.fn(() => ({ sort: menuSort }));
    const service = new MenuService(
      { distinct: categoryDistinct } as never,
      { find: menuFind } as never,
      {} as never,
    );

    await expect(service.searchMenuItems(' cơm ')).resolves.toEqual(menuItems);
    expect(categoryDistinct).toHaveBeenCalledWith('_id', { isActive: true });
    expect(menuFind).toHaveBeenCalledWith({
      isAvailable: true,
      categoryId: { $in: activeCategoryIds },
      name: { $regex: 'cơm', $options: 'i' },
    });
    expect(menuSort).toHaveBeenCalledWith({ name: 1 });
  });
});
