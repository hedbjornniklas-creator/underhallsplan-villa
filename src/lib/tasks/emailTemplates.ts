import 'server-only'

type TaskEmailTemplateInput = {
  previewText: string
  eyebrow: string
  heading: string
  recipientName: string
  lead: string
  taskTitle: string
  contextLabel?: string | null
  dueLabel: string | null
  itemLabel?: string
  instruction?: string | null
  actionUrl?: string | null
  actionLabel?: string
  secondaryActionUrl?: string | null
  secondaryActionLabel?: string
  notice?: string | null
  message?: { authorName: string; text: string } | null
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;')
}

function detailRow(label: string, value: string, last = false) {
  return `<tr>
    <td style="padding:12px 12px 12px 0;border-bottom:${last ? '0' : '1px solid #D5DCDD'};font-family:Arial,sans-serif;font-size:13px;font-weight:400;line-height:20px;letter-spacing:0;color:#596368;vertical-align:top;width:90px;">${escapeHtml(label)}</td>
    <td style="padding:12px 0;border-bottom:${last ? '0' : '1px solid #D5DCDD'};font-family:Arial,sans-serif;font-size:15px;font-weight:600;line-height:22px;color:#252A2D;vertical-align:top;overflow-wrap:anywhere;word-break:break-word;">${escapeHtml(value)}</td>
  </tr>`
}

function bulletproofButton(href: string, label: string) {
  const safeHref = escapeHtml(href), safeLabel = escapeHtml(label)
  return `<!--[if mso]>
    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
      href="${safeHref}" style="height:48px;v-text-anchor:middle;width:220px;" arcsize="12%"
      strokecolor="#252A2D" fillcolor="#252A2D"><w:anchorlock/>
      <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:700;">${safeLabel}</center>
    </v:roundrect>
    <![endif]-->
    <!--[if !mso]><!-- -->
    <a href="${safeHref}" target="_blank" rel="noreferrer" style="display:inline-block;max-width:100%;box-sizing:border-box;padding:14px 18px;border:1px solid #252A2D;border-radius:6px;background:#252A2D;font-family:Arial,sans-serif;font-size:15px;font-weight:700;line-height:20px;text-align:center;color:#ffffff;text-decoration:none;word-break:break-word;">${safeLabel} &nbsp;→</a>
    <!--<![endif]-->`
}

// Tables, inline styles and the VML button keep the message usable in Outlook.
// A text wordmark works even when the mail client blocks remote images/fonts.
function emailShell(input: { previewText: string; heading: string; content: string; footer?: string }) {
  return `<!doctype html><html lang="sv"><head>
    <meta charset="utf-8"><meta name="x-apple-disable-message-reformatting">
    <meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light">
    <title>${escapeHtml(input.heading)}</title></head>
    <body style="margin:0;padding:0;background:#F4F6F6;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(input.previewText)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#F4F6F6;">
    <tr><td align="center" style="padding:20px 12px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:620px;background:#ffffff;border:1px solid #D5DCDD;border-radius:6px;overflow:hidden;">
      <tr><td style="padding:18px 20px;border-top:4px solid #F2D76A;border-bottom:1px solid #D5DCDD;">
        <p style="margin:0;font-family:Arial,sans-serif;font-size:22px;font-weight:700;line-height:28px;letter-spacing:0;color:#252A2D;">Gizmo</p>
        <p style="margin:2px 0 0;font-family:Arial,sans-serif;font-size:12px;line-height:18px;color:#596368;">från HusHub</p>
      </td></tr>
      <tr><td style="padding:24px 20px;letter-spacing:0;">${input.content}</td></tr>
      </table>
      <p style="margin:14px 0 0;font-family:Arial,sans-serif;font-size:12px;line-height:18px;color:#596368;">${escapeHtml(input.footer ?? 'Det här är ett automatiskt uppdragsmeddelande från HusHub.')}</p>
    </td></tr></table></body></html>`
}

export function buildTaskEmailHtml(input: TaskEmailTemplateInput) {
  const rows: [string, string][] = []
  if (input.heading !== input.taskTitle) rows.push([input.itemLabel ?? 'Uppdrag', input.taskTitle])
  if (input.contextLabel) rows.push(['Projekt', input.contextLabel])
  if (input.dueLabel) rows.push(['Slutdatum', input.dueLabel])
  const details = rows.length ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:20px 0 0;border-block:1px solid #D5DCDD;">${rows.map(([label, value], i) => detailRow(label, value, i === rows.length - 1)).join('')}</table>` : ''
  const instruction = input.instruction ? `<p style="margin:20px 0 0;font-family:Arial,sans-serif;font-size:15px;line-height:24px;color:#252A2D;">${escapeHtml(input.instruction)}</p>` : ''
  const message = input.message ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:20px 0 0;background:#F1F6F5;border-left:3px solid #206961;"><tr><td style="padding:14px 16px;">
    <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;font-weight:700;line-height:20px;color:#206961;">Meddelande från ${escapeHtml(input.message.authorName)}</p>
    <p style="margin:6px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;font-family:Arial,sans-serif;font-size:15px;line-height:24px;color:#252A2D;">${escapeHtml(input.message.text)}</p>
    </td></tr></table>` : ''
  const action = input.actionUrl ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:22px 0 0;"><tr><td>${bulletproofButton(input.actionUrl, input.actionLabel ?? 'Öppna uppdraget')}</td></tr></table>` : ''
  const secondary = input.secondaryActionUrl ? `<p style="margin:16px 0 0;font-family:Arial,sans-serif;font-size:14px;line-height:21px;"><a href="${escapeHtml(input.secondaryActionUrl)}" target="_blank" rel="noreferrer" style="color:#206961;font-weight:600;text-decoration:underline;">${escapeHtml(input.secondaryActionLabel ?? 'Mina uppdrag')}</a></p>` : ''
  const notice = input.notice ? `<p style="margin:22px 0 0;padding-top:16px;border-top:1px solid #D5DCDD;font-family:Arial,sans-serif;font-size:13px;line-height:21px;color:#596368;">${escapeHtml(input.notice)}</p>` : ''
  return emailShell({ previewText: input.previewText, heading: input.heading, content: `
    <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;font-weight:600;line-height:20px;color:#206961;">${escapeHtml(input.eyebrow)}</p>
    <h1 style="margin:8px 0 0;font-family:Arial,sans-serif;font-size:24px;font-weight:700;line-height:32px;letter-spacing:0;color:#252A2D;overflow-wrap:anywhere;word-break:break-word;">${escapeHtml(input.heading)}</h1>
    <p style="margin:20px 0 0;font-family:Arial,sans-serif;font-size:15px;line-height:24px;color:#252A2D;">Hej ${escapeHtml(input.recipientName)},</p>
    <p style="margin:6px 0 0;font-family:Arial,sans-serif;font-size:15px;line-height:24px;color:#596368;">${escapeHtml(input.lead)}</p>
    ${details}${instruction}${message}${action}${secondary}${notice}` })
}

export type TaskReminderDigestEmailItem = {
  title: string
  contextLabel?: string | null
  dueLabel: string
  statusLabel: string
  actionUrl: string
}
export type TaskReminderDigestEmailInput = {
  recipientName: string
  previewText: string
  heading: string
  lead: string
  items: readonly TaskReminderDigestEmailItem[]
  visibleItemLimit?: number
  remainingCount?: number
  overviewUrl: string
  overviewLabel?: string
}
function digestItemCard(item: TaskReminderDigestEmailItem) {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 16px;border-bottom:1px solid #D5DCDD;"><tr><td style="padding:12px 0 16px;">
    <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;font-weight:600;line-height:20px;color:#206961;">${escapeHtml(item.statusLabel)}</p>
    <p style="margin:4px 0;font-family:Arial,sans-serif;font-size:17px;font-weight:700;line-height:24px;overflow-wrap:anywhere;color:#252A2D;">${escapeHtml(item.title)}</p>
    ${item.contextLabel ? `<p style="margin:4px 0;font-family:Arial,sans-serif;font-size:13px;line-height:20px;color:#596368;">${escapeHtml(item.contextLabel)}</p>` : ''}
    <p style="margin:8px 0;font-family:Arial,sans-serif;font-size:14px;line-height:21px;color:#252A2D;">Slutdatum: ${escapeHtml(item.dueLabel)}</p>
    <a href="${escapeHtml(item.actionUrl)}" target="_blank" rel="noreferrer" style="font-family:Arial,sans-serif;font-size:14px;font-weight:700;line-height:20px;color:#206961;text-decoration:underline;">Öppna uppdraget&nbsp;→</a>
    </td></tr></table>`
}
export function buildTaskReminderDigestEmailHtml(input: TaskReminderDigestEmailInput) {
  const requestedLimit = input.visibleItemLimit
  const visibleItemLimit = typeof requestedLimit === 'number' && Number.isFinite(requestedLimit) ? Math.max(0, Math.floor(requestedLimit)) : input.items.length
  const visibleItems = input.items.slice(0, visibleItemLimit)
  const providedRemainingCount = typeof input.remainingCount === 'number' && Number.isFinite(input.remainingCount) ? Math.max(0, Math.floor(input.remainingCount)) : 0
  const remainingCount = Math.max(Math.max(0, input.items.length - visibleItems.length), providedRemainingCount)
  return emailShell({ previewText: input.previewText, heading: input.heading,
    footer: 'Automatiska uppdragspåminnelser har samlats i ett mejl för att minska antalet utskick.',
    content: `
    <h1 style="margin:0;font-family:Arial,sans-serif;font-size:24px;font-weight:700;line-height:32px;color:#252A2D;overflow-wrap:anywhere;">${escapeHtml(input.heading)}</h1>
    <p style="margin:20px 0 0;font-family:Arial,sans-serif;font-size:15px;line-height:24px;color:#252A2D;">Hej ${escapeHtml(input.recipientName)},</p>
    <p style="margin:6px 0 20px;font-family:Arial,sans-serif;font-size:15px;line-height:24px;color:#596368;">${escapeHtml(input.lead)}</p>
    ${visibleItems.map(digestItemCard).join('')}
    ${visibleItems.length === 0 ? '<p style="font-family:Arial,sans-serif;font-size:14px;line-height:22px;color:#596368;">Öppna HusHub för att se uppdragen som behöver din uppmärksamhet.</p>' : ''}
    ${remainingCount > 0 ? `<p style="font-family:Arial,sans-serif;font-size:14px;line-height:22px;color:#596368;">Ytterligare ${remainingCount} uppdrag finns i HusHub.</p>` : ''}
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:22px 0 0;"><tr><td>${bulletproofButton(input.overviewUrl, input.overviewLabel ?? 'Visa alla uppdrag')}</td></tr></table>` })
}
