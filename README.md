# Căn tin nhân viên

Service phục vụ tiện ích gọi món tại bàn cho nhân viên công ty.

- Nhân viên đăng nhập, chọn bàn rồi tạo đơn tiền mặt.
- Admin quản lý món, danh mục, bàn; xem đơn theo bàn và xác nhận đã thu tiền.
- Đơn mới: `CREATED/PENDING` → `COMPLETED/PAID`, hoặc `CANCELLED/PENDING`.
- Giá món và tùy chọn luôn lấy từ database; client chỉ gửi ID món, số lượng và tên tùy chọn.
- Bàn chỉ được trả về trống khi không còn đơn chưa thanh toán/chưa hủy.
- Khởi tạo 20 bàn mặc định; giữ tạo, sửa, xóa món/danh mục/bàn và undo/redo thực đơn.

Đã xóa các module bếp, nguyên liệu, kho, thống kê, phân bàn tự động, giảm giá/trợ cấp
và consumer thanh toán QR. Service chỉ cần MongoDB và Redis (undo/redo thực đơn);
không còn phụ thuộc RabbitMQ hoặc outbox.

## API đang dùng qua Gateway

| Nghiệp vụ | API |
| --- | --- |
| Menu công khai | `GET /api/canteen/menu`, `GET /api/canteen/menu/search` |
| Quản lý món | `/api/canteen/admin/menu` |
| Danh mục | `/api/canteen/categories` |
| Bàn | `/api/canteen/tables` |
| Tạo và xem đơn | `POST/GET /api/canteen/orders` |
| Đơn cá nhân/chi tiết | `GET /api/canteen/orders/my-orders`, `GET /api/canteen/orders/:id` |
| Hủy đơn mới chưa thanh toán | `PATCH /api/canteen/orders/:id/cancel` |
| Admin xác nhận tiền mặt | `PATCH /api/canteen/orders/:id/payment/cash` |

Gateway xác thực JWT, Canteen kiểm tra danh tính đã ký và quyền `admin`/`user`.
Hợp đồng DTO và route phải cập nhật đồng thời ở Gateway và app.

## Chạy và kiểm tra

```bash
npm ci
npm run start:dev
npm run build
npm run lint
npm run format:check
npm test -- --runInBand
npm run check:indexes
```

`check:indexes` cần Docker và image `mongo:7.0`; tạo database tạm riêng để kiểm tra
index, menu, tạo đơn, thu tiền/hủy đồng thời và đối soát bàn.

Việc dọn mã nguồn không xóa collection, đơn lịch sử hoặc index trên VPS.
Không tự chạy `syncIndexes()` hoặc migration sửa trạng thái/số tiền của đơn cũ.

Xem [vòng đời request](docs/request-lifecycle.md) và [index database](docs/database-indexes.md).
