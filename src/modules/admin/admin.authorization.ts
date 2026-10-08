import { GraphQLError } from 'graphql'
import type { AuthenticatedUser } from '../../graphql/context.js'
import { requireUser } from '../../shared/authentication.js'

export type Permission =
  | 'PROCESS_ORDERS'
  | 'MANAGE_CATALOG'
  | 'VIEW_ORDERS'
  | 'ARCHIVE_BOOKS'
  | 'MANAGE_USERS'
  | 'VIEW_ACTIVITY'

const rolePermissions: Readonly<Record<'ADMIN' | 'STAFF' | 'CUSTOMER', readonly Permission[]>> = {
  ADMIN: [
    'PROCESS_ORDERS',
    'MANAGE_CATALOG',
    'VIEW_ORDERS',
    'ARCHIVE_BOOKS',
    'MANAGE_USERS',
    'VIEW_ACTIVITY',
  ],
  STAFF: ['PROCESS_ORDERS', 'MANAGE_CATALOG', 'VIEW_ORDERS'],
  CUSTOMER: [],
}

export function createPermissionGuard(getRole: (id: string) => Promise<string>) {
  return async (
    user: AuthenticatedUser | null,
    permission: Permission,
  ): Promise<AuthenticatedUser> => {
    const authenticated = requireUser(user)
    const role = await getRole(authenticated.id)
    const allowed = Object.hasOwn(rolePermissions, role)
      ? rolePermissions[role as keyof typeof rolePermissions]
      : []
    if (!allowed.includes(permission)) {
      throw new GraphQLError('Permission required', { extensions: { code: 'FORBIDDEN' } })
    }
    return authenticated
  }
}
