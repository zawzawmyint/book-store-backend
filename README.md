# The Quiet Shelf API

An Express + GraphQL + SQLite bookstore API. This folder is its own Git repository and runs independently from the frontend.

See [SPEC.md](SPEC.md) for the implemented API behavior and current scope.

## Start

Requires Node.js 24 or later.

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

The API starts at `http://localhost:4000/graphql`; `GET /health` returns a health response. SQLite migrations run on startup. Development seeds twelve catalog books once; production does not seed automatically. Use `npm run db:seed` only when you intentionally want the sample catalog. The `data/` directory is ignored by Git. Configure `PORT`, `DATABASE_PATH`, `FRONTEND_ORIGIN`, and `NODE_ENV` in `.env`.

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
      customerName: "Ada Reader"
      email: "ada@example.com"
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

The order mutation validates the request, reads current prices, checks stock, and saves the order and stock changes in one SQLite transaction. The browser never supplies an order total. The GraphQL endpoint is the catalog and order API; `/health` is the only REST route.

## Architecture

GraphQL resolvers play the **controller** role in MVC: they receive API requests and translate application errors into GraphQL errors. Services enforce business rules. Repositories contain SQL. The React repository contains the views.

```text
src/
  app.ts                 Express and Apollo setup
  server.ts              Process startup and shutdown
  config/env.ts          Environment validation
  database/
    connection.ts        SQLite connection
    migrations.ts        Versioned schema migrations
    seed.ts              Optional catalog seed
  graphql/
    schema.ts            Public GraphQL contract
    resolvers.ts         Controller layer
  modules/
    books/
      book.service.ts    Catalog input rules
      book.repository.ts Catalog SQL
    orders/
      order.types.ts     Shared order input contract
      order.service.ts   Order input rules
      order.repository.ts Transactional order SQL
  shared/errors.ts       Application validation error
test/                     API and database integration tests
```

## Why no ORM?

An ORM is optional, including in production. This schema has three tables and a small number of queries, so repositories use parameterized SQL and versioned migrations. Drizzle would be reasonable when schema changes and query complexity justify the additional dependency.

## Checks

```powershell
npm test
npm run build
```

Tests run against an in-memory SQLite database. This API records **order requests** without payment or delivery. Before accepting real customer orders, add payment or fulfillment, customer communication, operational monitoring, and deployment specific security controls.
