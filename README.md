# The Quiet Shelf API

An Express + GraphQL + SQLite backend for a small bookstore learning project. This folder is its own Git repository and runs independently from the frontend.

## Start

Requires Node.js 24 or later.

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

The API starts at `http://localhost:4000/graphql`; `GET /health` returns a small health response. The SQLite file is created under `data/` on first start and the schema is migrated to version 1. In development, twelve sample books are seeded once. With `NODE_ENV=production`, the catalog starts empty unless you explicitly run `npm run db:seed`. `data/` is ignored by Git. Set `PORT`, `DATABASE_PATH`, and `FRONTEND_ORIGIN` in `.env` for your environment.

## GraphQL examples

Run these in the GraphQL explorer at `/graphql`:

```graphql
query BrowseBooks {
  books(search: "Gothic Fiction", limit: 12, offset: 0) {
    total
    items {
      id
      title
      author
      priceCents
      stock
    }
  }
}
```

```graphql
mutation BuyBooks {
  placeOrder(
    input: {
      customerName: "Demo Reader"
      email: "demo@example.com"
      items: [{ bookId: "1", quantity: 1 }]
    }
  ) {
    id
    totalCents
    items {
      title
      quantity
      unitPriceCents
    }
  }
}
```

The catalog query reads SQLite. The order mutation validates the request, reads current prices, checks stock, and writes the order and stock changes in one transaction. The browser never supplies an order total. No REST catalog or checkout API is required. The only non-GraphQL route is `/health`.

## Code layout

- [`src/server.ts`](src/server.ts) loads configuration and owns startup and shutdown.
- [`src/db.ts`](src/db.ts) creates the SQLite connection and schema; [`src/seed.ts`](src/seed.ts) adds optional demo data.
- [`src/catalog.ts`](src/catalog.ts) reads books; [`src/orders.ts`](src/orders.ts) validates and saves orders.
- [`src/graphql.ts`](src/graphql.ts) defines the API contract and maps service errors to GraphQL errors; [`src/app.ts`](src/app.ts) configures Express and Apollo.

## Why no ORM?

This project has three small tables and a few queries. Parameterized SQL in the catalog and order modules makes the data flow easy to see. An ORM such as Drizzle becomes useful when the schema and query layer grow; it is not needed here.

## Checks

```powershell
npm test
npm run build
```

Tests run against a temporary in-memory SQLite database. This is a **demo checkout**: it stores guest details locally but takes no payment, sends no email, and has no order administration. Add authentication, operational controls, and a payment provider before adapting it for real sales.
