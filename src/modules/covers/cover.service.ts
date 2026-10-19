import { randomUUID } from 'node:crypto'
import type { ActivityActor } from '../activity/activity.types.js'
import type { createCoverRepository } from './cover.repository.js'
import { normalizeCover } from './cover.image.js'
import { CoverError, coverView, type CoverStorage } from './cover.storage.js'
export function createCoverService(
  repository: ReturnType<typeof createCoverRepository>,
  storage: CoverStorage,
) {
  return {
    async upload(
      id: number,
      revision: number,
      bytes: Uint8Array,
      type: string,
      actor?: ActivityActor,
    ) {
      const before = await repository.get(id)
      if (!before) throw new CoverError(404, 'BOOK_NOT_FOUND', 'Book was not found.')
      if (before.coverRevision !== revision)
        throw new CoverError(
          409,
          'COVER_CONFLICT',
          'The cover changed elsewhere. Reload it before trying again.',
        )
      const image = await normalizeCover(bytes, type),
        key = `covers/${randomUUID()}.webp`
      try {
        await storage.put(key, image.bytes)
        const row = await repository.save(
          id,
          revision,
          { key, width: image.width, height: image.height },
          actor,
        )
        return {
          bookId: String(id),
          cover: coverView(row, storage),
          coverRevision: row.coverRevision,
        }
      } catch (error) {
        await storage.remove(key).catch(() => {})
        throw error
      }
    },
    async remove(id: number, revision: number, actor: ActivityActor) {
      const row = await repository.save(id, revision, null, actor)
      return { bookId: String(id), cover: null, coverRevision: row.coverRevision }
    },
  }
}
