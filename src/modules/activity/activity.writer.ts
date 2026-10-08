import type { DomainStore } from '../../database/store.types.js'
import {
  activityChangeSchema,
  type ActivityActor,
  type ActivityChange,
  type activityActions,
} from './activity.types.js'
export async function insertActivity(
  tx: Pick<DomainStore, 'insertActivity'>,
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
  await tx.insertActivity({
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    actorType: actor.source === 'SYSTEM' ? 'SYSTEM' : 'USER',
    source: actor.source,
    action: event.action,
    targetType: event.targetType,
    targetId: event.targetId,
    targetName: event.targetName,
    changesJson: JSON.stringify(changes),
    stockDelta: event.stockDelta ?? null,
    createdAt: new Date().toISOString(),
  })
}
