// Email-safe counterparts of renoapp-theme.css; no external fonts or images.
const brand = {
  blue: '#476786', blueSoft: '#eaf0f5', ink: '#293239', muted: '#58636d',
  mist: '#f4f6f7', line: '#cfd7de', focus: '#274c70',
}
const fontFamily = "'Manrope',Arial,sans-serif"

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export function buildRenoAppEmailButton(url: string, label: string) {
  const href = escapeHtml(url)
  const text = escapeHtml(label)
  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="max-width:100%;"><tr><td style="padding:12px 0;">
    <!--[if mso]>
    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
      href="${href}" style="height:48px;v-text-anchor:middle;width:280px;" arcsize="12%" strokecolor="${brand.blue}" fillcolor="${brand.blue}">
      <w:anchorlock/><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">${text}</center>
    </v:roundrect>
    <![endif]-->
    <!--[if !mso]><!-- -->
    <a class="reno-email-button" href="${href}" style="display:inline-block;max-width:100%;box-sizing:border-box;background:${brand.blue};border:1px solid ${brand.blue};border-radius:6px;color:#ffffff;font-family:${fontFamily};font-size:16px;font-weight:bold;line-height:24px;padding:12px 24px;text-align:center;text-decoration:none;">${text}</a>
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
<meta name="x-apple-disable-message-reformatting"/><title>RenoApp</title>
<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<style>
  body, table, td { margin:0; }
  table { border-collapse:collapse; mso-table-lspace:0pt; mso-table-rspace:0pt; }
  .reno-email-content p { margin:0 0 16px; }
  .reno-email-content h1 { margin:0 0 20px; font-size:24px; line-height:32px; color:${brand.ink}; }
  .reno-email-content h2 { margin:24px 0 12px; font-size:20px; line-height:28px; color:${brand.ink}; }
  .reno-email-content a:not(.reno-email-button) { color:${brand.focus}; text-decoration:underline; }
  @media screen and (max-width:480px) {
    .reno-email-outer { padding:12px 8px !important; }
    .reno-email-padding { padding:24px 20px !important; }
  }
</style></head>
<body style="margin:0;padding:0;background:${brand.mist};color:${brand.ink};font-family:${fontFamily};-webkit-text-size-adjust:100%;">
${input.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(input.preheader)}</div>` : ''}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${brand.mist};"><tr><td class="reno-email-outer" align="center" style="padding:32px 12px;">
<!--[if mso]><table role="presentation" width="640"><tr><td><![endif]-->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:640px;table-layout:fixed;background:#ffffff;border:1px solid ${brand.line};">
<tr><td class="reno-email-padding" style="padding:28px 32px;background:${brand.blueSoft};border-top:4px solid ${brand.blue};border-bottom:1px solid ${brand.line};font-family:${fontFamily};">
<div style="font-size:28px;line-height:36px;font-weight:bold;color:${brand.ink};">RenoApp</div>
<div style="margin-top:4px;font-size:14px;line-height:22px;color:${brand.muted};">En tjänst från HusHub</div></td></tr>
<tr><td class="reno-email-padding reno-email-content" style="padding:32px;font-family:${fontFamily};font-size:16px;line-height:26px;color:${brand.ink};overflow-wrap:anywhere;word-wrap:break-word;">
${input.bodyHtml}
<p style="margin:28px 0 0;">Med v&#228;nlig h&#228;lsning,<br/><strong>RenoApp-teamet</strong></p>
</td></tr>
<tr><td class="reno-email-padding" style="padding:20px 32px;border-top:1px solid ${brand.line};font-family:${fontFamily};font-size:13px;line-height:22px;color:${brand.muted};">
<a href="https://renoapp.se" style="color:${brand.focus};text-decoration:underline;">renoapp.se</a>
<span style="color:${brand.muted};"> &nbsp;|&nbsp; En tjänst från HusHub</span>
</td></tr></table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`
}
