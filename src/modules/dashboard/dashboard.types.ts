import type { OrderPayment } from '../payments/payment.types.js'
import type { OrderStatus } from '../orders/order.types.js'

export type DashboardOrderSummary = {
  id: string
  customerName: string
  createdAt: string
  totalCents: number
  status: OrderStatus
  payment: OrderPayment
}
export type DashboardStatusCount = { status: OrderStatus; count: number }
export type WorkspaceDashboardData = {
  fulfillment: DashboardStatusCount[]
  awaitingPreparation: DashboardOrderSummary[]
  readyToShip: DashboardOrderSummary[]
  recentOrders: DashboardOrderSummary[]
  lowStockCount: number
  outOfStockCount: number
  stockAlerts: { id: string; title: string; stock: number }[]
}
export type DashboardPaymentDay = {
  date: string
  capturedCents: string
  refundedCents: string
  paidOrderCount: number
}
export type DashboardFinanceData = {
  days: DashboardPaymentDay[]
  failedRefundCount: number
  failedRefundOrders: DashboardOrderSummary[]
}
export type DashboardRange = {
  start: string
  end: string
  startDate: string
  endDate: string
  dates: string[]
}
