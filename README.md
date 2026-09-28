# The Quiet Shelf API

An Express + GraphQL + SQLite backend for a small bookstore learning project. This folder is its own Git repository and runs independently from the frontend.

## Start

Requires Node.js 24 or later.

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

The API starts at `http://localhost:4000/graphql`; `GET /health` returns a small health response. The SQLite file is created under `data/` on first start, the schema is migrated to version 1, and twelve sample books are seeded. `data/` is ignored by Git. Change `PORT`, `DATABASE_PATH`, or `FRONTEND_ORIGIN` in `.env` if needed.

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

## Why no ORM?

This project has three small tables and a few queries. Parameterized SQL in [`src/store.ts`](src/store.ts) makes the resolver-to-database connection easy to see. An ORM such as Drizzle becomes useful when the schema and query layer grow; it is not needed here.

## Checks

```powershell
npm test
npm run build
```

Tests run against a temporary in-memory SQLite database. This is a **demo checkout**: it stores guest details locally but takes no payment, sends no email, and has no order administration. Add authentication, operational controls, and a payment provider before adapting it for real sales.
