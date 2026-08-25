import 'server-only'

type TaskEmailTemplateInput = {
  previewText: string
  eyebrow: string
  heading: string
  recipientName: string
  lead: string
  taskTitle: string
  contextLabel?: string | null
  dueLabel: string
  instruction?: string | null
  actionUrl?: string | null
  actionLabel?: string
  secondaryActionUrl?: string | null
  secondaryActionLabel?: string
  notice?: string | null
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function detailRow(label: string, value: string, last = false) {
  return `
    <tr>
      <td style="padding:${last ? '14px 0 0' : '14px 0'};border-bottom:${last ? '0' : '1px solid #e7e5e4'};font-family:Arial,sans-serif;font-size:12px;font-weight:700;line-height:18px;letter-spacing:.08em;text-transform:uppercase;color:#78716c;vertical-align:top;width:104px;">${escapeHtml(label)}</td>
      <td style="padding:${last ? '14px 0 0' : '14px 0'};border-bottom:${last ? '0' : '1px solid #e7e5e4'};font-family:Arial,sans-serif;font-size:15px;font-weight:600;line-height:22px;color:#1c1917;vertical-align:top;">${escapeHtml(value)}</td>
    </tr>`
}

function bulletproofButton(href: string, label: string) {
  const safeHref = escapeHtml(href)
  const safeLabel = escapeHtml(label)
  return `
    <!--[if mso]>
    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
      href="${safeHref}" style="height:48px;v-text-anchor:middle;width:220px;" arcsize="18%"
      strokecolor="#92400e" fillcolor="#b45309">
      <w:anchorlock/>
      <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:700;">${safeLabel}</center>
    </v:roundrect>
    <![endif]-->
    <!--[if !mso]><!-- -->
    <a href="${safeHref}" target="_blank" rel="noreferrer" style="display:inline-block;min-width:176px;padding:14px 22px;border:1px solid #92400e;border-radius:10px;background:#b45309;font-family:Arial,sans-serif;font-size:15px;font-weight:700;line-height:20px;text-align:center;color:#ffffff;text-decoration:none;">${safeLabel} &nbsp;→</a>
    <!--<![endif]-->`
}

/**
 * Email-safe HusHub/Signe shell. It deliberately uses table layout and inline
 * styles so the hierarchy survives Gmail, Outlook and mobile mail clients.
 */
export function buildTaskEmailHtml(input: TaskEmailTemplateInput) {
  const details = [
    detailRow('Uppdrag', input.taskTitle),
    input.contextLabel ? detailRow('Projekt', input.contextLabel) : '',
    detailRow('Slutdatum', input.dueLabel, true),
  ].join('')
  const instruction = input.instruction
    ? `<p style="margin:22px 0 0;font-family:Arial,sans-serif;font-size:15px;line-height:24px;color:#44403c;">${escapeHtml(input.instruction)}</p>`
    : ''
  const action = input.actionUrl
    ? `
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0 0;">
        <tr>
          <td>${bulletproofButton(input.actionUrl, input.actionLabel ?? 'Öppna uppdraget')}</td>
        </tr>
      </table>`
    : ''
  const secondaryAction = input.secondaryActionUrl
    ? `
      <p style="margin:16px 0 0;font-family:Arial,sans-serif;font-size:14px;line-height:21px;color:#57534e;">
        <a href="${escapeHtml(input.secondaryActionUrl)}" target="_blank" rel="noreferrer" style="font-weight:700;color:#92400e;text-decoration:underline;">${escapeHtml(input.secondaryActionLabel ?? 'Mina uppdrag')}</a>
      </p>`
    : ''
  const notice = input.notice
    ? `
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0 0;background:#fffbeb;border:1px solid #fde68a;border-radius:12px;">
        <tr>
          <td style="padding:13px 15px;font-family:Arial,sans-serif;font-size:13px;line-height:20px;color:#92400e;">${escapeHtml(input.notice)}</td>
        </tr>
      </table>`
    : ''

  return `<!doctype html>
<html lang="sv">
  <head>
    <meta charset="utf-8">
    <meta name="x-apple-disable-message-reformatting">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="color-scheme" content="light">
    <title>${escapeHtml(input.heading)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f5f2ec;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(input.previewText)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f5f2ec;">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:620px;background:#ffffff;border:1px solid #e7e2d8;border-radius:20px;overflow:hidden;">
            <tr>
              <td style="padding:20px 24px;border-bottom:1px solid #eee9df;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td style="width:54px;vertical-align:middle;">
                      <span style="display:inline-block;font-family:Arial,sans-serif;font-size:42px;font-weight:800;line-height:42px;color:#171717;mso-line-height-rule:exactly;">&#10003;</span>
                    </td>
                    <td style="vertical-align:middle;">
                      <p style="margin:0;font-family:Arial,sans-serif;font-size:19px;font-weight:800;line-height:22px;color:#171717;">HusHub</p>
                      <p style="margin:3px 0 0;font-family:Arial,sans-serif;font-size:11px;font-weight:700;line-height:15px;letter-spacing:.15em;text-transform:uppercase;color:#a16207;">Uppdrag med Signe</p>
                    </td>
                    <td align="right" style="vertical-align:middle;">
                      <span style="display:inline-block;width:34px;height:34px;border-radius:10px;background:#f59e0b;font-family:Arial,sans-serif;font-size:24px;font-weight:700;line-height:34px;text-align:center;color:#ffffff;">&#10003;</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:30px 24px 32px;">
                <p style="margin:0;font-family:Arial,sans-serif;font-size:11px;font-weight:800;line-height:16px;letter-spacing:.17em;text-transform:uppercase;color:#b45309;">${escapeHtml(input.eyebrow)}</p>
                <h1 style="margin:8px 0 0;font-family:Arial,sans-serif;font-size:28px;font-weight:800;line-height:34px;letter-spacing:-.02em;color:#1c1917;">${escapeHtml(input.heading)}</h1>
                <p style="margin:22px 0 0;font-family:Arial,sans-serif;font-size:16px;line-height:25px;color:#292524;">Hej ${escapeHtml(input.recipientName)},</p>
                <p style="margin:8px 0 0;font-family:Arial,sans-serif;font-size:15px;line-height:24px;color:#57534e;">${escapeHtml(input.lead)}</p>

                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0 0;background:#fafaf9;border:1px solid #e7e5e4;border-radius:14px;">
                  <tr>
                    <td style="padding:4px 18px 18px;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${details}</table>
                    </td>
                  </tr>
                </table>

                ${instruction}
                ${action}
                ${secondaryAction}
                ${notice}

                <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:28px 0 0;">
                  <tr>
                    <td style="width:30px;vertical-align:middle;">
                      <span style="display:inline-block;width:24px;height:24px;border-radius:8px;background:#f59e0b;font-family:Arial,sans-serif;font-size:17px;font-weight:700;line-height:24px;text-align:center;color:#ffffff;">&#10003;</span>
                    </td>
                    <td style="font-family:Arial,sans-serif;font-size:13px;line-height:19px;color:#78716c;vertical-align:middle;">
                      <strong style="color:#44403c;">Signe</strong><br>HusHubs digitala uppföljningsassistent
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;font-family:Arial,sans-serif;font-size:11px;line-height:17px;color:#a8a29e;">Det här är ett automatiskt uppdragsmeddelande från HusHub.</p>
        </td>
      </tr>
    </table>
  </body>
</html>`
}
