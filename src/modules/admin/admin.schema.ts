export const adminTypeDefs = `#graphql
  enum UserRole { CUSTOMER STAFF ADMIN }
  type Viewer { id: ID!, role: UserRole! }
  enum AdminUserRoleFilter { ALL CUSTOMER STAFF ADMIN }
  type AdminUser {
    id: ID!
    name: String!
    email: String!
    role: UserRole!
    createdAt: String!
  }
  type AdminUsersPage { total: Int!, items: [AdminUser!]! }
  # Compatibility types retained for clients using the deprecated fields.
  enum AdminCustomerRoleFilter { ALL CUSTOMER STAFF ADMIN }
  type AdminCustomer {
    id: ID!
    name: String!
    email: String!
    role: UserRole!
    createdAt: String!
  }
  type AdminCustomersPage { total: Int!, items: [AdminCustomer!]! }
  extend type Query {
    viewer: Viewer
    adminUsers(
      search: String
      role: AdminUserRoleFilter = ALL
      limit: Int = 20
      offset: Int = 0
    ): AdminUsersPage!
    adminUser(id: ID!): AdminUser!
    adminCustomers(
      search: String
      role: AdminCustomerRoleFilter = ALL
      limit: Int = 20
      offset: Int = 0
    ): AdminCustomersPage! @deprecated(reason: "Use adminUsers with AdminUserRoleFilter.")
    adminCustomer(id: ID!): AdminCustomer! @deprecated(reason: "Use adminUser.")
  }
  extend type Mutation {
    setUserRole(userId: ID!, role: UserRole!): AdminUser!
    setUserAdminAccess(userId: ID!, enabled: Boolean!): AdminUser! @deprecated(reason: "Use setUserRole.")
    resetUserPassword(userId: ID!, newPassword: String!): AdminUser!
    setCustomerAdminAccess(userId: ID!, enabled: Boolean!): AdminCustomer! @deprecated(reason: "Use setUserRole (replaces setUserAdminAccess).")
    resetCustomerPassword(userId: ID!, newPassword: String!): AdminCustomer! @deprecated(reason: "Use resetUserPassword.")
  }
`
