import type { EmailMessage } from './email.service.js'
import { emailLayout, emailButton, emailParagraph, escapeEmailHtml } from './email.layout.js'
export function authEmail(to: string, url: string, kind: 'verify' | 'reset'): EmailMessage {
  const subject =
    kind === 'verify'
      ? 'Verify your email — The Quiet Shelf'
      : 'Reset your password — The Quiet Shelf'
  const action = kind === 'verify' ? 'Verify your email' : 'Reset your password'
  const intro =
    kind === 'verify'
      ? 'Welcome to The Quiet Shelf. Confirm your email address to finish setting up your account and find your next great read.'
      : 'We received a request to reset your Quiet Shelf password. Use the button below to choose a new one.'
  const security =
    kind === 'verify'
      ? 'If you did not create an account, you can safely ignore this email.'
      : 'If you did not request a password reset, you can safely ignore this email. Your password will stay the same.'
  const expiry = 'This link expires in one hour.'
  return {
    to,
    subject,
    text: `The Quiet Shelf\n\n${action}\n\n${intro}\n\n${action}: ${url}\n\n${expiry}\n${security}\n\nSent by The Quiet Shelf`,
    html: emailLayout({
      title: action,
      eyebrow: kind === 'verify' ? 'Welcome to your next chapter' : 'Account security',
      preheader:
        kind === 'verify'
          ? 'One small step before your next great read. Verify your email address.'
          : 'Choose a new password for your Quiet Shelf account. This link expires in one hour.',
      body: `${emailParagraph(intro)}${emailButton(action, url)}${emailParagraph(expiry)}${emailParagraph(security)}<div style="border-top:1px solid #e2e5dc;padding-top:20px;font-size:13px;line-height:1.6;color:#626d65;"><p style="margin:0 0 8px;">If the button does not work, copy and paste this link into your browser:</p><a href="${escapeEmailHtml(url)}" style="color:#2b5843;text-decoration:underline;word-break:break-all;overflow-wrap:anywhere;">${escapeEmailHtml(url)}</a></div>`,
    }),
  }
}
