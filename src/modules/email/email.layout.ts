// Inline styles and presentation tables keep the shared shell usable in email clients.
export const escapeEmailHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )

export function emailParagraph(text: string) {
  return `<p style="margin:0 0 20px;font-size:16px;line-height:1.65;">${escapeEmailHtml(text)}</p>`
}

export function emailButton(label: string, url: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;"><tr><td bgcolor="#2b5843" style="border-radius:6px;text-align:center;mso-padding-alt:14px 24px;"><a href="${escapeEmailHtml(url)}" style="display:inline-block;padding:14px 24px;border:1px solid #2b5843;border-radius:6px;background-color:#2b5843;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:22px;font-weight:bold;text-decoration:none;">${escapeEmailHtml(label)}</a></td></tr></table>`
}

export function emailLayout(input: {
  title: string
  eyebrow: string
  preheader: string
  body: string
}) {
  const e = escapeEmailHtml
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${e(input.title)} — The Quiet Shelf</title></head>
<body style="margin:0;padding:0;background-color:#f7f5f0;color:#26342e;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;" aria-hidden="true">${e(input.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f7f5f0"><tr><td align="center" style="padding:32px 16px;">
<!--[if mso]><table role="presentation" width="600" align="center"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
<tr><td style="padding:0 0 24px;text-align:center;"><p style="margin:0;color:#2b5843;font-family:Georgia,'Times New Roman',serif;font-size:26px;font-weight:bold;">The Quiet Shelf</p><p style="margin:6px 0 0;color:#626d65;font-size:13px;line-height:20px;">A place for your next chapter.</p></td></tr>
<tr><td bgcolor="#ffffff" style="padding:28px 24px;border:1px solid #e2e5dc;border-top:4px solid #2b5843;border-radius:8px;overflow-wrap:anywhere;word-break:break-word;">
<p style="margin:0 0 12px;color:#2b5843;font-size:12px;line-height:18px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;">${e(input.eyebrow)}</p>
<h1 style="margin:0 0 24px;color:#26342e;font-family:Georgia,'Times New Roman',serif;font-size:30px;line-height:1.2;font-weight:normal;">${e(input.title)}</h1>
${input.body}
</td></tr>
<tr><td style="padding:24px 12px;text-align:center;color:#626d65;font-size:12px;line-height:20px;"><p style="margin:0 0 4px;">Sent by The Quiet Shelf</p><p style="margin:0;">This is a service email about your account or order.</p></td></tr>
</table><!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`
}
