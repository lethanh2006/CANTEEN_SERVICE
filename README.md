# NRApp Canteen Service

The NRApp Canteen Service is a NestJS service for employee table ordering. It
owns the menu, categories, tables, and order lifecycle; clients access it
through the API Gateway.

## Current scope

- Public menu and category browsing, including menu search.
- Admin management of menu items, categories, and tables.
- Employee orders tied to a table, with server-side price and option resolution.
- Cash settlement by an administrator and cancellation of eligible orders.
- Menu undo/redo history backed by Redis.
- Automatic creation of 20 default tables on first startup without overwriting
  existing table data.

The service currently supports `CASH` orders only. It does not contain kitchen,
warehouse, ingredient, automatic table assignment, discount/subsidy, QR payment,
RabbitMQ, or outbox modules.

## Order rules

The server reads item prices and option prices from MongoDB; the client sends item
IDs, quantities, and selected option names. New orders use:

- `status`: `CREATED`, `COMPLETED`, or `CANCELLED`
- `paymentStatus`: `PENDING` or `PAID`
- `paymentMethod`: `CASH`

A table remains occupied while it has an unsettled order. It is released only
when no non-cancelled order on that table remains unpaid.

## HTTP API

All routes are under `/api/canteen` and are exposed through the Gateway.

| Routes | Access | Purpose |
| --- | --- | --- |
| `GET /menu`, `GET /menu/search` | Public | Browse and search available menu items |
| `GET /categories`, `GET /categories/:id` | Public | Browse active categories |
| `GET /admin/menu` | Admin | Read the complete menu, including hidden records |
| `POST/PUT/DELETE /admin/menu...` | Admin | Manage menu items |
| `POST /admin/menu/undo`, `POST /admin/menu/redo` | Admin | Undo or redo menu changes |
| `POST /orders` | Authenticated | Create a cash order |
| `GET /orders/my-orders` | Authenticated | Read the current user's orders |
| `GET /orders/:id` | Authenticated | Read an order allowed for the current user |
| `PATCH /orders/:id/cancel` | Owner or admin | Cancel an eligible order |
| `GET /orders` | Admin | Filter and paginate operational orders |
| `PATCH /orders/:id/payment/cash` | Admin | Mark an order as paid and completed |
| `GET /tables` and `GET /tables/:id` | Authenticated | Read table status |
| `POST/PATCH/DELETE /tables...` | Admin | Create, update, delete, and change table status |
| `POST/PATCH/DELETE /categories...` | Admin | Manage categories |

`GET /health/live` (also `/health`) reports process liveness. The readiness
endpoint reports MongoDB and Redis status and returns an unavailable response
when either dependency is down.

## Gateway trust and security

The Gateway forwards the authenticated user as a signed payload. In production,
`CANTEEN_INTERNAL_SECRET` is required and must match the Gateway secret; the
service rejects missing, expired, or invalid signatures. Local development can
leave `CANTEEN_REQUIRE_SIGNATURE=false` while testing direct requests.

## Configuration

Copy `.env.example` to `.env`:

```env
PORT=5005
MONGO_URL=mongodb://localhost:27017/nrapp
REDIS_URL=redis://127.0.0.1:6379
CANTEEN_INTERNAL_SECRET=replace_with_a_long_random_shared_secret
CANTEEN_REQUIRE_SIGNATURE=false
CANTEEN_SIGNATURE_MAX_AGE_MS=300000
```

`LOG_LEVEL`, `LOG_FORMAT`, and `DEPLOYMENT_ENVIRONMENT` configure application
logging. Do not commit a real `.env` file.

## Local development

The service uses the local Logger observability package. Keep Logger beside this
repository in the backend directory, then run:

```bash
npm ci --prefix ../logger/packages/observability --no-audit --no-fund
npm ci
cp .env.example .env
npm run start:dev
```

Quality and data-contract checks:

```bash
npm run lint
npm run format:check
npm test
npm run build
npm run check:indexes
```

`check:indexes` starts a temporary MongoDB container and validates the indexes and
important order/table concurrency paths.

More detailed contract notes are available in [the request lifecycle guide](docs/request-lifecycle.md) and [the database index guide](docs/database-indexes.md).

## CI/CD

`.github/workflows/ci.yml` calls the pinned reusable Node.js workflow from
[Logger](https://github.com/lethanh2006/Logger). A successful push to the default
branch triggers `.github/workflows/cd.yml` and deploys the exact commit through
the pinned VPS workflow. See [.github/CI.md](.github/CI.md) for the release details.
