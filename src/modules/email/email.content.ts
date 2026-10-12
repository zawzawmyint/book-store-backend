import type { EmailMessage } from './email.service.js'

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
export function authEmail(to: string, url: string, kind: 'verify' | 'reset'): EmailMessage {
  const subject =
    kind === 'verify'
      ? 'Verify your email — The Quiet Shelf'
      : 'Reset your password — The Quiet Shelf'
  const action = kind === 'verify' ? 'Verify your email' : 'Reset your password'
  return {
    to,
    subject,
    text: `${action}: ${url}\nThis link expires in one hour. If you did not request it, ignore this email.`,
    html: `<p>${action}</p><p><a href="${escape(url)}">${action}</a></p><p>This link expires in one hour. If you did not request it, ignore this email.</p>`,
  }
}
