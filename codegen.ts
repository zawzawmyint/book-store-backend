import type { CodegenConfig } from '@graphql-codegen/cli'
import { buildSchema } from 'graphql'
import { bookTypeDefs } from './src/modules/books/book.schema.ts'
import { orderTypeDefs } from './src/modules/orders/order.schema.ts'
import { adminTypeDefs } from './src/modules/admin/admin.schema.ts'
import { activityTypeDefs } from './src/modules/activity/activity.schema.ts'
import { dashboardTypeDefs } from './src/modules/dashboard/dashboard.schema.ts'

const config: CodegenConfig = {
  schema: buildSchema(
    [bookTypeDefs, orderTypeDefs, adminTypeDefs, activityTypeDefs, dashboardTypeDefs].join('\n'),
  ),
  generates: {
    'src/graphql/generated/resolvers.ts': {
      plugins: ['typescript', 'typescript-resolvers'],
      config: {
        useTypeImports: true,
        mappers: {
          AdminOrder: '../../modules/orders/order.types.js#WorkspaceOrder',
          WorkspaceDashboard:
            '../../modules/dashboard/dashboard.service.js#WorkspaceDashboardResult',
          DashboardFinance: '../../modules/dashboard/dashboard.service.js#DashboardFinanceResult',
        },
        scalars: { ID: { input: 'string', output: 'string | number' } },
      },
    },
  },
}

export default config
