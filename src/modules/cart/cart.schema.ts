export const cartTypeDefs = `
  enum CartMergeNoticeReason { UNAVAILABLE QUANTITY_LIMIT LINE_LIMIT }
  type CartMergeNotice { bookId: ID! reason: CartMergeNoticeReason! }
  type AccountCartItem { bookId: ID! quantity: Int! lineVersion: String! title: String! author: String! genre: String! priceCents: Int! stock: Int! available: Boolean! }
  type AccountCart { revision: String! items: [AccountCartItem!]! mergeNotices: [CartMergeNotice!]! }
  input SetCartItemInput { bookId: ID! quantity: Int! expectedRevision: String! requestKey: String! }
  input MergeGuestCartInput { items: [OrderItemInput!]! expectedRevision: String! requestKey: String! }
  extend type Query { myCart: AccountCart! }
  extend type Mutation { setCartItem(input: SetCartItemInput!): AccountCart! mergeGuestCart(input: MergeGuestCartInput!): AccountCart! }
`
