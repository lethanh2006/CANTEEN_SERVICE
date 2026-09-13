import { MenuService } from './menu.service';
import { Types } from 'mongoose';

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

  it('không truy vấn món khi tìm kiếm mà không có danh mục công khai', async () => {
    const find = jest.fn();
    const service = new MenuService(
      { distinct: () => ({ exec: async () => [] }) } as never,
      { find } as never,
      {} as never,
    );

    await expect(service.searchMenuItems('cơm')).resolves.toEqual([]);
    expect(find).not.toHaveBeenCalled();
  });

  it('gom món đúng danh mục và giữ danh mục rỗng', async () => {
    const categories = [
      { _id: new Types.ObjectId(), name: 'Món chính' },
      { _id: new Types.ObjectId(), name: 'Nước' },
      { _id: new Types.ObjectId(), name: 'Tráng miệng' },
    ];
    const items = [
      { name: 'Trà', categoryId: categories[1]._id },
      { name: 'Cơm', categoryId: categories[0]._id },
      { name: 'Bún', categoryId: categories[0]._id },
    ];
    const find = jest.fn(() => ({ exec: async () => items }));
    const service = new MenuService(
      {
        find: () => ({ sort: () => ({ exec: async () => categories }) }),
      } as never,
      { find } as never,
      {} as never,
    );

    await expect(service.getMenu()).resolves.toEqual([
      { category: categories[0], items: [items[1], items[2]] },
      { category: categories[1], items: [items[0]] },
      { category: categories[2], items: [] },
    ]);
    expect(find).toHaveBeenCalledWith({
      categoryId: { $in: categories.map((category) => category._id) },
      isAvailable: true,
    });
  });

  it('không tải món khi thực đơn không có danh mục hoạt động', async () => {
    const find = jest.fn();
    const service = new MenuService(
      { find: () => ({ sort: () => ({ exec: async () => [] }) }) } as never,
      { find } as never,
      {} as never,
    );

    await expect(service.getMenu()).resolves.toEqual([]);
    expect(find).not.toHaveBeenCalled();
  });
});
