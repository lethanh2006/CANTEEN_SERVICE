# Index và truy vấn của canteen

Các ràng buộc `unique` tiếp tục nằm trong `@Prop`. Index tối ưu truy vấn nằm sau
`SchemaFactory.createForClass(...)`, kèm comment ghi rõ truy vấn sử dụng.

## Các index được chọn

| Schema         | Khóa index                                                          | Truy vấn phục vụ                                                       |
| -------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Order          | `{ createdAt: -1, _id: -1 }`                                        | `listOrders`: danh sách tổng/khoảng ngày                               |
| Order          | `{ status: 1, createdAt: -1, _id: -1 }`                             | `listOrders`: lọc trạng thái và sắp xếp                                |
| Order          | `{ userId: 1, createdAt: -1, _id: -1 }`                             | `getMyOrders` và `listOrders` theo người đặt                           |
| Order          | `{ tableId: 1 }`                                                    | Kiểm tra đơn chưa tất toán khi đối soát/hoàn tác bàn                   |
| Order          | `{ priorityScore: -1, createdAt: 1 }`, partial `status = CONFIRMED` | `getQueue`, `getNextOrder`                                             |
| InventoryBatch | `{ ingredientId: 1, status: 1, expiryDate: 1, _id: 1 }`             | Xuất kho FEFO, cập nhật lô hết hạn, kiểm tra trước khi xóa nguyên liệu |
| InventoryBatch | `{ expiryDate: 1 }`, partial `status = ACTIVE` và `quantity > 0`    | `getExpiryAlerts`                                                      |
| MenuItem       | `{ categoryId: 1, isAvailable: 1 }`                                 | Menu công khai/tìm kiếm và kiểm tra trước khi xóa danh mục             |
| Category       | `{ displayOrder: 1, name: 1 }`                                      | Thứ tự danh mục trong menu quản trị, công khai và CRUD mặc định        |

`_id` đứng sau thời gian trong danh sách đơn để có thứ tự ổn định khi nhiều đơn
cùng `createdAt`. Đây vẫn là phân trang offset: khi dữ liệu thay đổi giữa hai
request, các trang có thể dịch chuyển; `skip` lớn vẫn tốn công duyệt index.

Index bếp khác index danh sách theo trạng thái vì bếp xếp theo `priorityScore`
trước thời gian. Index riêng cho danh sách tổng vẫn cần vì truy vấn này không
cố định `status` hoặc `userId`.

Index FEFO cần là index đầy đủ: thao tác kiểm tra xóa nguyên liệu phải tìm cả lô
đã hết hạn/hết hàng. Nó đồng thời phục vụ cập nhật lô `ACTIVE` đã hết hạn, dù
truy vấn đó không lọc `quantity`. Không thêm `quantity` vào khóa này vì dữ liệu
lô vẫn cần được đọc và số lượng thay đổi mỗi lần xuất kho.

Index cảnh báo dùng partial filter tĩnh. `expiryDate > now` luôn nằm trong
truy vấn; không đưa `new Date()` vào partial filter vì ngày trong định nghĩa
index không tự chạy theo đồng hồ.

Index bàn chỉ giữ `tableId`. Kiểm tra trên MongoDB 7 với điều kiện `$nor` thực tế
cho thấy thêm `status` và `paymentStatus` vẫn phải đọc cùng số document của bàn;
không giữ hai trường đó trong index để tránh cập nhật index khi trạng thái đổi.

## Các thay đổi service

- Tạo đơn: gom ID món và danh mục, đọc tối đa hai truy vấn thay cho hai truy vấn
  mỗi dòng giỏ hàng. Dòng món, thứ tự, số lượng, ghi chú và các option vẫn giữ
  riêng; giá vẫn lấy từ MongoDB. Không cache xuyên request để tránh dùng giá cũ.
- Menu công khai: lọc danh mục hợp lệ ngay trong truy vấn món; bỏ truy vấn món
  nếu không có danh mục hoạt động; nhóm bằng `Map` trong một lượt thay vì
  `categories.map(... menuItems.filter(...))`.
- Các kiểm tra tồn tại trong MenuService dùng `exists`, không lấy toàn bộ món
  hoặc danh mục khi chỉ cần biết có/không.
- Xuất kho chỉ tải `_id`, `expiryDate`, `quantity` cho bước tính khấu trừ.
  Populate cảnh báo chỉ tải tên và đơn vị nguyên liệu. Giao dịch và điều kiện
  cập nhật số lượng cũ vẫn giữ nguyên.
- Đếm danh sách không có bộ lọc dùng index `_id_` sẵn có, vẫn trả số lượng chính
  xác. Khi có bộ lọc thì để MongoDB chọn index tương ứng. Đếm chính xác vẫn có
  chi phí tỷ lệ với số kết quả, không phải thao tác hằng số.

## Những chỗ không thêm index

- `Ingredient`, `Table`, `OrderCounter`: các truy vấn ID/tên/key dùng index
  `_id` hoặc unique hiện có. Không tạo index cho mọi trường có trong
  `allowedSortFields`, hoặc index `status` của bàn khi chưa có bằng chứng tải lớn.
- Không thêm các biến thể `paymentStatus`/mọi tổ hợp bộ lọc đơn. Màn hình hiện tại
  gọi danh sách tổng; bộ lọc tùy chọn này cần số liệu sử dụng trước khi mở rộng.
- Không tạo index thường trùng với index unique `name`, `orderNumber`, mã
  thanh toán hoặc `key` của counter.
- Regex tìm chuỗi ở giữa tên, không phân biệt hoa thường, được giữ nguyên hành
  vi. Index danh mục giúp thu hẹp tập món; nó không biến substring regex thành
  tra cứu tiền tố. Không tự đổi sang tìm tiền tố hoặc `$text`, vì kết quả tìm
  kiếm sẽ thay đổi.
- `getTopDishes` tổng hợp toàn bộ đơn chưa hủy. Thêm index `items.menuItemId`
  không loại bỏ việc đọc/cộng toàn bộ dữ liệu phù hợp. Không giới hạn ngày hoặc
  thêm cache âm thầm vì sẽ đổi phạm vi/độ mới báo cáo. Nếu dữ liệu lịch sử lớn,
  bước tiếp theo là thiết kế khoảng ngày hoặc bảng tổng hợp có quy tắc cập nhật.
- Không thêm covering index chứa toàn bộ `items`, options hoặc các trường chỉ
  để trả response.

## Kiểm chứng

Chạy unit test:

```bash
npm test -- --runInBand
```

Chạy kiểm tra index trên MongoDB thật (cần Docker và image `mongo:7.0`):

```bash
npm run check:indexes
```

Script tạo container riêng, bind cổng ngẫu nhiên tại `127.0.0.1`, sinh 20.000 đơn,
12.000 lô, 800 món và 40 danh mục. Baseline giữ unique nhưng chưa có index tối ưu.
Script kiểm tra `explain('executionStats')` trước/sau, kết quả phân trang, menu
công khai, regex ký tự đặc biệt, unique thanh toán và chuyển trạng thái bếp.
Container và volume được xóa ở cuối. Script không đọc `MONGO_URL`, không kết nối
database ứng dụng.

Một số số liệu trên bộ dữ liệu giả lập này:

| Truy vấn                           | Document đọc trước | Document đọc sau |
| ---------------------------------- | -----------------: | ---------------: |
| Danh sách đơn, trang đầu 20 đơn    |             20.000 |               20 |
| Lịch sử người có 20 đơn            |             20.000 |               20 |
| Nhận đơn tiếp theo trong bếp       |             20.000 |                1 |
| Lô có thể xuất của một nguyên liệu |             12.000 |                4 |
| Đối soát một bàn đã tất toán       |             20.000 |              100 |

Đây là kiểm chứng kế hoạch thực thi trên dữ liệu giả lập, không phải cam kết
tốc độ production. Số document đọc và chi phí ghi trên dữ liệu thật cần đo lại.

## Áp dụng vào database đang chạy

Khai báo schema không tự xóa index cũ. Mongoose có thể tạo index khi khởi động
nếu `autoIndex` được bật; hãy kiểm tra `getIndexes()` trên đúng database sau
khi triển khai. Nếu tắt `autoIndex`, tạo index qua bước triển khai database.

Nếu database vẫn còn bốn index cũ dưới đây, đối chiếu index mới và `explain`
trước khi gỡ từng index cũ. Không dùng `dropIndexes()` hoặc `syncIndexes()`
một cách tự động vì có thể xóa index ngoài phạm vi thay đổi này.

- Orders: `{ status: 1, priorityScore: -1, createdAt: 1 }`.
- Orders: `{ userId: 1, createdAt: -1 }`.
- Inventory batches: `{ status: 1, expiryDate: 1, quantity: 1 }`.
- Inventory batches: `{ ingredientId: 1, status: 1, expiryDate: 1, quantity: 1 }`.

Giữ `_id_` và tất cả unique index. Chưa có thao tác thay đổi index trên database
ứng dụng trong lần chỉnh code này.

## Tài liệu đối chiếu

- [MongoDB: Equality, Sort, Range](https://www.mongodb.com/docs/manual/tutorial/equality-sort-range-guideline/)
- [MongoDB: Partial indexes](https://www.mongodb.com/docs/manual/core/index-partial/)
- [MongoDB: Regex và index](https://www.mongodb.com/docs/manual/reference/operator/query/regex/)
