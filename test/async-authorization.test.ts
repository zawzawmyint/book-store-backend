import { expect, it } from 'vitest'
import { createPermissionGuard } from '../src/modules/admin/admin.authorization.js'

const user = { id: 'staff-1', name: 'Staff', email: 'staff@example.com' }
it('awaits the current asynchronous role before granting permissions', async () => {
  const guard = createPermissionGuard(async () => 'STAFF')
  expect(await guard(user, 'PROCESS_ORDERS')).toEqual(user)
})
it('rejects revoked asynchronous permissions', async () => {
  const guard = createPermissionGuard(async () => 'CUSTOMER')
  await expect(guard(user, 'PROCESS_ORDERS')).rejects.toMatchObject({
    extensions: { code: 'FORBIDDEN' },
  })
})
