import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { activityEvents } from '../../database/schema.js'
import {
  activityChangeSchema,
  type ActivityActor,
  type ActivityChange,
  type activityActions,
} from './activity.types.js'

export function insertActivity(
  tx: Pick<BetterSQLite3Database, 'insert'>,
  actor: ActivityActor,
  event: {
    action: (typeof activityActions)[number]
    targetType: 'BOOK' | 'USER' | 'ORDER'
    targetId: string
    targetName: string
    changes: ActivityChange[]
    stockDelta?: number
  },
) {
  const changes = activityChangeSchema.array().parse(event.changes)
  tx.insert(activityEvents)
    .values({
      actorUserId: actor.userId,
      actorName: actor.name,
      actorRole: actor.role,
      source: actor.source,
      action: event.action,
      targetType: event.targetType,
      targetId: event.targetId,
      targetName: event.targetName,
      changesJson: JSON.stringify(changes),
      stockDelta: event.stockDelta ?? null,
      createdAt: new Date().toISOString(),
    })
    .run()
}
