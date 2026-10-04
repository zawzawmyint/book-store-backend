export const adminTypeDefs = `#graphql
  enum UserRole { CUSTOMER ADMIN }
  type Viewer { id: ID!, role: UserRole! }
  enum AdminCustomerRoleFilter { ALL CUSTOMER ADMIN }
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
    adminCustomers(
      search: String
      role: AdminCustomerRoleFilter = ALL
      limit: Int = 20
      offset: Int = 0
    ): AdminCustomersPage!
    adminCustomer(id: ID!): AdminCustomer!
  }
  extend type Mutation {
    setCustomerAdminAccess(userId: ID!, enabled: Boolean!): AdminCustomer!
    resetCustomerPassword(userId: ID!, newPassword: String!): AdminCustomer!
  }
`
