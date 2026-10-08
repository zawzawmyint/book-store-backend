import { normalizeStore, type DatabaseInput } from '../../database/persistence.js'
import type { z } from 'zod'
import type { activityInputSchema } from './activity.validation.js'
import { activityChangeSchema } from './activity.types.js'
import type {
  ActivityAction,
  ActorType,
  ActivityField,
  ActivitySource,
  ActivityTargetType,
  UserRole,
} from '../../graphql/generated/resolvers.js'
export function createActivityRepository(input: DatabaseInput) {
  const store = normalizeStore(input)
  return {
    async list(input: z.infer<typeof activityInputSchema>) {
      const page = await store.activity(input)
      return {
        total: page.total,
        items: page.items.map(({ changesJson, ...row }) => ({
          ...row,
          actorRole: row.actorRole as UserRole | null,
          actorType: row.actorType as ActorType,
          action: row.action as ActivityAction,
          source: row.source as ActivitySource,
          targetType: row.targetType as ActivityTargetType,
          changes: activityChangeSchema
            .array()
            .parse(JSON.parse(changesJson))
            .map((c) => ({ ...c, field: c.field as ActivityField })),
        })),
      }
    },
  }
}
