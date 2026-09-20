# Index và truy vấn căn tin

| Schema | Index | Truy vấn |
| --- | --- | --- |
| Order | `{ createdAt: -1, _id: -1 }` | Danh sách đơn, khoảng ngày |
| Order | `{ status: 1, createdAt: -1, _id: -1 }` | Lọc trạng thái |
| Order | `{ userId: 1, createdAt: -1, _id: -1 }` | Lịch sử cá nhân |
| Order | `{ tableId: 1 }` | Kiểm tra đơn chưa tất toán cùng bàn |
| MenuItem | `{ categoryId: 1, isAvailable: 1 }` | Menu công khai, tìm kiếm, kiểm tra xóa danh mục |
| Category | `{ displayOrder: 1, name: 1 }` | Sắp xếp danh mục |

Các khóa unique của tên bàn/danh mục, mã đơn và counter được giữ.
`_id` làm khóa phụ để phân trang ổn định khi nhiều đơn cùng thời gian tạo.
Đây là phân trang offset; dữ liệu đổi giữa hai request có thể làm dịch chuyển trang.

Tạo đơn đọc món và danh mục theo lô, giữ giá tùy chọn từ database.
Menu công khai chỉ đọc món đang bán thuộc danh mục hoạt động.
Bàn được đối soát bằng các đơn cùng `tableId` có `status != CANCELLED` và
`paymentStatus != PAID`.

## Kiểm chứng

```bash
npm test -- --runInBand
npm run check:indexes
```

Script tạo container MongoDB riêng, bind cổng ngẫu nhiên tại `127.0.0.1`, sinh
20.000 đơn, 800 món và 40 danh mục. Nó đối chiếu query plan trước/sau tạo index,
thứ tự phân trang, menu công khai và tìm kiếm. Sau đó chạy tạo đơn trên bàn,
thu tiền mặt, hủy đơn và cuộc đua thu tiền/hủy để kiểm tra trạng thái và trả bàn.

Script không đọc `MONGO_URL`, không kết nối database ứng dụng. Container tạm và
volume được dọn ở cuối.

## Database đang chạy

Dọn schema không tự xóa dữ liệu/index cũ. Không gọi `dropIndexes()` hay
`syncIndexes()` tự động. Nếu cần gỡ index của nghiệp vụ đã bỏ, kiểm kê và đối chiếu
truy vấn trên đúng database trước khi triển khai migration riêng.
