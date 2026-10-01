export const adminTypeDefs = `#graphql
  enum UserRole { CUSTOMER ADMIN }
  type Viewer { id: ID!, role: UserRole! }
  extend type Query { viewer: Viewer }
`
