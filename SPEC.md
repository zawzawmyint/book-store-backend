# The Quiet Shelf API specification

## Purpose and current scope

Provide a GraphQL catalog and guest order-request API for the separate storefront. The API records requests but does not take payment or arrange delivery.

## HTTP surface

- `POST /graphql` accepts GraphQL operations. The schema in `src/graphql/schema.ts` is the authoritative field and type contract.
- `GET /health` returns `{ "status": "ok" }`.
- Browser access to `/graphql` is limited by the configured `FRONTEND_ORIGIN` CORS origin.

## Catalog

- `books(search, limit, offset)` returns `{ total, items }`. Defaults are `limit: 12` and `offset: 0`.
- Search trims the input and matches title, author, or genre as case-insensitive SQLite `LIKE` text. SQL wildcard characters in input are treated literally.
- The service accepts search text up to 100 characters, a whole-number limit from 1 to 24, and a nonnegative whole-number offset.
- `book(id)` returns one book or `null` when no matching numeric ID exists.
- Book prices are integer `priceCents` values. The database stores them as `price_cents`.

## Order requests

- `placeOrder(input)` accepts a customer name, email, and 1 to 20 distinct book lines. Each line has a book ID and quantity from 1 to 10.
- The server validates and normalizes the name and email, checks that books exist and have stock, and calculates the total from stored prices.
- In one SQLite transaction, the server writes the order and its line items and reduces stock. A failed validation or stock check leaves no partial order.
- The response contains an order ID, total in cents, and line titles, quantities, and unit prices.
- No authentication, payment, shipping, email notification, or order administration is implemented.

## Data and operation

- SQLite tables are `books`, `orders`, and `order_items`; versioned migrations run when the database opens.
- Development seeds twelve sample books once. Production does not seed automatically; `npm run db:seed` is explicit.
- `DATABASE_PATH`, `PORT`, `FRONTEND_ORIGIN`, and `NODE_ENV` are validated at startup. The database file is runtime data and is not committed.

## Acceptance checks

- `npm test` covers catalog queries, order pricing, stock rejection, transactional rollback, migration, seed behavior, and configuration validation.
- `npm run build` completes without TypeScript errors.
