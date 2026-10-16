import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto'
import type {
  EmailPayload,
  EncryptedEmailPayload,
  NotificationKind,
} from './email-notification.types.js'

export function decodeEmailKey(value: string, label = 'EMAIL_PAYLOAD_KEYS'): Buffer {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value) || Buffer.from(value, 'base64').length !== 32)
    throw new Error(`${label} must contain base64-encoded 32-byte keys`)
  return Buffer.from(value, 'base64')
}
export function createEmailCrypto(config: {
  keys: Record<string, string>
  activeKeyId: string
  dedupeKey?: string
}) {
  const keys = new Map(
    Object.entries(config.keys).map(([id, value]) => [id, decodeEmailKey(value)]),
  )
  const activeKey = keys.get(config.activeKeyId)
  if (!activeKey) throw new Error('EMAIL_PAYLOAD_ACTIVE_KEY_ID must select a configured key')
  const digestKey = config.dedupeKey
    ? decodeEmailKey(config.dedupeKey, 'EMAIL_DEDUPE_KEY')
    : activeKey
  const context = (id: string, kind: NotificationKind, templateVersion: number) =>
    Buffer.from(JSON.stringify([id, kind, templateVersion]))
  return {
    seal(
      id: string,
      kind: NotificationKind,
      payload: EmailPayload,
      templateVersion = 1,
    ): EncryptedEmailPayload {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', activeKey, iv)
      cipher.setAAD(context(id, kind, templateVersion))
      const encrypted = Buffer.concat([
        cipher.update(JSON.stringify(payload), 'utf8'),
        cipher.final(),
      ])
      return {
        payloadCiphertext: encrypted.toString('base64'),
        payloadIv: iv.toString('base64'),
        payloadTag: cipher.getAuthTag().toString('base64'),
        payloadKeyId: config.activeKeyId,
      }
    },
    open(row: {
      id: string
      kind: NotificationKind
      templateVersion: number
      payloadCiphertext: string | null
      payloadIv: string | null
      payloadTag: string | null
      payloadKeyId: string | null
    }): EmailPayload {
      const key = row.payloadKeyId && keys.get(row.payloadKeyId)
      if (!key) throw new Error('EMAIL_PAYLOAD_KEY_UNAVAILABLE')
      try {
        if (!row.payloadCiphertext || !row.payloadIv || !row.payloadTag) throw new Error()
        const iv = Buffer.from(row.payloadIv, 'base64')
        const tag = Buffer.from(row.payloadTag, 'base64')
        if (iv.length !== 12 || tag.length !== 16) throw new Error()
        const decipher = createDecipheriv('aes-256-gcm', key, iv)
        decipher.setAAD(context(row.id, row.kind, row.templateVersion))
        decipher.setAuthTag(tag)
        const payload = JSON.parse(
          Buffer.concat([
            decipher.update(Buffer.from(row.payloadCiphertext, 'base64')),
            decipher.final(),
          ]).toString('utf8'),
        ) as EmailPayload
        if (!payload || typeof payload.to !== 'string') throw new Error()
        return payload
      } catch {
        throw new Error('EMAIL_PAYLOAD_DECRYPTION_FAILED')
      }
    },
    digest(value: string) {
      return createHmac('sha256', digestKey).update(value).digest('hex')
    },
  }
}
export type EmailCrypto = ReturnType<typeof createEmailCrypto>
