import { expect, it, vi } from 'vitest'
import { createPermissionGuard, type Permission } from '../src/modules/admin/admin.authorization.js'

const user = { id: 'reader', name: 'Reader', email: 'reader@example.com' }
const permissions: Permission[] = [
  'MANAGE_CATALOG',
  'VIEW_ORDERS',
  'ARCHIVE_BOOKS',
  'MANAGE_USERS',
  'VIEW_ACTIVITY',
]

it('returns the authenticated user and rechecks their current role for every call', () => {
  const getRole = vi.fn().mockReturnValue('STAFF')
  const guard = createPermissionGuard(getRole)
  expect(guard(user, 'MANAGE_CATALOG')).toBe(user)
  getRole.mockReturnValue('CUSTOMER')
  expect(() => guard(user, 'MANAGE_CATALOG')).toThrow(
    expect.objectContaining({ extensions: { code: 'FORBIDDEN' } }),
  )
  expect(getRole).toHaveBeenCalledTimes(2)
})

it('keeps the exact workspace grants and denies unknown roles', () => {
  for (const role of ['ADMIN', 'STAFF', 'CUSTOMER', 'UNKNOWN', 'constructor', '__proto__']) {
    const guard = createPermissionGuard(() => role)
    for (const permission of permissions) {
      const allowed =
        role === 'ADMIN' ||
        (role === 'STAFF' && ['MANAGE_CATALOG', 'VIEW_ORDERS'].includes(permission))
      if (allowed) expect(() => guard(user, permission)).not.toThrow()
      else
        expect(() => guard(user, permission)).toThrow(
          expect.objectContaining({ extensions: { code: 'FORBIDDEN' } }),
        )
    }
  }
})

it('rejects guests before looking up a role', () => {
  const getRole = vi.fn()
  expect(() => createPermissionGuard(getRole)(null, 'VIEW_ORDERS')).toThrow(
    expect.objectContaining({ extensions: { code: 'UNAUTHENTICATED' } }),
  )
  expect(getRole).not.toHaveBeenCalled()
})
