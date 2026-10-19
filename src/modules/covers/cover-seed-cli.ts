import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { loadConfig } from '../../config/env.js'
import { openDatabase } from '../../database/runtime.js'
import { normalizeStore } from '../../database/persistence.js'
import { loadCoverConfig } from './cover.config.js'
import { createLocalCoverStorage } from './local-cover.storage.js'
import { seedCovers } from './cover-seed.js'
if (process.env.NODE_ENV === 'production')
  throw new Error('Sample cover seeding is disabled in production')
const entry = z.object({
  slug: z.string().min(1),
  title: z.string().min(1),
  author: z.string().min(1),
  filename: z.string().min(1),
  provenance: z.unknown(),
})
const directory = fileURLToPath(new URL('../../../seed-assets/covers/', import.meta.url))
const entries = entry
  .array()
  .parse(
    JSON.parse(
      await readFile(new URL('../../../seed-assets/covers/manifest.json', import.meta.url), 'utf8'),
    ),
  )
const config = loadCoverConfig(),
  storage = await createLocalCoverStorage(config.directory, config.publicBaseUrl)
const database = await openDatabase(loadConfig())
try {
  console.log(
    JSON.stringify(await seedCovers(normalizeStore(database.handle), storage, directory, entries)),
  )
} finally {
  await database.close()
}
