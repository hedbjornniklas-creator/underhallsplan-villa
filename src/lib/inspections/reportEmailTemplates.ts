import 'server-only'

type BuildInspectionReportDeliveryEmailInput = {
  orgName: string | null
  customerName: string | null
  propertyAddress: string | null
  inspectionDate: string | null
  detailsUrl: string
}

type BuildInspectionReportDeliveryEmailResult = {
  subject: string
  html: string
  text: string
}

function toDisplayValue(value: string | null | undefined, fallback = 'Ej satt') {
  const normalized = value?.trim() ?? ''
  return normalized === '' ? fallback : normalized
}

function toSwedishDateString(value: string | null) {
  if (!value) return 'Ej satt'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('sv-SE')
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function buildInspectionReportDeliveryEmail(
  input: BuildInspectionReportDeliveryEmailInput
): BuildInspectionReportDeliveryEmailResult {
  const orgName = toDisplayValue(input.orgName, 'BesiktApp')
  const customerName = toDisplayValue(input.customerName, 'kund')
  const propertyAddress = toDisplayValue(input.propertyAddress)
  const inspectionDate = toSwedishDateString(input.inspectionDate)
  const subject = `Besiktningsutlatande - ${orgName}`

  const html = `
<!doctype html>
<html lang="sv">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
    <meta charset="utf-8" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Besiktningsutlatande</title>
  </head>
  <body style="margin:0;padding:0;background:#eef3ff;font-family:Segoe UI,Arial,sans-serif;color:#1f2937;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef3ff;padding:14px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="width:100%;max-width:640px;background:#ffffff;border:1px solid #dbe4ff;border-radius:14px;overflow:hidden;">
            <tr>
              <td style="padding:14px 20px;background:#1d4ed8;background-image:linear-gradient(135deg,#1e3a8a 0%,#1d4ed8 45%,#60a5fa 100%);color:#ffffff;">
                <div style="font-size:20px;font-weight:700;letter-spacing:0.02em;">BESIKTNINGSUTLATANDE</div>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px 22px;">
                <p style="margin:0 0 10px;font-size:15px;">Hej ${escapeHtml(customerName)},</p>
                <p style="margin:0 0 14px;font-size:14px;line-height:1.55;">
                  Besiktningsutlatandet ar nu tillgangligt.
                </p>
                <p style="margin:0 0 14px;font-size:13px;line-height:1.55;">
                  <strong>Adress:</strong> ${escapeHtml(propertyAddress)}<br/>
                  <strong>Besiktningsdag:</strong> ${escapeHtml(inspectionDate)}
                </p>
                <p style="margin:0 0 14px;font-size:14px;line-height:1.55;">
                  Oppna utlåtandet via lank:
                </p>
                <p style="margin:0 0 16px;">
                  <a href="${escapeHtml(input.detailsUrl)}" target="_blank" rel="noreferrer" style="display:inline-block;border:1px solid #312e81;background:#3730a3;border-radius:10px;color:#ffffff;font-size:15px;font-weight:700;line-height:1;text-decoration:none;padding:14px 20px;">
                    Oppna besiktningsutlatande
                  </a>
                </p>
                <p style="margin:0;font-size:12px;line-height:1.5;color:#4b5563;">
                  PDF-versionen finns ocksa bifogad i detta mejl.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
  `

  const text =
    `Hej ${customerName},\n\n` +
    `Besiktningsutlatandet ar nu tillgangligt.\n` +
    `Adress: ${propertyAddress}\n` +
    `Besiktningsdag: ${inspectionDate}\n\n` +
    `Oppna besiktningsutlatande: ${input.detailsUrl}\n\n` +
    `PDF-versionen finns ocksa bifogad i detta mejl.`

  return { subject, html, text }
}

