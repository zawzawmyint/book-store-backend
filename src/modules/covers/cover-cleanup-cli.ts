import 'dotenv/config'
import { loadConfig } from '../../config/env.js'
import { openDatabase } from '../../database/runtime.js'
import { normalizeStore } from '../../database/persistence.js'
import { loadCoverConfig } from './cover.config.js'
import { cleanupCovers } from './cover-cleanup.js'
const args = process.argv.slice(2)
if (
  !args.includes('--writers-stopped') ||
  args.some((arg) => !['--writers-stopped', '--apply'].includes(arg))
)
  throw new Error(
    'Stop API and seed writers, then pass --writers-stopped; --apply enables deletion (otherwise dry run).',
  )
const database = await openDatabase(loadConfig())
try {
  const references = new Set(
    (await normalizeStore(database.handle).allCoverBooks()).flatMap((book) =>
      book.coverKey ? [book.coverKey] : [],
    ),
  )
  const apply = args.includes('--apply')
  console.log(
    JSON.stringify({
      apply,
      keys: await cleanupCovers(loadCoverConfig().directory, references, apply),
    }),
  )
} finally {
  await database.close()
}
