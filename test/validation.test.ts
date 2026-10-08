import { describe, expect, it, vi } from 'vitest'
import { createBookService } from '../src/modules/books/book.service.js'
import { createOrderService } from '../src/modules/orders/order.service.js'
import { ValidationError } from '../src/shared/errors.js'
import { checkoutInputSchema } from '../src/modules/payments/payment.validation.js'
import { validated } from '../src/shared/validation.js'

describe('service input validation', () => {
  const valid = {
    items: [{ bookId: '1', quantity: 1 }],
  }
  const customer = { id: 'user-1', name: 'Ada Reader', email: 'ada@example.com' }
  it('normalizes catalog search', () => {
    const listBooks = vi.fn(() => ({ total: 0, items: [] }))
    createBookService({ listBooks, listGenres: () => [], getBook: () => null }).listBooks(
      '  Gatsby  ',
    )
    expect(listBooks).toHaveBeenCalledWith('Gatsby', 12, 0)
  })
  it('reports the first catalog validation issue before querying', () => {
    const listBooks = vi.fn()
    const service = createBookService({ listBooks, listGenres: () => [], getBook: () => null })
    expect(() => service.listBooks('x'.repeat(101), 0, -1)).toThrow(
      'Too big: expected string to have <=100 characters',
    )
    expect(listBooks).not.toHaveBeenCalled()
  })
  it('preserves nullable public lookups and leading-zero IDs before querying', async () => {
    const getBook = vi.fn(() => null)
    const service = createBookService({ listBooks: vi.fn(), listGenres: () => [], getBook })
    for (const id of ['', 'abc', '-1', '1.5', ' 1 ']) {
      expect(await service.getBook(id)).toBeNull()
    }
    expect(getBook).not.toHaveBeenCalled()
    await service.getBook('01')
    expect(getBook).toHaveBeenCalledWith('01')
  })
  it.each([
    { items: [] },
    { items: Array.from({ length: 21 }, (_, i) => ({ bookId: String(i), quantity: 1 })) },
    { items: [{ bookId: '1', quantity: 0 }] },
    { items: [{ bookId: '1', quantity: 11 }] },
    { items: [{ bookId: '1', quantity: 1.5 }] },
    { items: [{ bookId: 'invalid', quantity: 1 }] },
    {
      items: [
        { bookId: '1', quantity: 1 },
        { bookId: '1', quantity: 1 },
      ],
    },
  ])('rejects invalid order input before writes: %j', (override) => {
    expect(() =>
      validated(checkoutInputSchema, {
        ...valid,
        ...override,
        requestKey: '00000000-0000-4000-8000-000000000001',
      }),
    ).toThrow(ValidationError)
  })

  it.each([
    { limit: 0, offset: 0 },
    { limit: 51, offset: 0 },
    { limit: 20, offset: -1 },
  ])('rejects invalid account order pagination: %j', ({ limit, offset }) => {
    const listOrders = vi.fn()
    expect(() =>
      createOrderService({ getOrderForUser: vi.fn(), saveOrder: vi.fn(), listOrders }).myOrders(
        customer.id,
        limit,
        offset,
      ),
    ).toThrow(ValidationError)
    expect(listOrders).not.toHaveBeenCalled()
  })
})
