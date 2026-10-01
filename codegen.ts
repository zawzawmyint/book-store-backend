import type { CodegenConfig } from '@graphql-codegen/cli'
import { buildSchema } from 'graphql'
import { bookTypeDefs } from './src/modules/books/book.schema.ts'
import { orderTypeDefs } from './src/modules/orders/order.schema.ts'
import { adminTypeDefs } from './src/modules/admin/admin.schema.ts'

const config: CodegenConfig = {
  schema: buildSchema([bookTypeDefs, orderTypeDefs, adminTypeDefs].join('\n')),
  generates: {
    'src/graphql/generated/resolvers.ts': {
      plugins: ['typescript', 'typescript-resolvers'],
      config: {
        useTypeImports: true,
        scalars: { ID: { input: 'string', output: 'string | number' } },
      },
    },
  },
}

export default config
