export const activityTypeDefs = `#graphql
  enum ActivityAction { BOOK_CREATED BOOK_UPDATED BOOK_STOCK_ADJUSTED BOOK_ARCHIVED BOOK_RESTORED USER_ROLE_CHANGED USER_PASSWORD_RESET ORDER_STATUS_CHANGED ORDER_PAYMENT_CHANGED }
  enum ActivityField { TITLE AUTHOR GENRE DESCRIPTION PRICE_CENTS STOCK ARCHIVED ROLE ORDER_STATUS ORDER_PAYMENT_STATUS }
  enum ActivityTargetType { BOOK USER ORDER }
  enum ActivitySource { GRAPHQL OPERATOR SYSTEM }
  type ActivityChange { field: ActivityField!, before: String, after: String }
  type ActivityEvent { id: ID!, actorUserId: ID, actorName: String!, actorRole: UserRole, actorType: ActorType!, source: ActivitySource!, action: ActivityAction!, targetType: ActivityTargetType!, targetId: ID!, targetName: String!, changes: [ActivityChange!]!, stockDelta: Int, createdAt: String! }
  type ActivityPage { total: Int!, items: [ActivityEvent!]! }
  extend type Query { adminActivity(actorUserId: ID, action: ActivityAction, changedField: ActivityField, targetType: ActivityTargetType, targetId: ID, from: String, to: String, limit: Int, offset: Int): ActivityPage! }
`
