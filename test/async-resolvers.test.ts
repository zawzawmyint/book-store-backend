import { expect, it } from 'vitest'
import { createBookResolvers } from '../src/modules/books/book.resolvers.js'
import { createAdminOrderResolvers } from '../src/modules/orders/admin-order.resolvers.js'
import { ConflictError } from '../src/shared/errors.js'
import type { createAdminOrderRepository } from '../src/modules/orders/admin-order.repository.js'
import type { createAdminRepository } from '../src/modules/admin/admin.repository.js'

it('maps rejected asynchronous catalog validation to the existing GraphQL contract', async () => {
  const { books } = createBookResolvers({
    async listGenres() {
      return []
    },
    async getBook() {
      return null
    },
    async listBooks() {
      throw new ConflictError('Catalog changed')
    },
  })
  await expect((books as Function)(null, {}, {})).rejects.toMatchObject({
    message: 'Catalog changed',
    extensions: { code: 'CONFLICT' },
  })
})

it('does not execute a protected read until its asynchronous permission has resolved', async () => {
  let reads = 0
  const roles = {
    async getUserRole() {
      return 'CUSTOMER'
    },
  } as ReturnType<typeof createAdminRepository>
  const repository = {
    async list() {
      reads++
      return { total: 0, items: [] }
    },
  } as ReturnType<typeof createAdminOrderRepository>
  const { adminOrders } = createAdminOrderResolvers(repository, roles)
  await expect(
    (adminOrders as Function)(
      null,
      {},
      { user: { id: 'revoked', name: 'User', email: 'user@example.com' } },
    ),
  ).rejects.toMatchObject({ extensions: { code: 'FORBIDDEN' } })
  expect(reads).toBe(0)
})
