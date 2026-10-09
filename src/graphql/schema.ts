import { bookTypeDefs } from '../modules/books/book.schema.js'
import { orderTypeDefs } from '../modules/orders/order.schema.js'
import { adminTypeDefs } from '../modules/admin/admin.schema.js'
import { activityTypeDefs } from '../modules/activity/activity.schema.js'
import { dashboardTypeDefs } from '../modules/dashboard/dashboard.schema.js'

export const typeDefs = [
  bookTypeDefs,
  orderTypeDefs,
  adminTypeDefs,
  activityTypeDefs,
  dashboardTypeDefs,
]
