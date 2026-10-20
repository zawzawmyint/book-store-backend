import type { InAppNotificationRow } from '../../database/store.types.js'
export type NotificationScope = 'STOREFRONT' | 'WORKSPACE'
export type NotificationHint = { recipientId: string; scope: NotificationScope }
export type NotificationKind = InAppNotificationRow['kind']
export type NotificationPayload = {
  version: 1
  bookTitle?: string
  stockAtEvent?: number
  refundPhase?: 'NONE' | 'PROCESSING' | 'SUPPORT' | 'COMPLETED'
  testPayment: boolean
}
