import { deliveryAddress, deliveryOptions } from './delivery-fixtures.js'
import { createPaymentRepository } from '../src/modules/payments/payment.repository.js'
import { expect, it, vi } from 'vitest'
import { createDatabase } from '../src/database/connection.js'
import { seedBooks } from '../src/database/seed.js'
import { createPaymentService } from '../src/modules/payments/payment.service.js'
import { startPaymentWorker } from '../src/modules/payments/payment.worker.js'
import { FakePaymentProvider } from './fake-payment-provider.js'
it('recovers durable unknown operations every 60 seconds and catches expiry on startup after stop', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-07T00:00:00Z'))
  const db = createDatabase(':memory:')
  let stop: undefined | (() => Promise<void>)
  try {
    seedBooks(db)
    db.exec("INSERT INTO user(id,name,email) VALUES ('buyer','Buyer','buyer@example.com')")
    const provider = new FakePaymentProvider(),
      customer = {
        id: 'buyer',
        name: 'Buyer',
        email: 'buyer@example.com',
      }
    const service = createPaymentService(createPaymentRepository(db, Date.now), {
      provider,
      ...deliveryOptions,
      frontendOrigin: 'http://localhost:5173',
    })
    provider.uncertainCreate = true
    await expect(
      service.createCheckout(
        {
          requestKey: '00000000-0000-4000-8000-000000000001',
          deliveryAddress,
          expectedDeliveryFeeCents: 500,
          expectedTotalCents: 2199,
          items: [
            {
              bookId: '1',
              quantity: 1,
            },
          ],
        },
        customer,
      ),
    ).rejects.toThrow('unavailable')
    stop = startPaymentWorker(service)
    await vi.advanceTimersByTimeAsync(59000)
    expect(db.prepare('SELECT state FROM payment_operations').get()).toEqual({
      state: 'PENDING',
    })
    await vi.advanceTimersByTimeAsync(1000)
    expect(db.prepare('SELECT state FROM payment_operations').get()).toEqual({
      state: 'DONE',
    })
    expect(provider.sessions.size).toBe(1)
    await stop()
    stop = undefined
    await vi.advanceTimersByTimeAsync(1861000)
    expect((await service.readOrder('1', customer)).payment.status).toBe('PENDING')
    stop = startPaymentWorker(service)
    await vi.advanceTimersByTimeAsync(0)
    expect(await service.readOrder('1', customer)).toMatchObject({
      status: 'CANCELLED',
      payment: {
        status: 'EXPIRED',
      },
    })
    expect(db.prepare('SELECT stock FROM books WHERE id=1').get()).toEqual({
      stock: 12,
    })
  } finally {
    await stop?.()
    db.close()
    vi.useRealTimers()
  }
})
