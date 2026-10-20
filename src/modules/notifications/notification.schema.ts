export const notificationTypeDefs = `#graphql
 enum NotificationScope { STOREFRONT WORKSPACE }
 enum InAppNotificationKind { PAYMENT_CONFIRMED ORDER_ACCEPTED ORDER_SHIPPED ORDER_DELIVERED ORDER_CANCELLED REFUND_COMPLETED NEW_PAID_ORDER STOCK_LOW STOCK_OUT REFUND_FAILED }
 enum NotificationResourceType { ORDER BOOK }
 enum NotificationRefundPhase { NONE PROCESSING SUPPORT COMPLETED }
 type InAppNotification { id:ID! kind:InAppNotificationKind! scope:NotificationScope! createdAt:String! readAt:String resourceType:NotificationResourceType! resourceId:ID! bookTitle:String stockAtEvent:Int refundPhase:NotificationRefundPhase testPayment:Boolean! }
 type NotificationPageInfo { endCursor:String hasNextPage:Boolean! }
 type InAppNotificationConnection { nodes:[InAppNotification!]! pageInfo:NotificationPageInfo! }
 type NotificationReadResult { changedCount:Int! }
 extend type Query {
 notifications(scope:NotificationScope!,first:Int=20,after:String,unreadOnly:Boolean=false):InAppNotificationConnection!
 notificationUnreadCount(scope:NotificationScope!):Int!
 }
 extend type Mutation {
 markNotificationRead(id:ID!,scope:NotificationScope!):InAppNotification!
 markAllNotificationsRead(scope:NotificationScope!):NotificationReadResult!
 }
`
