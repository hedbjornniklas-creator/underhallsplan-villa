import 'server-only'

type TermsRole = 'seller' | 'buyer' | 'apartment'
type AssignmentType = 'OB' | 'STATUS' | 'UHP'

type AssignmentForEmail = {
  assignment_type: AssignmentType
  customer_name: string | null
  customer_email: string
  customer_phone: string | null
  customer_address: string | null
  preliminary_address: string | null
  preferred_date: string | null
  preferred_time: string | null
  price_amount: number | null
  currency: string | null
  property_address: string | null
  property_city: string | null
  property_municipality: string | null
  property_owner_name: string | null
  cadastral_id: string | null
}

export type BuildAssignmentConfirmationEmailInput = {
  assignment: AssignmentForEmail
  orgName: string | null
  acceptUrl: string
  expiresAt: string
  termsVersion: string
  termsRole: TermsRole
}

export type BuildAssignmentConfirmationEmailResult = {
  subject: string
  html: string
  text: string
}

function toSwedishDateString(value: string | null) {
  if (!value) return 'Ej satt'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('sv-SE')
}

function toSwedishTimeString(value: string | null) {
  if (!value) return 'Ej satt'
  const trimmed = value.trim()
  if (trimmed === '') return 'Ej satt'
  if (/^\d{2}:\d{2}/.test(trimmed)) return trimmed.slice(0, 5)
  return trimmed
}

function toDisplayValue(value: string | null | undefined, fallback = 'Ej satt') {
  const normalized = value?.trim() ?? ''
  return normalized === '' ? fallback : normalized
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatPriceAmount(value: number | null, currency: string | null) {
  if (value === null || !Number.isFinite(value)) return 'Ej satt'
  const resolvedCurrency = toDisplayValue(currency, 'SEK').toUpperCase()

  try {
    return new Intl.NumberFormat('sv-SE', {
      style: 'currency',
      currency: resolvedCurrency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    return `${value} ${resolvedCurrency}`
  }
}

function assignmentTypeToLabel(type: AssignmentType) {
  if (type === 'STATUS') return 'Statusbesiktning'
  if (type === 'UHP') return 'Underhållsplan'
  return 'Överlåtelsebesiktning'
}

function termsRoleToLabel(role: TermsRole, format: 'html' | 'text' = 'text') {
  if (role === 'buyer') return format === 'html' ? 'Köpare' : 'Köpare'
  if (role === 'apartment') return format === 'html' ? 'Lägenhet' : 'Lägenhet'
  return format === 'html' ? 'Säljare' : 'Säljare'
}

export function buildAssignmentConfirmationEmail(
  input: BuildAssignmentConfirmationEmailInput
): BuildAssignmentConfirmationEmailResult {
  const customerName = toDisplayValue(input.assignment.customer_name, 'kund')
  const cadastralId = toDisplayValue(input.assignment.cadastral_id)
  const propertyAddress = toDisplayValue(
    input.assignment.property_address ?? input.assignment.preliminary_address
  )
  const municipality = toDisplayValue(
    input.assignment.property_municipality ?? input.assignment.property_city
  )
  const propertyOwner = toDisplayValue(input.assignment.property_owner_name)
  const customerAddress = toDisplayValue(input.assignment.customer_address)
  const customerPhone = toDisplayValue(input.assignment.customer_phone)
  const customerEmail = toDisplayValue(input.assignment.customer_email)
  const inspectionDate = toSwedishDateString(input.assignment.preferred_date)
  const inspectionTime = toSwedishTimeString(input.assignment.preferred_time)
  const priceText = formatPriceAmount(input.assignment.price_amount, input.assignment.currency)
  const expiresDate = toSwedishDateString(input.expiresAt)
  const roleLabelHtml = termsRoleToLabel(input.termsRole, 'html')
  const roleLabelText = termsRoleToLabel(input.termsRole, 'text')
  const assignmentType = assignmentTypeToLabel(input.assignment.assignment_type)
  const orgName = toDisplayValue(input.orgName, 'BesiktApp')
  const subject = `Uppdragsbekr\u00e4ftelse - ${orgName}`
  let brandLogoUrl: string | null = null
  try {
    brandLogoUrl = new URL('/landing/hushub-check.svg', input.acceptUrl).toString()
  } catch {
    brandLogoUrl = null
  }

  const html = `
<!doctype html>
<html lang="sv">
  <body style="margin:0;padding:0;background:#eef3ff;font-family:Segoe UI,Arial,sans-serif;color:#1f2937;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef3ff;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="width:100%;max-width:640px;background:#ffffff;border:1px solid #dbe4ff;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:20px 24px;background:linear-gradient(135deg,#1e3a8a 0%,#1d4ed8 48%,#60a5fa 100%);color:#ffffff;">
                <div style="font-size:20px;font-weight:700;letter-spacing:0.02em;">UPPDRAGSBEKR&Auml;FTELSE</div>
                <div style="margin-top:10px;font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">
                  &Ouml;verl&aring;telsebesiktning f&ouml;r
                  <span style="display:inline-block;margin-left:8px;padding:5px 12px;border-radius:999px;background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.45);">${roleLabelHtml}</span>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;">
                <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 14px;">
                  <tr>
                    <td style="vertical-align:middle;">
                      ${
                        brandLogoUrl
                          ? `<img src="${escapeHtml(brandLogoUrl)}" alt="HusHub" width="46" height="30" style="display:block;width:46px;height:30px;object-fit:contain;" />`
                          : ''
                      }
                    </td>
                    <td style="vertical-align:middle;padding-left:6px;font-size:30px;font-weight:800;line-height:1;color:#111827;">
                      HusHub
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 10px;font-size:15px;">Hej ${escapeHtml(customerName)},</p>
                <p style="margin:0 0 16px;font-size:14px;line-height:1.55;">
                  Vi har skapat en uppdragsbekr&auml;ftelse f&ouml;r er ${escapeHtml(assignmentType)}.
                </p>
                <p style="margin:0 0 16px;font-size:14px;line-height:1.55;">
                  F&ouml;r att bekr&auml;fta uppdraget, klicka p&aring; knappen
                  &ldquo;&Ouml;ppna uppdragsbekr&auml;ftelsen&rdquo;, fyll i eller kontrollera uppgifterna i formul&auml;ret
                  och godk&auml;nn villkoren.
                </p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 16px;">
                  <tr>
                    <td align="left">
                      <table role="presentation" cellspacing="0" cellpadding="0">
                        <tr>
                          <td
                            bgcolor="#3730a3"
                            style="border-radius:12px;border:1px solid #312e81;box-shadow:0 4px 10px rgba(55,48,163,0.35);"
                          >
                            <a
                              href="${escapeHtml(input.acceptUrl)}"
                              target="_blank"
                              rel="noreferrer"
                              style="display:inline-block;padding:13px 20px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:800;letter-spacing:0.01em;"
                            >
                              &#8599; &Ouml;ppna uppdragsbekr&auml;ftelsen
                            </a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;border-spacing:0 10px;">
                  <tr>
                    <td style="width:50%;vertical-align:top;padding-right:8px;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fbff;border:1px solid #d9e8ff;border-radius:10px;">
                        <tr><td style="padding:14px;">
                          <div style="font-size:13px;font-weight:700;margin-bottom:8px;color:#1f2937;">Objekt</div>
                          <div style="font-size:13px;line-height:1.5;"><strong>Fastighetsbeteckning:</strong> ${escapeHtml(cadastralId)}</div>
                          <div style="font-size:13px;line-height:1.5;"><strong>Adress:</strong> ${escapeHtml(propertyAddress)}</div>
                          <div style="font-size:13px;line-height:1.5;"><strong>Kommun:</strong> ${escapeHtml(municipality)}</div>
                          <div style="font-size:13px;line-height:1.5;"><strong>Fastighetsägare:</strong> ${escapeHtml(propertyOwner)}</div>
                        </td></tr>
                      </table>
                    </td>
                    <td style="width:50%;vertical-align:top;padding-left:8px;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fbff;border:1px solid #d9e8ff;border-radius:10px;">
                        <tr><td style="padding:14px;">
                          <div style="font-size:13px;font-weight:700;margin-bottom:8px;color:#1f2937;">Uppdragsgivare</div>
                          <div style="font-size:13px;line-height:1.5;"><strong>Namn:</strong> ${escapeHtml(customerName)}</div>
                          <div style="font-size:13px;line-height:1.5;"><strong>Adress:</strong> ${escapeHtml(customerAddress)}</div>
                          <div style="font-size:13px;line-height:1.5;"><strong>Telefon:</strong> ${escapeHtml(customerPhone)}</div>
                          <div style="font-size:13px;line-height:1.5;"><strong>E-post:</strong> ${escapeHtml(customerEmail)}</div>
                        </td></tr>
                      </table>
                    </td>
                  </tr>
                </table>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:2px;background:#f8fbff;border:1px solid #d9e8ff;border-radius:10px;">
                  <tr><td style="padding:14px;">
                    <div style="font-size:13px;font-weight:700;margin-bottom:8px;color:#1f2937;">Besiktningsdag</div>
                    <div style="font-size:13px;line-height:1.5;"><strong>Datum:</strong> ${escapeHtml(inspectionDate)}</div>
                    <div style="font-size:13px;line-height:1.5;"><strong>Tid:</strong> ${escapeHtml(inspectionTime)}</div>
                    <div style="font-size:13px;line-height:1.5;"><strong>Kostnad:</strong> ${escapeHtml(priceText)}</div>
                  </td></tr>
                </table>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:20px;">
                  <tr>
                    <td align="left">
                      <table role="presentation" cellspacing="0" cellpadding="0">
                        <tr>
                          <td
                            bgcolor="#eef2ff"
                            style="border-radius:10px;border:1px solid #6366f1;box-shadow:0 2px 6px rgba(99,102,241,0.2);"
                          >
                            <a
                              href="${escapeHtml(input.acceptUrl)}"
                              target="_blank"
                              rel="noreferrer"
                              style="display:inline-block;padding:11px 16px;color:#3730a3;text-decoration:none;font-size:14px;font-weight:800;"
                            >
                              &#8599; &Ouml;ppna uppdragsbekr&auml;ftelsen
                            </a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
                <p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:#4b5563;">
                  Länken är giltig till ${escapeHtml(expiresDate)}.
                  Villkorsversion: ${escapeHtml(input.termsVersion)}.
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
    `Vi har skapat en uppdragsbekräftelse för er ${assignmentType} (${roleLabelText}).\n` +
    `För att bekräfta uppdraget, klicka på knappen “Öppna uppdragsbekräftelsen”, fyll i eller kontrollera uppgifterna i formuläret och godkänn villkoren.\n\n` +
    `Öppna uppdragsbekräftelsen: ${input.acceptUrl}\n\n` +
    `Objekt\n` +
    `- Fastighetsbeteckning: ${cadastralId}\n` +
    `- Adress: ${propertyAddress}\n` +
    `- Kommun: ${municipality}\n` +
    `- Fastighetsägare: ${propertyOwner}\n\n` +
    `Uppdragsgivare\n` +
    `- Namn: ${customerName}\n` +
    `- Adress: ${customerAddress}\n` +
    `- Telefon: ${customerPhone}\n` +
    `- E-post: ${customerEmail}\n\n` +
    `Besiktningsdag\n` +
    `- Datum: ${inspectionDate}\n` +
    `- Tid: ${inspectionTime}\n` +
    `- Kostnad: ${priceText}\n\n` +
    `Öppna uppdragsbekräftelse: ${input.acceptUrl}\n` +
    `Länken är giltig till ${expiresDate}.\n` +
    `Villkorsversion: ${input.termsVersion}.`

  return { subject, html, text }
}
