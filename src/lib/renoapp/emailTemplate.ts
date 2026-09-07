function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export function buildRenoAppEmailButton(url: string, label: string) {
  const href = escapeHtml(url)
  const text = escapeHtml(label)
  return `
    <table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="padding:12px 0;">
    <!--[if mso]>
    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
      href="${href}" style="height:48px;v-text-anchor:middle;width:240px;" arcsize="12%" strokecolor="#166534" fillcolor="#166534">
      <w:anchorlock/><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">${text}</center>
    </v:roundrect>
    <![endif]-->
    <!--[if !mso]><!-- -->
    <a href="${href}" style="display:inline-block;background:#166534;border:1px solid #166534;border-radius:6px;color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;line-height:24px;padding:12px 24px;text-decoration:none;">${text}</a>
    <!--<![endif]-->
    </td></tr></table>`
}

export function buildRenoAppEmailHtml(input: {
  origin: string
  preheader?: string | null
  bodyHtml: string
}) {
  return `<!doctype html>
<html lang="sv" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="x-apple-disable-message-reformatting"/><title>RenoApp | HusHub</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;color:#292524;font-family:Arial,sans-serif;">
${input.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(input.preheader)}</div>` : ''}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f4f6;"><tr><td align="center" style="padding:24px 12px;">
<!--[if mso]><table role="presentation" width="640"><tr><td><![endif]-->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border:1px solid #e5e7eb;">
<tr><td style="padding:24px 28px;border-bottom:3px solid #166534;">
<div style="font-size:26px;line-height:32px;font-weight:bold;color:#166534;">RenoApp</div>
<div style="font-size:14px;line-height:22px;color:#57534e;">Styrelseportalen hos HusHub</div></td></tr>
<tr><td style="padding:24px 28px;font-size:16px;line-height:26px;">
${input.bodyHtml}
<p style="margin:24px 0 0;">Med v&#228;nlig h&#228;lsning,<br/>RenoApp-teamet p&#229; HusHub</p>
</td></tr></table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`
}
