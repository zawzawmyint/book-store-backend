import type Database from 'better-sqlite3'
import { and, count, desc, eq, gte, lt, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import type { z } from 'zod'
import { activityEvents as events } from '../../database/schema.js'
import type { activityInputSchema } from './activity.validation.js'
import { activityChangeSchema } from './activity.types.js'
import type {
  ActivityAction,
  ActivityField,
  ActivitySource,
  ActivityTargetType,
  UserRole,
} from '../../graphql/generated/resolvers.js'

export function createActivityRepository(db: Database.Database) {
  const orm = drizzle(db)
  return {
    list(input: z.infer<typeof activityInputSchema>) {
      const where = and(
        input.actorUserId ? eq(events.actorUserId, input.actorUserId) : undefined,
        input.action ? eq(events.action, input.action) : undefined,
        input.targetType ? eq(events.targetType, input.targetType) : undefined,
        input.targetId ? eq(events.targetId, input.targetId) : undefined,
        input.from ? gte(events.createdAt, input.from) : undefined,
        input.to ? lt(events.createdAt, input.to) : undefined,
        input.changedField
          ? sql`exists (select 1 from json_each(${events.changesJson}) where json_extract(value, '$.field') = ${input.changedField})`
          : undefined,
      )
      return {
        total: orm.select({ n: count() }).from(events).where(where).get()!.n,
        items: orm
          .select()
          .from(events)
          .where(where)
          .orderBy(desc(events.id))
          .limit(input.limit)
          .offset(input.offset)
          .all()
          .map(({ changesJson, ...row }) => ({
            ...row,
            actorRole: row.actorRole as UserRole | null,
            action: row.action as ActivityAction,
            source: row.source as ActivitySource,
            targetType: row.targetType as ActivityTargetType,
            changes: activityChangeSchema
              .array()
              .parse(JSON.parse(changesJson))
              .map((change) => ({ ...change, field: change.field as ActivityField })),
          })),
      }
    },
  }
}
