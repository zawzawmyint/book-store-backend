export const dashboardTypeDefs = `#graphql
  enum DashboardPeriod { DAYS_7 DAYS_30 DAYS_90 }
  type DashboardStatusCount { status: OrderStatus!, count: Int! }
  type DashboardOrderSummary {
    id: ID!, customerName: String!, createdAt: String!, totalCents: Int!,
    status: OrderStatus!, payment: OrderPayment!
  }
  type DashboardStockBook { id: ID!, title: String!, stock: Int! }
  type WorkspaceDashboard {
    generatedAt: String!, fulfillment: [DashboardStatusCount!]!,
    awaitingPreparation: [DashboardOrderSummary!]!, readyToShip: [DashboardOrderSummary!]!,
    recentOrders: [DashboardOrderSummary!]!, lowStockCount: Int!, outOfStockCount: Int!,
    stockAlerts: [DashboardStockBook!]!
  }
  type DashboardPaymentDay { date: String!, capturedCents: String!, refundedCents: String!, paidOrderCount: Int! }
  type DashboardFinance {
    generatedAt: String!, period: DashboardPeriod!, timeZone: String!, startDate: String!,
    endDate: String!, currency: String!, capturedCents: String!, refundedCents: String!,
    netCents: String!, paidOrderCount: Int!, days: [DashboardPaymentDay!]!,
    failedRefundCount: Int!, failedRefundOrders: [DashboardOrderSummary!]!
  }
  extend type Query {
    workspaceDashboard: WorkspaceDashboard!
    adminDashboardFinance(period: DashboardPeriod = DAYS_30): DashboardFinance!
  }
`
