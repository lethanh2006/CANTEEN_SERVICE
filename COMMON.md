# Luồng dùng chung của Canteen

Đọc theo thứ tự: `src/main.ts` → `src/core/core.module.ts` → controller và service trong `src/modules/{category,menu,order,table}`.

1. `main.ts` khởi tạo Nest, logger và `ValidationPipe`; lỗi validation dùng `createValidationException`. `CoreModule` đăng ký middleware, filter, logger và dịch vụ kiểm tra chữ ký Gateway.
2. `common/middleware/request-id.middleware.ts` giữ hoặc tạo request ID, đưa vào request/response và ngữ cảnh log.
3. `common/guards/roles.guard.ts` kiểm tra user được Gateway chuyển tiếp bằng `common/security/gateway-signature.service.ts`, rồi áp dụng `@Authenticated()` / `@Roles()`. Decorator nằm trong `common/decorators`; `@User()` lấy user đã được guard gắn vào request.
4. Controller kiểm tra ObjectId bằng `common/pipes/parse-object-id.pipe.ts` và gọi service nghiệp vụ. Role nằm trong `common/enums/role.enum.ts`; kiểu user/request nằm trong `common/interfaces`; việc đọc payload user nằm trong `common/utils/authenticated-user.util.ts`.
5. `common/filters/global-exception.filter.ts` tạo response lỗi, gắn request ID và ghi lỗi ngoài dự kiến. `common/logging/logger.ts` tập trung logger, adapter Nest và `LoggerLifecycleService` để flush log khi dừng ứng dụng.

`common/utils/error.util.ts` chuẩn hóa lỗi cho Order và Redis. Redis, xử lý đơn hàng/thanh toán, DTO và schema nằm tại module/schema tương ứng; chúng vẫn phục vụ luồng production. Giữ nguyên giá trị role, kiểm tra chữ ký và định dạng response của Canteen.

Chạy kiểm tra: `npm run format:check`, `npm run lint`, `npm run build`, `npm test -- --runInBand`. `npm run check:indexes` kiểm tra truy vấn trên MongoDB tạm bằng Docker.
