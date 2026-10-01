import { bookTypeDefs } from '../modules/books/book.schema.js'
import { orderTypeDefs } from '../modules/orders/order.schema.js'
import { adminTypeDefs } from '../modules/admin/admin.schema.js'

export const typeDefs = [bookTypeDefs, orderTypeDefs, adminTypeDefs]
