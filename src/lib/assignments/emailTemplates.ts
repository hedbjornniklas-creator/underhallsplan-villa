import 'server-only'

type TermsRole = 'seller' | 'buyer' | 'apartment' | 'technical'
type AssignmentType = 'OB' | 'STATUS' | 'UHP' | 'EB' | 'TU'

type AssignmentForEmail = {
  assignment_type: AssignmentType
  customer_name: string | null
  customer_email: string
  customer_phone: string | null
  customer_address: string | null
  preliminary_address: string | null
  scope_description: string | null
  preferred_date: string | null
  preferred_time: string | null
  price_amount: number | null
  currency: string | null
  property_address: string | null
  property_city: string | null
  property_municipality: string | null
  property_owner_name: string | null
  cadastral_id: string | null
  brf_name: string | null
  apartment_number: string | null
  apartment_holder_name: string | null
}

type AssignmentAddonOrderForEmail = {
  addon_name_snapshot: string
  price_amount_snapshot: number
  currency_snapshot: string
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

export type BuildAssignmentOrderReceiptEmailInput = {
  assignment: AssignmentForEmail
  orgName: string | null
  termsVersion: string
  termsRole: TermsRole
  termsText: string
  acceptedAt: string | null
  addonOrders: AssignmentAddonOrderForEmail[]
}

export type BuildAssignmentOrderReceiptEmailResult = {
  subject: string
  html: string
  text: string
}

export type BuildAssignmentAcceptedNoticeEmailInput = {
  assignment: AssignmentForEmail
  orgName: string | null
  acceptedAt: string | null
}

export type BuildAssignmentAcceptedNoticeEmailResult = {
  subject: string
  html: string
  text: string
}

export type BuildAssignmentCancelledNoticeEmailInput = {
  assignment: AssignmentForEmail
  orgName: string | null
}

export type BuildAssignmentCancelledNoticeEmailResult = {
  subject: string
  html: string
  text: string
}

type CtaButtonOptions = {
  href: string
  label: string
  width: number
  backgroundColor: string
  textColor: string
  borderColor: string
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
  if (type === 'EB') return 'Entreprenadbesiktning'
  if (type === 'TU') return 'Teknisk utredning'
  return 'Överlåtelsebesiktning'
}

function termsRoleToLabel(role: TermsRole, format: 'html' | 'text' = 'text') {
  if (role === 'buyer') return format === 'html' ? 'Köpare' : 'Köpare'
  if (role === 'apartment') return format === 'html' ? 'Lägenhet' : 'Lägenhet'
  if (role === 'technical') return format === 'html' ? 'Teknisk utredning' : 'Teknisk utredning'
  return format === 'html' ? 'Säljare' : 'Säljare'
}

function buildObjectSection(
  termsRole: TermsRole,
  assignment: AssignmentForEmail,
  propertyAddress: string,
  municipality: string
) {
  const isApartmentObject =
    termsRole === 'apartment' ||
    (assignment.assignment_type === 'TU' &&
      (Boolean(assignment.brf_name?.trim()) || Boolean(assignment.apartment_number?.trim())))

  if (isApartmentObject) {
    const brfName = toDisplayValue(assignment.brf_name)
    const apartmentNumber = toDisplayValue(assignment.apartment_number)
    const apartmentHolderName = toDisplayValue(assignment.apartment_holder_name)
    return {
      html: [
        `<div style="font-size:13px;line-height:1.5;"><strong>Adress:</strong> ${escapeHtml(propertyAddress)}</div>`,
        `<div style="font-size:13px;line-height:1.5;"><strong>Kommun:</strong> ${escapeHtml(municipality)}</div>`,
        `<div style="font-size:13px;line-height:1.5;"><strong>Bostadsrättsförening:</strong> ${escapeHtml(brfName)}</div>`,
        `<div style="font-size:13px;line-height:1.5;"><strong>Lägenhetsnummer:</strong> ${escapeHtml(apartmentNumber)}</div>`,
        `<div style="font-size:13px;line-height:1.5;"><strong>Bostadsrättsinnehavare:</strong> ${escapeHtml(apartmentHolderName)}</div>`,
      ].join('\n'),
      text:
        `- Adress: ${propertyAddress}\n` +
        `- Kommun: ${municipality}\n` +
        `- Bostadsrättsförening: ${brfName}\n` +
        `- Lägenhetsnummer: ${apartmentNumber}\n` +
        `- Bostadsrättsinnehavare: ${apartmentHolderName}\n`,
    }
  }

  const cadastralId = toDisplayValue(assignment.cadastral_id)
  const propertyOwner = toDisplayValue(assignment.property_owner_name)
  return {
    html: [
      `<div style="font-size:13px;line-height:1.5;"><strong>Fastighetsbeteckning:</strong> ${escapeHtml(cadastralId)}</div>`,
      `<div style="font-size:13px;line-height:1.5;"><strong>Adress:</strong> ${escapeHtml(propertyAddress)}</div>`,
      `<div style="font-size:13px;line-height:1.5;"><strong>Kommun:</strong> ${escapeHtml(municipality)}</div>`,
      `<div style="font-size:13px;line-height:1.5;"><strong>Fastighetsägare:</strong> ${escapeHtml(propertyOwner)}</div>`,
    ].join('\n'),
    text:
      `- Fastighetsbeteckning: ${cadastralId}\n` +
      `- Adress: ${propertyAddress}\n` +
      `- Kommun: ${municipality}\n` +
      `- Fastighetsägare: ${propertyOwner}\n`,
  }
}

function buildBulletproofButton(options: CtaButtonOptions) {
  const href = escapeHtml(options.href)
  const label = escapeHtml(options.label)

  return `
<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
  href="${href}" style="height:44px;v-text-anchor:middle;width:${options.width}px;" arcsize="12%"
  strokecolor="${options.borderColor}" fillcolor="${options.backgroundColor}">
  <w:anchorlock/>
  <center style="color:${options.textColor};font-family:Arial,sans-serif;font-size:15px;font-weight:700;">
    ${label}
  </center>
</v:roundrect>
<![endif]-->
<!--[if !mso]><!-- -->
<a href="${href}" target="_blank" rel="noreferrer"
  style="display:inline-block;border:1px solid ${options.borderColor};background:${options.backgroundColor};border-radius:10px;color:${options.textColor};font-size:15px;font-weight:700;line-height:1;text-decoration:none;padding:14px 20px;">
  ${label}
</a>
<!--<![endif]-->
  `
}

export function buildAssignmentConfirmationEmail(
  input: BuildAssignmentConfirmationEmailInput
): BuildAssignmentConfirmationEmailResult {
  const customerName = toDisplayValue(input.assignment.customer_name, 'kund')
  const propertyAddress = toDisplayValue(
    input.assignment.property_address ?? input.assignment.preliminary_address
  )
  const municipality = toDisplayValue(
    input.assignment.property_municipality ?? input.assignment.property_city
  )
  const objectSection = buildObjectSection(
    input.termsRole,
    input.assignment,
    propertyAddress,
    municipality
  )
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
  const isTechnicalAssignment = input.assignment.assignment_type === 'TU'
  const scopeDescription = toDisplayValue(input.assignment.scope_description)
  const assignmentHeadingHtml = isTechnicalAssignment
    ? 'Teknisk utredning'
    : `&Ouml;verl&aring;telsebesiktning f&ouml;r
                  <span style="display:inline-block;margin-left:8px;padding:5px 12px;border-radius:999px;background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.45);">${roleLabelHtml}</span>`
  const assignmentHeadingText = isTechnicalAssignment
    ? 'Teknisk utredning'
    : `Överlåtelsebesiktning för ${roleLabelText}`
  const roleSuffixText = isTechnicalAssignment ? '' : ` (${roleLabelText})`
  const orgName = toDisplayValue(input.orgName, 'BesiktApp')
  const subject = `Uppdragsbekr\u00e4ftelse - ${orgName}`
  const ctaButton = buildBulletproofButton({
    href: input.acceptUrl,
    label: 'Öppna uppdragsbekräftelsen',
    width: 300,
    backgroundColor: '#3730a3',
    textColor: '#ffffff',
    borderColor: '#312e81',
  })

  const html = `
<!doctype html>
<html lang="sv">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
    <meta charset="utf-8" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Uppdragsbekräftelse</title>
  </head>
  <body style="margin:0;padding:0;background:#eef3ff;font-family:Segoe UI,Arial,sans-serif;color:#1f2937;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef3ff;padding:12px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="width:100%;max-width:640px;background:#ffffff;border:1px solid #dbe4ff;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:14px 20px;background:#1d4ed8;background-image:linear-gradient(135deg,#1e3a8a 0%,#1d4ed8 48%,#60a5fa 100%);color:#ffffff;">
                <div style="font-size:20px;font-weight:700;letter-spacing:0.02em;">UPPDRAGSBEKR&Auml;FTELSE</div>
                <div style="margin-top:10px;font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">
                  ${assignmentHeadingHtml}
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 24px 24px;">
                <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 14px;">
                  <tr>
                    <td
                      style="vertical-align:middle;font-size:44px;line-height:1;font-weight:700;color:#111827;mso-line-height-rule:exactly;"
                    >
                      &#10003;
                    </td>
                    <td style="vertical-align:middle;padding-left:8px;font-size:36px;font-weight:800;line-height:1;color:#111827;">
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
                      ${ctaButton}
                    </td>
                  </tr>
                </table>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;border-spacing:0 10px;">
                  <tr>
                    <td style="width:50%;vertical-align:top;padding-right:8px;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fbff;border:1px solid #d9e8ff;border-radius:10px;">
                        <tr><td style="padding:14px;">
                          <div style="font-size:13px;font-weight:700;margin-bottom:8px;color:#1f2937;">Objekt</div>
                          ${objectSection.html}
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
                    <div style="font-size:13px;font-weight:700;margin-bottom:8px;color:#1f2937;">${isTechnicalAssignment ? 'Utredningstillfälle' : 'Besiktningsdag'}</div>
                    <div style="font-size:13px;line-height:1.5;"><strong>Datum:</strong> ${escapeHtml(inspectionDate)}</div>
                    <div style="font-size:13px;line-height:1.5;"><strong>Tid:</strong> ${escapeHtml(inspectionTime)}</div>
                    <div style="font-size:13px;line-height:1.5;"><strong>Kostnad:</strong> ${escapeHtml(priceText)}</div>
                  </td></tr>
                </table>
                ${
                  isTechnicalAssignment
                    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:12px;background:#f8fbff;border:1px solid #d9e8ff;border-radius:10px;">
                  <tr><td style="padding:14px;">
                    <div style="font-size:13px;font-weight:700;margin-bottom:8px;color:#1f2937;">Utredningens omfattning</div>
                    <div style="font-size:13px;line-height:1.5;white-space:pre-wrap;">${escapeHtml(scopeDescription)}</div>
                  </td></tr>
                </table>`
                    : ''
                }
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:20px;">
                  <tr>
                    <td align="left">
                      ${ctaButton}
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
    `Vi har skapat en uppdragsbekräftelse för er ${assignmentType}${roleSuffixText}.\n` +
    `För att bekräfta uppdraget, klicka på knappen “Öppna uppdragsbekräftelsen”, fyll i eller kontrollera uppgifterna i formuläret och godkänn villkoren.\n\n` +
    `Öppna uppdragsbekräftelsen: ${input.acceptUrl}\n\n` +
    `${assignmentHeadingText}\n\n` +
    `Objekt\n` +
    `${objectSection.text}\n` +
    `Uppdragsgivare\n` +
    `- Namn: ${customerName}\n` +
    `- Adress: ${customerAddress}\n` +
    `- Telefon: ${customerPhone}\n` +
    `- E-post: ${customerEmail}\n\n` +
    `${isTechnicalAssignment ? 'Utredningstillfälle' : 'Besiktningsdag'}\n` +
    `- Datum: ${inspectionDate}\n` +
    `- Tid: ${inspectionTime}\n` +
    `- Kostnad: ${priceText}\n\n` +
    `${isTechnicalAssignment ? `Utredningens omfattning\n${scopeDescription}\n\n` : ''}` +
    `Öppna uppdragsbekräftelse: ${input.acceptUrl}\n` +
    `Länken är giltig till ${expiresDate}.\n` +
    `Villkorsversion: ${input.termsVersion}.`

  return { subject, html, text }
}

export function buildAssignmentOrderReceiptEmail(
  input: BuildAssignmentOrderReceiptEmailInput
): BuildAssignmentOrderReceiptEmailResult {
  const customerName = toDisplayValue(input.assignment.customer_name, 'kund')
  const propertyAddress = toDisplayValue(
    input.assignment.property_address ?? input.assignment.preliminary_address
  )
  const municipality = toDisplayValue(
    input.assignment.property_municipality ?? input.assignment.property_city
  )
  const objectSection = buildObjectSection(
    input.termsRole,
    input.assignment,
    propertyAddress,
    municipality
  )
  const customerAddress = toDisplayValue(input.assignment.customer_address)
  const customerPhone = toDisplayValue(input.assignment.customer_phone)
  const customerEmail = toDisplayValue(input.assignment.customer_email)
  const inspectionDate = toSwedishDateString(input.assignment.preferred_date)
  const inspectionTime = toSwedishTimeString(input.assignment.preferred_time)
  const priceText = formatPriceAmount(input.assignment.price_amount, input.assignment.currency)
  const acceptedAt = input.acceptedAt
    ? new Date(input.acceptedAt).toLocaleString('sv-SE')
    : 'Ej satt'
  const roleLabelHtml = termsRoleToLabel(input.termsRole, 'html')
  const roleLabelText = termsRoleToLabel(input.termsRole, 'text')
  const assignmentType = assignmentTypeToLabel(input.assignment.assignment_type)
  const isTechnicalAssignment = input.assignment.assignment_type === 'TU'
  const scopeDescription = toDisplayValue(input.assignment.scope_description)
  const assignmentHeadingHtml = isTechnicalAssignment
    ? 'Teknisk utredning'
    : `Överlåtelsebesiktning för
                  <span style="display:inline-block;margin-left:8px;padding:5px 12px;border-radius:999px;background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.45);">${roleLabelHtml}</span>`
  const roleSuffixText = isTechnicalAssignment ? '' : ` (${roleLabelText})`
  const orgName = toDisplayValue(input.orgName, 'HusHub')
  const subject = `Beställningsbekräftelse - ${orgName}`

  const addonRowsHtml =
    input.addonOrders.length === 0
      ? '<div style="font-size:13px;color:#4b5563;">Inga tilläggsuppdrag valda.</div>'
      : input.addonOrders
          .map((addon) => {
            const addonName = escapeHtml(toDisplayValue(addon.addon_name_snapshot))
            const addonPrice = escapeHtml(
              formatPriceAmount(addon.price_amount_snapshot, addon.currency_snapshot)
            )
            return `<tr>
              <td style="padding:8px 10px;border-top:1px solid #e5e7eb;font-size:13px;color:#111827;">${addonName}</td>
              <td style="padding:8px 10px;border-top:1px solid #e5e7eb;font-size:13px;color:#111827;text-align:right;">${addonPrice}</td>
            </tr>`
          })
          .join('')

  const addonRowsText =
    input.addonOrders.length === 0
      ? '- Inga tilläggsuppdrag valda.'
      : input.addonOrders
          .map((addon) => {
            const addonName = toDisplayValue(addon.addon_name_snapshot)
            const addonPrice = formatPriceAmount(addon.price_amount_snapshot, addon.currency_snapshot)
            return `- ${addonName}: ${addonPrice}`
          })
          .join('\n')

  const html = `
<!doctype html>
<html lang="sv">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
    <meta charset="utf-8" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Beställningsbekräftelse</title>
  </head>
  <body style="margin:0;padding:0;background:#eef3ff;font-family:Segoe UI,Arial,sans-serif;color:#111827;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef3ff;padding:12px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="width:100%;max-width:640px;background:#ffffff;border:1px solid #dbe4ff;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:14px 20px;background:#1d4ed8;background-image:linear-gradient(135deg,#1e3a8a 0%,#1d4ed8 48%,#60a5fa 100%);color:#ffffff;">
                <div style="font-size:20px;font-weight:700;letter-spacing:0.02em;">BESTÄLLNINGSBEKRÄFTELSE</div>
                <div style="margin-top:10px;font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">
                  ${assignmentHeadingHtml}
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px 24px;">
                <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 14px;">
                  <tr>
                    <td style="vertical-align:middle;font-size:44px;line-height:1;font-weight:700;color:#111827;mso-line-height-rule:exactly;">&#10003;</td>
                    <td style="vertical-align:middle;padding-left:8px;font-size:36px;font-weight:800;line-height:1;color:#111827;">HusHub</td>
                  </tr>
                </table>

                <p style="margin:0 0 10px;font-size:15px;">Hej ${escapeHtml(customerName)},</p>
                <p style="margin:0 0 16px;font-size:14px;line-height:1.55;">
                  Här är en sammanställning av er bekräftade beställning inklusive villkorstext.
                </p>

                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 14px;background:#f8fbff;border:1px solid #d9e8ff;border-radius:10px;">
                  <tr><td style="padding:12px 14px;">
                    <div style="font-size:13px;line-height:1.5;"><strong>Typ:</strong> ${escapeHtml(assignmentType)}</div>
                    <div style="font-size:13px;line-height:1.5;"><strong>Accepterad:</strong> ${escapeHtml(acceptedAt)}</div>
                    <div style="font-size:13px;line-height:1.5;"><strong>Villkorsversion:</strong> ${escapeHtml(input.termsVersion)}</div>
                  </td></tr>
                </table>

                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;border-spacing:0 10px;">
                  <tr>
                    <td style="width:50%;vertical-align:top;padding-right:8px;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fbff;border:1px solid #d9e8ff;border-radius:10px;">
                        <tr><td style="padding:14px;">
                          <div style="font-size:13px;font-weight:700;margin-bottom:8px;color:#1f2937;">Objekt</div>
                          ${objectSection.html}
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
                    <div style="font-size:13px;font-weight:700;margin-bottom:8px;color:#1f2937;">${isTechnicalAssignment ? 'Utredningstillfälle' : 'Besiktningsdag'}</div>
                    <div style="font-size:13px;line-height:1.5;"><strong>Datum:</strong> ${escapeHtml(inspectionDate)}</div>
                    <div style="font-size:13px;line-height:1.5;"><strong>Tid:</strong> ${escapeHtml(inspectionTime)}</div>
                    <div style="font-size:13px;line-height:1.5;"><strong>Kostnad:</strong> ${escapeHtml(priceText)}</div>
                  </td></tr>
                </table>
                ${
                  isTechnicalAssignment
                    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:12px;background:#f8fbff;border:1px solid #d9e8ff;border-radius:10px;">
                  <tr><td style="padding:14px;">
                    <div style="font-size:13px;font-weight:700;margin-bottom:8px;color:#1f2937;">Utredningens omfattning</div>
                    <div style="font-size:13px;line-height:1.5;white-space:pre-wrap;">${escapeHtml(scopeDescription)}</div>
                  </td></tr>
                </table>`
                    : ''
                }

                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:12px;background:#f8fbff;border:1px solid #d9e8ff;border-radius:10px;overflow:hidden;">
                  <tr>
                    <td style="padding:12px 14px;font-size:13px;font-weight:700;color:#1f2937;border-bottom:1px solid #d9e8ff;">
                      Valda tilläggsuppdrag
                    </td>
                  </tr>
                  ${
                    input.addonOrders.length === 0
                      ? `<tr><td style="padding:12px 14px;font-size:13px;color:#4b5563;">Inga tilläggsuppdrag valda.</td></tr>`
                      : `<tr><td style="padding:0;">
                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                          <tr>
                            <th style="padding:8px 10px;text-align:left;font-size:12px;color:#4b5563;background:#f3f4f6;">Tjänst</th>
                            <th style="padding:8px 10px;text-align:right;font-size:12px;color:#4b5563;background:#f3f4f6;">Pris</th>
                          </tr>
                          ${addonRowsHtml}
                        </table>
                      </td></tr>`
                  }
                </table>

                <div style="margin-top:12px;padding:12px 14px;background:#f8fbff;border:1px solid #d9e8ff;border-radius:10px;">
                  <div style="font-size:13px;font-weight:700;margin-bottom:8px;color:#1f2937;">
                    Villkor (version ${escapeHtml(input.termsVersion)})
                  </div>
                  <pre style="margin:0;white-space:pre-wrap;word-break:break-word;font-family:Consolas,Menlo,monospace;font-size:12px;line-height:1.45;color:#111827;">${escapeHtml(
                    input.termsText
                  )}</pre>
                </div>
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
    `Här är en sammanställning av er bekräftade beställning inklusive villkorstext.\n\n` +
    `Typ: ${assignmentType}${roleSuffixText}\n` +
    `Accepterad: ${acceptedAt}\n` +
    `Villkorsversion: ${input.termsVersion}\n\n` +
    `Objekt\n` +
    `${objectSection.text}\n` +
    `Uppdragsgivare\n` +
    `- Namn: ${customerName}\n` +
    `- Adress: ${customerAddress}\n` +
    `- Telefon: ${customerPhone}\n` +
    `- E-post: ${customerEmail}\n\n` +
    `${isTechnicalAssignment ? 'Utredningstillfälle' : 'Besiktningsdag'}\n` +
    `- Datum: ${inspectionDate}\n` +
    `- Tid: ${inspectionTime}\n` +
    `- Kostnad: ${priceText}\n\n` +
    `${isTechnicalAssignment ? `Utredningens omfattning\n${scopeDescription}\n\n` : ''}` +
    `Valda tilläggsuppdrag\n` +
    `${addonRowsText}\n\n` +
    `Villkor (version ${input.termsVersion})\n` +
    `${input.termsText}`

  return { subject, html, text }
}

export function buildAssignmentAcceptedNoticeEmail(
  input: BuildAssignmentAcceptedNoticeEmailInput
): BuildAssignmentAcceptedNoticeEmailResult {
  const customerName = toDisplayValue(input.assignment.customer_name, 'kund')
  const assignmentType = assignmentTypeToLabel(input.assignment.assignment_type)
  const acceptedAt = input.acceptedAt
    ? new Date(input.acceptedAt).toLocaleString('sv-SE')
    : 'nyss'
  const orgName = toDisplayValue(input.orgName, 'HusHub')
  const subject = `Vi har mottagit er uppdragsbekräftelse - ${orgName}`

  const html = `
<!doctype html>
<html lang="sv">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
    <meta charset="utf-8" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Bekräftelse mottagen</title>
  </head>
  <body style="margin:0;padding:0;background:#eef3ff;font-family:Segoe UI,Arial,sans-serif;color:#111827;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef3ff;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="width:100%;max-width:640px;background:#ffffff;border:1px solid #dbe4ff;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:14px 20px;background:#1d4ed8;background-image:linear-gradient(135deg,#1e3a8a 0%,#1d4ed8 48%,#60a5fa 100%);color:#ffffff;">
                <div style="font-size:20px;font-weight:700;letter-spacing:0.02em;">BEKRÄFTELSE MOTTAGEN</div>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 24px 22px;">
                <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 14px;">
                  <tr>
                    <td style="vertical-align:middle;font-size:36px;line-height:1;font-weight:700;color:#111827;mso-line-height-rule:exactly;">&#10003;</td>
                    <td style="vertical-align:middle;padding-left:8px;font-size:30px;font-weight:800;line-height:1;color:#111827;">HusHub</td>
                  </tr>
                </table>
                <p style="margin:0 0 10px;font-size:15px;">Hej ${escapeHtml(customerName)},</p>
                <p style="margin:0 0 10px;font-size:14px;line-height:1.55;">
                  Vi har mottagit er godkända uppdragsbekräftelse för ${escapeHtml(assignmentType)}.
                </p>
                <p style="margin:0 0 10px;font-size:14px;line-height:1.55;">
                  Besiktningsmannen går nu igenom beställningen och bekräftar uppdraget.
                </p>
                <p style="margin:0;font-size:13px;color:#4b5563;">Mottagen: ${escapeHtml(acceptedAt)}</p>
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
    `Vi har mottagit er godkända uppdragsbekräftelse för ${assignmentType}.\n` +
    `Besiktningsmannen går nu igenom beställningen och bekräftar uppdraget.\n\n` +
    `Mottagen: ${acceptedAt}`

  return { subject, html, text }
}

export function buildAssignmentCancelledNoticeEmail(
  input: BuildAssignmentCancelledNoticeEmailInput
): BuildAssignmentCancelledNoticeEmailResult {
  const customerName = toDisplayValue(input.assignment.customer_name, 'kund')
  const assignmentType = assignmentTypeToLabel(input.assignment.assignment_type)
  const orgName = toDisplayValue(input.orgName, 'HusHub')
  const subject = `Tidigare uppdragsbekräftelse är makulerad - ${orgName}`

  const html = `
<!doctype html>
<html lang="sv">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
    <meta charset="utf-8" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Uppdragsbekräftelse makulerad</title>
  </head>
  <body style="margin:0;padding:0;background:#eef3ff;font-family:Segoe UI,Arial,sans-serif;color:#111827;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef3ff;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="width:100%;max-width:640px;background:#ffffff;border:1px solid #dbe4ff;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:14px 20px;background:#1d4ed8;background-image:linear-gradient(135deg,#1e3a8a 0%,#1d4ed8 48%,#60a5fa 100%);color:#ffffff;">
                <div style="font-size:20px;font-weight:700;letter-spacing:0.02em;">UPPDRAGSBEKRÄFTELSE MAKULERAD</div>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 24px 22px;">
                <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 14px;">
                  <tr>
                    <td style="vertical-align:middle;font-size:36px;line-height:1;font-weight:700;color:#111827;mso-line-height-rule:exactly;">&#10003;</td>
                    <td style="vertical-align:middle;padding-left:8px;font-size:30px;font-weight:800;line-height:1;color:#111827;">HusHub</td>
                  </tr>
                </table>
                <p style="margin:0 0 10px;font-size:15px;">Hej ${escapeHtml(customerName)},</p>
                <p style="margin:0 0 10px;font-size:14px;line-height:1.55;">
                  Den tidigare uppdragsbekräftelsen för ${escapeHtml(assignmentType)} har makulerats.
                </p>
                <p style="margin:0;font-size:14px;line-height:1.55;">
                  En ny uppdragsbekräftelse skickas separat för nytt godkännande.
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
    `Den tidigare uppdragsbekräftelsen för ${assignmentType} har makulerats.\n` +
    `En ny uppdragsbekräftelse skickas separat för nytt godkännande.`

  return { subject, html, text }
}
