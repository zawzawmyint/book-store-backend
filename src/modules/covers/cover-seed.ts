import { readFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import type { DomainStore } from '../../database/store.types.js'
import { createCoverRepository } from './cover.repository.js'
import { createCoverService } from './cover.service.js'
import { CoverError, type CoverStorage } from './cover.storage.js'
export type CoverSeedEntry = {
  slug: string
  title: string
  author: string
  filename: string
  provenance?: unknown
}
export async function seedCovers(
  store: DomainStore,
  storage: CoverStorage,
  directory: string,
  entries: CoverSeedEntry[],
) {
  const result = { imported: [] as string[], skipped: [] as string[] }
  const books = await store.allCoverBooks(),
    service = createCoverService(createCoverRepository(store), storage)
  const root = resolve(directory)
  for (const entry of entries) {
    const matches = books.filter(
      (book) => book.title === entry.title && book.author === entry.author,
    )
    if (matches.length !== 1 || matches[0].coverKey || matches[0].coverRevision !== 0) {
      result.skipped.push(entry.slug)
      continue
    }
    const path = resolve(root, entry.filename)
    if (!path.startsWith(root + sep) || !entry.filename.endsWith('.webp'))
      throw new Error('Invalid seed artwork path')
    const bytes = await readFile(path)
    try {
      await service.upload(matches[0].id, 0, bytes, 'image/webp')
      result.imported.push(entry.slug)
    } catch (error) {
      if (error instanceof CoverError && error.code === 'COVER_CONFLICT')
        result.skipped.push(entry.slug)
      else throw error
    }
  }
  return result
}
