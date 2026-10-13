import nodemailer from 'nodemailer'
import { log } from '../../shared/logger.js'

export type EmailMessage = { to: string; subject: string; text: string; html: string }
export type EmailSender = { send(message: EmailMessage): Promise<void>; close?(): void }
export type SmtpConfig = {
  host: string
  port: number
  secure: boolean
  username?: string
  password?: string
  from: string
  replyTo?: string
}

export function createEmailSender(config: SmtpConfig): EmailSender {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: !config.secure,
    auth: config.username ? { user: config.username, pass: config.password } : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  })
  return {
    async send(message) {
      await transport.sendMail({ from: config.from, replyTo: config.replyTo, ...message })
    },
    close() {
      transport.close()
    },
  }
}

export function createMailDispatcher(
  sender?: EmailSender,
  observeFailure = () =>
    log('error', 'email.delivery_failed', {
      component: 'email',
      errorCode: 'EMAIL_DELIVERY_FAILED',
    }),
) {
  const pending = new Set<Promise<unknown>>()
  function track(promise: Promise<unknown>) {
    const safe = promise.catch(() => observeFailure()).finally(() => pending.delete(safe))
    pending.add(safe)
  }
  return {
    track,
    send(message: EmailMessage) {
      track(
        Promise.resolve().then(() => {
          if (!sender) throw new Error('Email sender unavailable')
          return sender
            .send(message)
            .then(() => log('info', 'email.delivered', { component: 'email' }))
        }),
      )
    },
    async close(timeout = 2000) {
      let timer: ReturnType<typeof setTimeout> | undefined
      await Promise.race([
        Promise.allSettled(pending),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, timeout)
        }),
      ])
      clearTimeout(timer)
      sender?.close?.()
    },
  }
}
