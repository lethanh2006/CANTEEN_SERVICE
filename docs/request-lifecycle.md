# Canteen request lifecycle

## Cấu trúc theo trách nhiệm

```text
backend/canteen/src/
├── core/
│   └── core.module.ts                   # Đăng ký concern áp dụng toàn cục
├── common/
│   ├── decorators/                      # Metadata authentication/role
│   ├── middleware/
│   │   └── request-id.middleware.ts     # Tạo/nhận x-request-id
│   ├── guards/
│   │   └── roles.guard.ts               # Xác thực payload Gateway + phân quyền
│   ├── security/
│   │   └── gateway-signature.service.ts # Xác minh HMAC và thời hạn payload
│   ├── interceptors/
│   │   └── http-logging.interceptor.ts  # Log request thành công + duration
│   ├── pipes/                            # Validate/transform tham số
│   ├── filters/
│   │   └── global-exception.filter.ts   # Response/log lỗi tập trung
│   ├── observability/
│   │   └── structured-logger.service.ts # Log JSON cho collector
│   └── interfaces/                       # Kiểu user và request context
├── modules/
│   ├── health/                           # Liveness/readiness
│   ├── category/                         # Controller + service + DTO domain
│   ├── table/
│   ├── menu/
│   ├── order/
│   ├── inventory/
│   ├── database/                         # MongoDB adapter
│   ├── redis/                            # Redis adapter
│   └── rabbitmq/                         # RabbitMQ adapter
└── main.ts                               # Bootstrap + global ValidationPipe
```

`core` chỉ ghép các concern toàn cục. Business logic vẫn nằm trong từng module
domain; middleware/guard/interceptor/filter không chứa nghiệp vụ căn tin.

## Luồng HTTP

```text
Client
  ↓
Gateway RequestIdMiddleware + RateLimitMiddleware
  ↓
Gateway JwtAuthGuard + RolesGuard
  ↓
Gateway ký x-user-payload bằng HMAC và forward x-request-id
  ↓
Canteen RequestIdMiddleware
  ↓
Canteen RolesGuard xác minh HMAC + quyền
  ↓
HttpLoggingInterceptor bắt đầu chuỗi xử lý
  ↓
Global ValidationPipe / route ParseObjectIdPipe
  ↓
Controller → domain Service → MongoDB / Redis / RabbitMQ
  ↓
HttpLoggingInterceptor ghi status + duration + requestId
  ↓
Client response có header x-request-id
```

Nếu phát sinh lỗi từ guard trở đi, `GlobalExceptionFilter` trả response có
`requestId` và xuất một structured log. Hệ thống thu thập log bên ngoài (Loki,
ELK, Datadog...) chịu trách nhiệm tạo rule rồi gửi Telegram/Discord. Không gọi
webhook trực tiếp và đồng bộ trong request.

## Cấu hình chữ ký Gateway

Gateway và canteen phải dùng cùng một chuỗi bí mật đủ dài:

```dotenv
CANTEEN_INTERNAL_SECRET=replace_with_a_long_random_shared_secret
```

Ở canteen production, chữ ký luôn bắt buộc vì `NODE_ENV=production`. Local có
thể chuyển dần bằng `CANTEEN_REQUIRE_SIGNATURE=false`; muốn kiểm thử cơ chế đầy
đủ thì đặt cùng secret ở hai service và bật thành `true`.

Chữ ký bao gồm timestamp, request ID và payload user:

```text
HMAC_SHA256(secret, timestamp.requestId.base64UserPayload)
```

Timestamp chỉ hợp lệ trong `CANTEEN_SIGNATURE_MAX_AGE_MS` để giảm replay.

## Health endpoints

- `GET /health/live`: process còn hoạt động.
- `GET /health` hoặc `/health/ready`: MongoDB, Redis và RabbitMQ đều sẵn sàng;
  nếu thiếu một dependency sẽ trả `503`.

## Rate limit khi scale

Rate limiter hiện tại của Gateway dùng bộ nhớ của một instance. Khi chạy nhiều
replica, chuyển state sang Redis hoặc cấu hình rate limit tại ingress/API
management để mọi replica dùng cùng quota.
