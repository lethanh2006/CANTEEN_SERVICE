# Base CRUD của canteen

Base CRUD cung cấp sẵn các endpoint:

| Method | Path | Chức năng |
| --- | --- | --- |
| `GET` | `/resource` | Danh sách, phân trang, tìm kiếm, sắp xếp |
| `GET` | `/resource/:id` | Chi tiết |
| `POST` | `/resource` | Tạo mới |
| `PATCH` | `/resource/:id` | Cập nhật một phần |
| `DELETE` | `/resource/:id` | Xóa vĩnh viễn |

Query chung của endpoint danh sách:

```text
?page=1&limit=20&q=keyword&sortBy=createdAt&sortOrder=desc
```

Để bật CRUD cho resource mới:

1. Tạo `CreateDto` và `UpdateDto` để whitelist/validate input.
2. Tạo service kế thừa `BaseCrudService`, inject Mongoose model và cấu hình các field được search/sort/unique.
3. Tạo controller từ `createCrudController`, khai báo DTO, tên ID và role được phép ghi.
4. Đăng ký model, controller và service trong module NestJS.

Xem `modules/category` làm ví dụ hoàn chỉnh. Với resource có nghiệp vụ riêng,
override các hook `prepare*`, `before*`, `after*`; không đưa các thao tác nghiệp vụ
như FEFO, phát RabbitMQ hoặc undo/redo vào CRUD generic.
