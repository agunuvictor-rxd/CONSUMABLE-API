# Consumable API — Food Delivery Market

A production-grade, consumable REST API for a Food Delivery Market domain with
`restaurants`, `menu_items`, and `orders` (+ nested `order_items`). Built with
Node.js, Express, and SQLite (`node:sqlite` — zero native compile steps).

All primary keys are generated UUIDs (`TEXT` columns), never sequential integers.

## Quick start

```bash
npm install
npm run seed      # idempotent — safe to re-run, never duplicates
npm start         # starts on http://localhost:3000
```

Open http://localhost:3000 to view the consumer frontend, or hit the API at
`http://localhost:3000/api/v1/...`.

### Environment variables (optional)

| Variable            | Default                      | Description                                              |
| ------------------- | ---------------------------- | -------------------------------------------------------- |
| `API_BASE_URL`      | `http://localhost:3000`      | Public API URL injected into the consumer frontend       |
| `PORT`              | `3000` (from config file)    | HTTP port                                                |
| `HOST`              | `0.0.0.0` (from config file) | Bind address                                             |
| `DATABASE_PATH`     | `./data/app.db` (gitignored) | SQLite database file; `:memory:` for in-memory           |
| `TRUST_PROXY`       | `false`                      | Set `true` behind a reverse proxy for correct client IP  |
| `DEFAULT_PAGE_LIMIT`| `20`                         | Pagination default limit                                 |
| `MAX_PAGE_LIMIT`    | `100`                        | Pagination hard cap                                      |
| `RATE_LIMIT_MAX`    | `100`                        | Requests per IP per `60s` window                         |
| `MAX_PRICE`         | `1000000` (from config file) | Upper bound for a menu-item price                        |
| `MAX_ITEM_QUANTITY` | `1000` (from config file)    | Upper bound for an order line quantity                   |
| `MAX_DELIVERY_FEE`  | `1000` (from config file)    | Upper bound for an order delivery fee                    |

## Configuration file

Rate-limit and pagination defaults live in
[`config/app.config.json`](config/app.config.json), **not** in route handlers:

```json
{
  "pagination": { "defaultLimit": 20, "maxLimit": 100 },
  "rateLimit":   { "windowMs": 60000, "max": 100 },
  "limits":      { "maxPrice": 1000000, "maxItemQuantity": 1000, "maxDeliveryFee": 1000 },
  "seed":        { "counts": { "restaurants": 150, "menuItemsPerRestaurant": 4, "orders": 300 } }
}
```

## Seed script

`scripts/seed.js` loads a few hundred realistic records per resource using
`@faker-js/faker` (150 restaurants, 600 menu items, 300 orders, ~735 order
lines). Every row's `id` is a deterministic UUID derived from a logical key
(`uuidFromKey`, RFC-4122 v5 style) and written with `INSERT ... ON CONFLICT(id)
DO UPDATE`, so running the script any number of times yields identical rows and
**never creates duplicates**. No raw DB dump is committed; the SQLite file lives
under `data/` which is gitignored.

## API

Base path: `/api/v1`

### Success envelope (collections)

```json
{
  "data": [ ... ],
  "meta": { "total": 12, "limit": 2, "offset": 0, "hasMore": true }
}
```

Single-resource/created responses use `{ "data": { ... } }`; deletes return `204`.

Every collection endpoint supports:

- pagination `?limit=` (default 20, max 100) & `?offset=`
- filtering on ≥2 fields (per resource, below)
- sorting `?sort=field&order=asc|desc` (whitelisted fields per resource)
- unknown query parameters return `400 BAD_REQUEST`

### Error envelope

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Missing required field(s): name" } }
```

| HTTP | Code                | When                                                    |
| ---- | ------------------- | ------------------------------------------------------- |
| 400  | `BAD_REQUEST`       | Bad/malformed query params, body types, invalid UUIDs   |
| 404  | `NOT_FOUND`         | Unknown route or missing resource by id                 |
| 409  | `CONFLICT`          | Delete blocked by references                            |
| 413  | `PAYLOAD_TOO_LARGE` | Body > 100kb                                            |
| 422  | `VALIDATION_ERROR`  | Missing required body fields                            |
| 429  | `RATE_LIMITED`      | Over IP rate limit (100 req/min)                        |
| 500  | `INTERNAL_ERROR`    | Unexpected                                              |

### Rate limiting

IP-based fixed window, **100 requests per minute** (values in
`config/app.config.json`). When exceeded returns `429` with a `Retry-After`
header (seconds) plus `X-RateLimit-*` headers.

### Resources

#### `GET|POST /restaurants`
Filters: `cuisine`, `city`, `is_open`, `min_rating`, `search`.
Sortable: `name`, `cuisine`, `city`, `rating`, `price_range`, `created_at`, `updated_at`.

#### `GET|PATCH|DELETE /restaurants/:id`

#### `GET|POST /restaurants/:id/menu-items` (nested)
Filters: `category`, `is_available`, `min_price`, `max_price`, `search`.

#### `GET|POST /restaurants/:id/orders` (nested)
`POST` creates an order scoped to that restaurant; sending `restaurant_id` in the
body is rejected with `400`.

#### `GET|POST /menu-items`, `GET|PATCH|DELETE /menu-items/:id`
Filters: `restaurant_id`, `category`, `is_available`, `min_price`, `max_price`, `search`.

#### `GET|POST /orders`, `GET|PATCH|DELETE /orders/:id`
Filters: `status`, `restaurant_id`, `customer`, `placed_from`, `placed_to`, `min_total`.
Create accepts `items: [{ menu_item_id, quantity }]`; totals are computed from
menu-item prices.

#### `GET|POST /orders/:id/items`, `GET|PATCH|DELETE /orders/:id/items/:itemId`
Filters: `menu_item_id`, `item_name`, `min_quantity`, `min_line_total`.

### Order lines and totals

A menu item may appear **at most once** on a given order:

- `POST /orders` merges repeated `menu_item_id` entries in `items` into a single
  line whose `quantity` is their sum.
- `POST /orders/:id/items` returns `409 CONFLICT` when that menu item is already
  on the order — patch the existing line's `quantity` instead.

`subtotal`, `total`, `unit_price`, and `line_total` are rounded to 2 decimal
places, so sums such as `0.1 + 0.2` are exposed as `0.3`, never as
`0.30000000000000004`.

Rounding **throws** on a non-finite input rather than coercing it to `0` —
silently turning a bad number into a zero price would corrupt an order
unnoticed. Magnitudes are therefore also bounded at validation time
(`limits` in `config/app.config.json`): a `price`, `quantity`, or `delivery_fee`
above its maximum is rejected with `400 BAD_REQUEST` before any arithmetic runs,
so an overflowing product is rejected at the edge instead of failing mid-write.

### Order status transitions

`PATCH /orders/:id` validates the requested status against a state machine and
returns `409 CONFLICT` for an illegal transition. Setting a status to its current
value is a no-op and always allowed.

| From              | May become                       |
| ----------------- | -------------------------------- |
| `pending`         | `confirmed`, `cancelled`         |
| `confirmed`       | `preparing`, `cancelled`         |
| `preparing`       | `out_for_delivery`, `cancelled`  |
| `out_for_delivery`| `delivered`, `cancelled`         |
| `delivered`       | — (terminal)                     |
| `cancelled`       | — (terminal)                     |

### Example

```bash
curl "http://localhost:3000/api/v1/restaurants?cuisine=Italian&limit=5&sort=rating&order=desc"
```

## Consumer app

`public/index.html` is a single-page consumer that reads the deployed public API
URL injected from the `API_BASE_URL` environment variable via `/config.js`
(`window.__API_BASE_URL__`). It renders the restaurant list, a **cuisine filter
dropdown**, and a **"Next page"** pagination button, and shows
`total/limit/offset/hasMore` from the response meta.

## Tests

```bash
npm test     # node --test
```

26 tests cover envelopes, pagination, filtering, sorting, 400/404/409/422/429
status codes, nested resources, totals computation, `Retry-After`, and seed
idempotency (running the seed twice produces identical counts). They also lock in
money rounding, duplicate order-line merging, the order status state machine, the
nested `POST /restaurants/:id/orders` route, and rejection of non-finite or
out-of-range monetary input.