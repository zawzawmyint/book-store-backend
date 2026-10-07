import type Database from 'better-sqlite3'
// Saved snapshots use an explicitly deducted inventory unit and initial workflow event.
export function seedSubmittedOrder(
  db: Database.Database,
  input: { userId?: string; name: string; email: string; totalCents: number; createdAt?: string },
) {
  return db.transaction(() => {
    const book = db
      .prepare(
        "INSERT INTO books(title,author,genre,description,price_cents,stock) VALUES ('Fixture book','Author','Genre','Description',?,9)",
      )
      .run(input.totalCents)
    const order = db
      .prepare(
        "INSERT INTO orders(user_id,customer_name,email,total_cents,status,created_at) VALUES (?,?,?,?,'SUBMITTED',?)",
      )
      .run(
        input.userId ?? null,
        input.name,
        input.email,
        input.totalCents,
        input.createdAt ?? '2026-10-01 10:00:00',
      )
    db.prepare(
      "INSERT INTO order_items(order_id,book_id,title,quantity,unit_price_cents) VALUES (?,?,'Fixture book',1,?)",
    ).run(order.lastInsertRowid, book.lastInsertRowid, input.totalCents)
    db.prepare(
      "INSERT INTO order_status_events(order_id,to_status,actor_user_id,actor_name,actor_role) VALUES (?,'SUBMITTED',?,?,'CUSTOMER')",
    ).run(order.lastInsertRowid, input.userId ?? null, input.name)
    return String(order.lastInsertRowid)
  })()
}
