import { normalizeStore, type DatabaseInput } from '../../database/persistence.js'
import type { ActivityActor } from '../activity/activity.types.js'
import { insertActivity } from '../activity/activity.writer.js'
import { CoverError, type CoverMetadata } from './cover.storage.js'

export function createCoverRepository(input: DatabaseInput) {
  const store = normalizeStore(input)
  return {
    get: (id: number) => store.book(id),
    async save(
      id: number,
      revision: number,
      metadata: CoverMetadata | null,
      actor?: ActivityActor,
    ) {
      return store.transaction(async (tx) => {
        if (actor?.userId) {
          // Role changes lock this user row too. Serialize the permission read
          // with revocation and keep the lock until the cover/audit commit.
          await tx.user(actor.userId)
          const role = await tx.role(actor.userId)
          if (role !== 'STAFF' && role !== 'ADMIN')
            throw new CoverError(403, 'FORBIDDEN', 'Catalog permission is required.')
          actor = { ...actor, role }
        }
        const before = await tx.book(id, true)
        if (!before) throw new CoverError(404, 'BOOK_NOT_FOUND', 'Book was not found.')
        if (before.coverRevision !== revision)
          throw new CoverError(
            409,
            'COVER_CONFLICT',
            'The cover changed elsewhere. Reload it before trying again.',
          )
        if (!metadata && !before.coverKey) return before
        const row = await tx.setBookCover(id, revision, {
          coverKey: metadata?.key ?? null,
          coverWidth: metadata?.width ?? null,
          coverHeight: metadata?.height ?? null,
        })
        if (!row)
          throw new CoverError(
            409,
            'COVER_CONFLICT',
            'The cover changed elsewhere. Reload it before trying again.',
          )
        if (actor)
          await insertActivity(tx, actor, {
            action: 'BOOK_UPDATED',
            targetType: 'BOOK',
            targetId: String(id),
            targetName: row.title,
            changes: [{ field: 'COVER', before: before.coverKey, after: row.coverKey }],
          })
        return row
      })
    },
  }
}
