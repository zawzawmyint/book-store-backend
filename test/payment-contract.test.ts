import { expect, it } from 'vitest'
import { createDatabase } from '../src/database/connection.js'
import { seedBooks } from '../src/database/seed.js'
import { createOrderService } from '../src/modules/orders/order.service.js'
import { createOrderRepository } from './delivery-fixtures.js'

it('rejects deprecated unpaid placement without changing stock', () => {
  const db = createDatabase(':memory:')
  try {
    seedBooks(db)
    db.exec("INSERT INTO user (id,name,email) VALUES ('buyer','Buyer','buyer@example.com')")
    const before = db.prepare('SELECT stock FROM books').all()
    expect(() =>
      createOrderService(createOrderRepository(db)).placeOrder(
        { items: [{ bookId: '1', quantity: 1 }] },
        { id: 'buyer', name: 'Buyer', email: 'buyer@example.com' },
      ),
    ).toThrow('createCheckout')
    expect(db.prepare('SELECT stock FROM books').all()).toEqual(before)
  } finally {
    db.close()
  }
})

it('defaults fresh orders to payment-required pending without legacy values', () => {
  const db = createDatabase(':memory:')
  try {
    db.exec(
      "INSERT INTO orders(customer_name,email,subtotal_cents,delivery_fee_cents,total_cents) VALUES ('Buyer','buyer@example.com',100,0,100)",
    )
    expect(db.prepare('SELECT payment_required,payment_status FROM orders').get()).toEqual({
      payment_required: 1,
      payment_status: 'PENDING',
    })
    expect(() => db.exec("UPDATE orders SET payment_status='LEGACY_UNPAID'")).toThrow()
  } finally {
    db.close()
  }
})
