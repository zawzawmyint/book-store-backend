import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { loadConfig } from '../../config/env.js'
import { loadEmailConfig } from './email-config.js'
import { createEmailCrypto } from './email-payload.crypto.js'
import { createEmailNotificationRepository } from './email-notification.repository.js'
import { openEmailWorkerDatabase } from './email.worker.js'

const args = process.argv.slice(2).filter((arg) => arg !== '--')
const command = args[0]
const id = args[args.indexOf('--id') + 1]
try {
  if (
    !['inspect', 'replay'].includes(command ?? '') ||
    !args.includes('--id') ||
    !/^[0-9a-f-]{36}$/i.test(id ?? '')
  )
    throw new Error('EMAIL_OPERATOR_ARGUMENTS_INVALID')
  const config = loadConfig()
  const crypto = createEmailCrypto(loadEmailConfig())
  const database = await openEmailWorkerDatabase(config)
  try {
    const repo = createEmailNotificationRepository(database.handle, crypto)
    const result =
      command === 'inspect'
        ? await repo.inspect(id)
        : await repo.replay(
            id,
            args.includes('--acknowledge-duplicate-risk'),
            args.includes('--apply'),
          )
    console.log(JSON.stringify({ actionId: randomUUID(), action: command, targetId: id, result }))
  } finally {
    await database.close()
  }
} catch {
  console.error(JSON.stringify({ errorCode: 'EMAIL_OPERATOR_ACTION_REJECTED' }))
  process.exitCode = 1
}
