import React from 'react'
import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
  type DocumentProps,
} from '@react-pdf/renderer'

type AssignmentType = 'OB' | 'STATUS' | 'UHP' | 'EB' | 'TU'

type PdfAssignment = {
  id: string
  assignment_type: AssignmentType
  customer_name: string | null
  customer_email: string
  customer_phone: string | null
  customer_address: string | null
  customer_postal_code: string | null
  customer_city: string | null
  preliminary_address: string | null
  scope_description: string | null
  preferred_date: string | null
  preferred_time: string | null
  price_amount: number | null
  currency: string | null
  property_address: string | null
  property_postal_code: string | null
  property_city: string | null
  property_municipality: string | null
  property_owner_name: string | null
  cadastral_id: string | null
  brf_name: string | null
  apartment_number: string | null
  apartment_holder_name: string | null
  invoice_name: string | null
  invoice_address: string | null
  invoice_email: string | null
  personal_identity_number: string | null
  orderer_role: string | null
  accepted_at: string | null
  terms_version: string | null
  terms_document_hash: string | null
  assignment_details: Record<string, unknown> | null
}

export type AssignmentConfirmationPdfInspector = {
  fullName: string | null
  email: string | null
  phone: string | null
  companyName: string | null
  companyOrgNo: string | null
  companyAddress: string | null
  companyPostalCode: string | null
  companyCity: string | null
  sbrGroup: string | null
  sbrStatus: string | null
  membershipNumber: string | null
  certificationNumber: string | null
  certifications: Array<{
    name: string
    number: string | null
    validTo: string | null
  }>
}

export type AssignmentConfirmationPdfAddon = {
  name: string
  priceAmount: number
  currency: string
}

export type AcceptedAssignmentConfirmationPdfInput = {
  assignment: PdfAssignment
  issuerName: string | null
  inspector: AssignmentConfirmationPdfInspector | null
  addonOrders: AssignmentConfirmationPdfAddon[]
  acceptancePayload: Record<string, unknown> | null
  terms: {
    role: string
    version: string
    documentHash: string
    text: string
  }
}

type Fact = {
  label: string
  value: string
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 22,
    paddingBottom: 48,
    paddingHorizontal: 40,
    fontFamily: 'Helvetica',
    fontSize: 9.5,
    lineHeight: 1.42,
    color: '#172033',
    backgroundColor: '#ffffff',
  },
  pageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    color: '#526079',
    fontSize: 7.8,
    marginBottom: 14,
  },
  footerContainer: {
    position: 'absolute',
    bottom: 19,
    left: 40,
    right: 40,
  },
  footer: {
    color: '#667085',
    fontSize: 7.8,
    textAlign: 'center',
  },
  hero: {
    borderRadius: 8,
    paddingVertical: 18,
    paddingHorizontal: 20,
    marginBottom: 16,
    backgroundColor: '#1d4ed8',
    color: '#ffffff',
  },
  heroEyebrow: {
    fontSize: 8.5,
    fontWeight: 700,
    letterSpacing: 1.1,
    marginBottom: 5,
  },
  heroTitle: {
    fontSize: 21,
    fontWeight: 700,
    marginBottom: 5,
  },
  heroSubtitle: {
    fontSize: 10.5,
    color: '#dbeafe',
  },
  acceptanceBox: {
    borderWidth: 1,
    borderColor: '#bbf7d0',
    backgroundColor: '#f0fdf4',
    borderRadius: 7,
    padding: 11,
    marginBottom: 13,
  },
  acceptanceTitle: {
    color: '#166534',
    fontSize: 11,
    fontWeight: 700,
    marginBottom: 5,
  },
  acceptanceText: {
    color: '#235b36',
    fontSize: 9,
    marginBottom: 2,
  },
  acceptanceMeta: {
    color: '#336447',
    fontSize: 7.8,
    marginTop: 2,
  },
  section: {
    borderWidth: 1,
    borderColor: '#d8e1ef',
    borderRadius: 7,
    marginBottom: 11,
    overflow: 'hidden',
  },
  sectionTitle: {
    paddingVertical: 7,
    paddingHorizontal: 10,
    backgroundColor: '#eef4ff',
    color: '#1e3a8a',
    fontSize: 10.5,
    fontWeight: 700,
  },
  sectionBody: {
    paddingVertical: 7,
    paddingHorizontal: 10,
  },
  factRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#e8edf5',
    paddingVertical: 4,
  },
  factRowLast: {
    borderBottomWidth: 0,
  },
  factLabel: {
    width: '35%',
    paddingRight: 10,
    color: '#475467',
    fontWeight: 700,
  },
  factValue: {
    width: '65%',
    color: '#101828',
  },
  longFact: {
    marginTop: 6,
    borderTopWidth: 0.5,
    borderTopColor: '#e8edf5',
    paddingTop: 7,
  },
  longFactLabel: {
    color: '#475467',
    fontWeight: 700,
    marginBottom: 3,
  },
  longFactValue: {
    color: '#101828',
  },
  termsIntro: {
    borderWidth: 1,
    borderColor: '#d8e1ef',
    backgroundColor: '#f8fafc',
    borderRadius: 7,
    padding: 10,
    marginBottom: 13,
  },
  termsTitle: {
    color: '#102a68',
    fontSize: 17,
    fontWeight: 700,
    marginBottom: 5,
  },
  termsMeta: {
    color: '#526079',
    fontSize: 8.5,
    marginBottom: 2,
  },
  termsHeading: {
    color: '#172033',
    fontSize: 10.5,
    fontWeight: 700,
    marginTop: 8,
    marginBottom: 3,
  },
  termsParagraph: {
    color: '#25324a',
    fontSize: 8.7,
    lineHeight: 1.45,
    marginBottom: 4,
  },
  termsBullet: {
    color: '#25324a',
    fontSize: 8.7,
    lineHeight: 1.45,
    marginBottom: 2,
    paddingLeft: 8,
  },
  termsSpacer: {
    height: 3,
  },
  copyNotice: {
    color: '#526079',
    fontSize: 8,
    marginTop: 3,
  },
  twoColumnRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  twoColumnLeft: {
    width: '49%',
    marginRight: '1%',
  },
  twoColumnRight: {
    width: '49%',
    marginLeft: '1%',
  },
})

const h = React.createElement

function normalizePdfText(value: unknown) {
  return String(value ?? '')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u00a0\u2002\u2003\u2007\u202f]/g, ' ')
    .replace(/\t/g, '  ')
    .replace(/\r\n?/g, '\n')
    .trim()
}

function displayText(value: unknown, fallback = 'Ej angivet') {
  const normalized = normalizePdfText(value)
  return normalized || fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function snapshotValue(
  payload: Record<string, unknown> | null,
  key: string,
  fallback: unknown
) {
  if (payload && Object.prototype.hasOwnProperty.call(payload, key)) return payload[key]
  return fallback
}

function detailText(details: Record<string, unknown>, key: string, fallback = 'Ej angivet') {
  return displayText(details[key], fallback)
}

function detailNumber(details: Record<string, unknown>, key: string) {
  const value = details[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function formatDate(value: unknown) {
  const normalized = normalizePdfText(value)
  const dateOnly = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (dateOnly) return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`
  if (!normalized) return 'Ej angivet'
  const parsed = new Date(normalized)
  if (Number.isNaN(parsed.getTime())) return normalized
  return new Intl.DateTimeFormat('sv-SE', {
    dateStyle: 'short',
    timeZone: 'Europe/Stockholm',
  }).format(parsed)
}

function formatDateTime(value: unknown) {
  const normalized = normalizePdfText(value)
  if (!normalized) return 'Ej angivet'
  const parsed = new Date(normalized)
  if (Number.isNaN(parsed.getTime())) return normalized
  return new Intl.DateTimeFormat('sv-SE', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Europe/Stockholm',
  }).format(parsed)
}

function formatTime(value: unknown) {
  const normalized = normalizePdfText(value)
  if (!normalized) return 'Ej angivet'
  return /^\d{2}:\d{2}/.test(normalized) ? normalized.slice(0, 5) : normalized
}

function formatMoney(value: unknown, currency: unknown, fallback = 'Ej angivet') {
  const amount = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(amount)) return fallback
  const currencyCode = displayText(currency, 'SEK').toUpperCase()
  try {
    return new Intl.NumberFormat('sv-SE', {
      style: 'currency',
      currency: currencyCode,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `${amount.toLocaleString('sv-SE')} ${currencyCode}`
  }
}

function assignmentTypeLabel(type: AssignmentType) {
  if (type === 'STATUS') return 'Statusbesiktning'
  if (type === 'UHP') return 'Underhållsplan'
  if (type === 'EB') return 'Entreprenadbesiktning'
  if (type === 'TU') return 'Teknisk utredning'
  return 'Överlåtelsebesiktning'
}

function termsHeading(role: string) {
  if (role === 'construction_consumer') {
    return 'Villkor för entreprenadbesiktning - privat konsument'
  }
  if (role === 'construction_business') return 'Villkor för entreprenadbesiktning - företag'
  if (role === 'construction') return 'Villkor för entreprenadbesiktning'
  if (role === 'technical') return 'Villkor för teknisk utredning'
  if (role === 'apartment') return 'Villkor för lägenhetsbesiktning'
  if (role === 'buyer') return 'Villkor för överlåtelsebesiktning - köpare'
  return 'Villkor för överlåtelsebesiktning - säljare'
}

function joinAddress(parts: unknown[]) {
  return parts.map((part) => normalizePdfText(part)).filter(Boolean).join(', ')
}

function joinInvoiceAddress(address: unknown, postalCode: unknown, city: unknown) {
  const addressText = normalizePdfText(address)
  const postalCodeText = normalizePdfText(postalCode)
  const cityText = normalizePdfText(city)
  const normalizedAddress = addressText.toLocaleLowerCase('sv-SE')
  const alreadyContainsPostalCode =
    Boolean(postalCodeText) && normalizedAddress.includes(postalCodeText.toLocaleLowerCase('sv-SE'))
  const alreadyContainsCity =
    Boolean(cityText) && normalizedAddress.includes(cityText.toLocaleLowerCase('sv-SE'))

  if (alreadyContainsPostalCode || alreadyContainsCity) return addressText || 'Ej angivet'
  const postalLine = [postalCodeText, cityText].filter(Boolean).join(' ')
  return [addressText, postalLine].filter(Boolean).join(', ') || 'Ej angivet'
}

function formatHash(hash: string) {
  return normalizePdfText(hash).replace(/(.{8})(?=.)/g, '$1 ')
}

function hasPositiveNumber(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) && number > 0
}

function FactRows({ facts }: { facts: Fact[] }) {
  return h(
    React.Fragment,
    null,
    ...facts.map((fact, index) =>
      h(
        View,
        {
          key: `${fact.label}-${index}`,
          style: [styles.factRow, index === facts.length - 1 ? styles.factRowLast : {}],
          wrap: false,
        },
        h(Text, { style: styles.factLabel }, normalizePdfText(fact.label)),
        h(Text, { style: styles.factValue }, displayText(fact.value))
      )
    )
  )
}

function LongFact({ label, value }: Fact) {
  return h(
    View,
    { style: styles.longFact },
    h(Text, { style: styles.longFactLabel }, normalizePdfText(label)),
    h(Text, { style: styles.longFactValue }, displayText(value))
  )
}

function Section({
  title,
  facts,
  longFacts = [],
  breakable = false,
}: {
  title: string
  facts: Fact[]
  longFacts?: Fact[]
  breakable?: boolean
}) {
  return h(
    View,
    { style: styles.section, wrap: breakable },
    h(Text, { style: styles.sectionTitle, minPresenceAhead: 40 }, normalizePdfText(title)),
    h(
      View,
      { style: styles.sectionBody },
      h(FactRows, { facts }),
      ...longFacts.map((fact, index) => h(LongFact, { key: `${fact.label}-${index}`, ...fact }))
    )
  )
}

function pageFurniture(
  issuerName: string,
  assignmentId: string,
  pageNumber: number,
  totalPages: number
) {
  return [
    h(
      View,
      { key: `page-header-${pageNumber}`, style: styles.pageHeader },
      h(Text, null, normalizePdfText(issuerName)),
      h(Text, null, `Uppdrag ${normalizePdfText(assignmentId).slice(0, 8)}`)
    ),
    h(
      View,
      {
        key: `page-footer-${pageNumber}`,
        style: styles.footerContainer,
      },
      h(
        Text,
        { style: styles.footer },
        `Uppdragsbekräftelse | Sida ${pageNumber} av ${totalPages}`
      )
    ),
  ]
}

function looksLikeHeading(line: string) {
  if (line.length === 0 || line.length > 95) return false
  if (/^[\-*]\s/.test(line)) return false
  if (/[.!?;:]$/.test(line)) return false
  return true
}

function TermsText({ lines, keyPrefix }: { lines: string[]; keyPrefix: string }) {
  return h(
    React.Fragment,
    null,
    ...lines.map((rawLine, index) => {
      const line = rawLine.trim().replace(/^•\s*/, '- ')
      if (!line) return h(View, { key: `${keyPrefix}-space-${index}`, style: styles.termsSpacer })
      if (looksLikeHeading(line)) {
        return h(
          Text,
          {
            key: `${keyPrefix}-heading-${index}`,
            style: styles.termsHeading,
            minPresenceAhead: 28,
          },
          line
        )
      }
      const isBullet = /^[-*]\s+/.test(line)
      return h(
        Text,
        {
          key: `${keyPrefix}-line-${index}`,
          style: isBullet ? styles.termsBullet : styles.termsParagraph,
          orphans: 2,
          widows: 2,
        },
        line
      )
    })
  )
}

function estimateTermsLineCost(line: string) {
  const normalized = line.trim()
  if (!normalized) return 0.35
  if (looksLikeHeading(normalized)) return Math.max(1, Math.ceil(normalized.length / 78)) + 0.9
  return Math.max(1, Math.ceil(normalized.length / 105)) + 0.35
}

function splitTermsIntoPageChunks(text: string) {
  const lines = normalizePdfText(text).split('\n')
  const chunks: string[][] = []
  let current: string[] = []
  let currentCost = 0

  for (const line of lines) {
    const lineCost = estimateTermsLineCost(line)
    const capacity = chunks.length === 0 ? 43 : 50
    if (current.length > 0 && currentCost + lineCost > capacity) {
      while (current.length > 0 && current[current.length - 1]?.trim() === '') current.pop()
      chunks.push(current)
      current = []
      currentCost = 0
    }
    current.push(line)
    currentCost += lineCost
  }

  while (current.length > 0 && current[current.length - 1]?.trim() === '') current.pop()
  if (current.length > 0) chunks.push(current)
  return chunks.length > 0 ? chunks : [['Villkorstext saknas.']]
}

function AcceptedAssignmentConfirmationDocument({
  assignment,
  issuerName,
  inspector,
  addonOrders,
  acceptancePayload,
  terms,
}: AcceptedAssignmentConfirmationPdfInput) {
  const resolvedIssuer = displayText(issuerName ?? inspector?.companyName, 'HusHub')
  const typeLabel = assignmentTypeLabel(assignment.assignment_type)
  const payload = acceptancePayload
  const detailsValue = snapshotValue(payload, 'assignment_details', assignment.assignment_details)
  const details = isRecord(detailsValue) ? detailsValue : {}
  const currency = snapshotValue(payload, 'currency', assignment.currency ?? 'SEK')
  const acceptedAt = assignment.accepted_at
  const customerName = snapshotValue(payload, 'customer_name', assignment.customer_name)
  const customerEmail = snapshotValue(payload, 'customer_email', assignment.customer_email)
  const customerPhone = snapshotValue(payload, 'customer_phone', assignment.customer_phone)
  const customerAddress = snapshotValue(payload, 'customer_address', assignment.customer_address)
  const customerPostalCode = snapshotValue(
    payload,
    'customer_postal_code',
    assignment.customer_postal_code
  )
  const customerCity = snapshotValue(payload, 'customer_city', assignment.customer_city)
  const propertyAddress = snapshotValue(
    payload,
    'property_address',
    assignment.property_address ?? assignment.preliminary_address
  )
  const propertyPostalCode = snapshotValue(
    payload,
    'property_postal_code',
    assignment.property_postal_code
  )
  const propertyCity = snapshotValue(payload, 'property_city', assignment.property_city)
  const propertyMunicipality = snapshotValue(
    payload,
    'property_municipality',
    assignment.property_municipality
  )
  const scopeDescription = snapshotValue(payload, 'scope_description', assignment.scope_description)
  const ordererRole = snapshotValue(payload, 'orderer_role', assignment.orderer_role)
  const preferredDate = snapshotValue(payload, 'preferred_date', assignment.preferred_date)
  const preferredTime = snapshotValue(payload, 'preferred_time', assignment.preferred_time)
  const priceAmount = snapshotValue(payload, 'price_amount', assignment.price_amount)
  const cadastralId = snapshotValue(payload, 'cadastral_id', assignment.cadastral_id)
  const propertyOwnerName = snapshotValue(
    payload,
    'property_owner_name',
    assignment.property_owner_name
  )
  const brfName = snapshotValue(payload, 'brf_name', assignment.brf_name)
  const apartmentNumber = snapshotValue(payload, 'apartment_number', assignment.apartment_number)
  const apartmentHolderName = snapshotValue(
    payload,
    'apartment_holder_name',
    assignment.apartment_holder_name
  )
  const isApartment = Boolean(normalizePdfText(brfName) || normalizePdfText(apartmentNumber))
  const isEb = assignment.assignment_type === 'EB'
  const isConsumerEb = terms.role === 'construction_consumer'
  const pricingModel = detailText(details, 'pricingModel', 'fixed')
  const priceLabel = isEb ? (pricingModel === 'hourly' ? 'Timpris' : 'Fast pris') : 'Pris'

  const objectFacts: Fact[] = [
    { label: 'Adress', value: displayText(propertyAddress) },
    {
      label: 'Postnummer och ort',
      value: joinAddress([propertyPostalCode, propertyCity]) || 'Ej angivet',
    },
    { label: 'Kommun', value: displayText(propertyMunicipality) },
    ...(isApartment
      ? [
          { label: 'Bostadsrättsförening', value: displayText(brfName) },
          { label: 'Lägenhetsnummer', value: displayText(apartmentNumber) },
          { label: 'Bostadsrättsinnehavare', value: displayText(apartmentHolderName) },
        ]
      : [
          { label: 'Fastighetsbeteckning', value: displayText(cadastralId) },
          { label: 'Fastighetsägare', value: displayText(propertyOwnerName) },
        ]),
  ]

  const inspectorCertifications = inspector?.certifications
    .map((item) =>
      [item.name, item.number ? `nr ${item.number}` : null, item.validTo ? `giltig t.o.m. ${formatDate(item.validTo)}` : null]
        .filter(Boolean)
        .join(', ')
    )
    .join('\n')

  const inspectionFacts: Fact[] = [
    { label: 'Datum', value: formatDate(preferredDate) },
    { label: 'Tid', value: formatTime(preferredTime) },
    { label: priceLabel, value: formatMoney(priceAmount, currency) },
  ]

  if (isEb) {
    inspectionFacts.push({
      label: 'Moms',
      value: details.vatIncluded === true ? 'Ingår i angivna priser' : 'Tillkommer',
    })
  }

  const ebFacts: Fact[] = isEb
    ? [
        {
          label: 'Beställartyp',
          value: isConsumerEb ? 'Privat konsument' : 'Företag/organisation',
        },
        { label: 'Entreprenadens standardavtal', value: detailText(details, 'underlyingContract') },
        { label: 'Avtalsvillkor', value: detailText(details, 'contractTerms', 'ABK 09') },
        { label: 'Betalningsvillkor', value: detailText(details, 'paymentTerms') },
        {
          label: 'Resa',
          value:
            details.travelIncluded === true
              ? 'Ingår'
              : detailText(details, 'travelTerms', 'Debiteras separat'),
        },
        {
          label: 'Biträdande besiktningsman',
          value: formatMoney(detailNumber(details, 'assistantHourlyRate'), currency),
        },
        ...(hasPositiveNumber(details.budgetAmount)
          ? [
              {
                label: 'Budget/takpris',
                value: formatMoney(detailNumber(details, 'budgetAmount'), currency),
              },
            ]
          : []),
        {
          label: 'Påslag externa kostnader',
          value:
            detailNumber(details, 'expenseMarkupPercent') === null
              ? 'Ej angivet'
              : `${detailNumber(details, 'expenseMarkupPercent')} %`,
        },
        { label: 'Sen avbokning', value: detailText(details, 'cancellationTerms') },
        { label: 'Ansvarsförsäkring', value: detailText(details, 'insuranceTerms') },
      ]
    : []

  const ebLongFacts: Fact[] = isEb
    ? [
        { label: 'Underlag och kontraktshandlingar', value: detailText(details, 'basisDocuments') },
        { label: 'Genomförande och avgränsningar', value: detailText(details, 'executionNotes') },
        { label: 'Tider', value: detailText(details, 'scheduleNotes') },
        { label: 'Särskilda villkor', value: detailText(details, 'specialTerms') },
      ].filter((fact) => fact.value !== 'Ej angivet')
    : []

  const invoicePostalCode = detailText(details, 'invoicePostalCode', '')
  const invoiceCity = detailText(details, 'invoiceCity', '')
  const hasInvoiceFacts = [
    assignment.invoice_name,
    assignment.invoice_address,
    assignment.invoice_email,
    assignment.personal_identity_number,
    details.invoiceReference,
    invoicePostalCode,
    invoiceCity,
  ].some((value) => normalizePdfText(value))

  const addonFacts: Fact[] =
    addonOrders.length > 0
      ? addonOrders.map((addon) => ({
          label: addon.name,
          value: formatMoney(addon.priceAmount, addon.currency),
        }))
      : [{ label: 'Valda tilläggsuppdrag', value: 'Inga tilläggsuppdrag valda' }]

  const consumerWithdrawalAcknowledged =
    snapshotValue(payload, 'consumer_withdrawal_acknowledged', null) === true
  const consumerEarlyStartRequired =
    snapshotValue(payload, 'consumer_early_start_required', null) === true
  const consumerEarlyStartRequested =
    snapshotValue(payload, 'consumer_early_start_requested', null) === true

  const approvalFacts: Fact[] = [
    { label: 'Digitalt godkänd', value: 'Ja' },
    { label: 'Godkänd', value: formatDateTime(acceptedAt) },
    { label: 'Villkorsversion', value: terms.version },
    { label: 'Dokumentfingeravtryck (SHA-256)', value: formatHash(terms.documentHash) },
  ]

  if (isConsumerEb) {
    approvalFacts.push({
      label: 'Information om ångerrätt mottagen',
      value: consumerWithdrawalAcknowledged ? 'Ja' : 'Nej',
    })
    if (consumerEarlyStartRequired) {
      approvalFacts.push({
        label: 'Tidig start under ångerfristen begärd',
        value: consumerEarlyStartRequested ? 'Ja' : 'Nej',
      })
    }
  }

  const termsChunks = splitTermsIntoPageChunks(terms.text)
  const factsPageCount = 3
  const totalPages = factsPageCount + termsChunks.length

  const introPageChildren: React.ReactNode[] = [
    ...pageFurniture(resolvedIssuer, assignment.id, 1, totalPages),
    h(
      View,
      { key: 'hero', style: styles.hero },
      h(Text, { style: styles.heroEyebrow }, 'UPPDRAGSBEKRÄFTELSE'),
      h(Text, { style: styles.heroTitle }, typeLabel),
      h(Text, { style: styles.heroSubtitle }, displayText(ordererRole, resolvedIssuer))
    ),
    h(
      View,
      { key: 'accepted', style: styles.acceptanceBox, wrap: false },
      h(Text, { style: styles.acceptanceTitle }, 'Godkänd uppdragsbekräftelse'),
      h(
        Text,
        { style: styles.acceptanceText },
        `Mottagen av ${resolvedIssuer} den ${formatDateTime(acceptedAt)}.`
      ),
      h(Text, { style: styles.acceptanceMeta }, `Villkorsversion: ${terms.version}`),
      h(
        Text,
        { style: styles.acceptanceMeta },
        `Dokumentfingeravtryck (SHA-256): ${formatHash(terms.documentHash)}`
      ),
      ...(isConsumerEb
        ? [
            h(
              Text,
              { key: 'withdrawal', style: styles.acceptanceMeta },
              `Information om ångerrätt mottagen: ${consumerWithdrawalAcknowledged ? 'Ja' : 'Nej'}`
            ),
            ...(consumerEarlyStartRequired
              ? [
                  h(
                    Text,
                    { key: 'early-start', style: styles.acceptanceMeta },
                    `Tidig start under ångerfristen begärd: ${consumerEarlyStartRequested ? 'Ja' : 'Nej'}`
                  ),
                ]
              : []),
          ]
        : []),
      h(
        Text,
        { style: styles.copyNotice },
        'Detta dokument är en kopia av den elektroniskt godkända uppdragsbekräftelsen.'
      )
    ),
    h(
      View,
      { key: 'object-customer', style: styles.twoColumnRow, wrap: false },
      h(
        View,
        { style: styles.twoColumnLeft },
        h(Section, {
          title: 'Objekt',
          facts: objectFacts,
          longFacts: normalizePdfText(scopeDescription)
            ? [
                {
                  label: isEb ? 'Besiktningens omfattning' : 'Uppdragets omfattning',
                  value: displayText(scopeDescription),
                },
              ]
            : [],
        })
      ),
      h(
        View,
        { style: styles.twoColumnRight },
        h(Section, {
          title: 'Uppdragsgivare',
          facts: [
            { label: 'Namn', value: displayText(customerName) },
            {
              label: 'Adress',
              value:
                joinAddress([customerAddress, customerPostalCode, customerCity]) ||
                'Ej angivet',
            },
            { label: 'Telefon', value: displayText(customerPhone) },
            { label: 'E-post', value: displayText(customerEmail) },
          ],
        })
      )
    ),
  ]

  const inspectorAndSchedulePageChildren: React.ReactNode[] = [
    ...pageFurniture(resolvedIssuer, assignment.id, 2, totalPages),
    h(Section, {
      key: 'inspector',
      title: 'Besiktningsman',
      facts: [
        { label: 'Namn', value: displayText(inspector?.fullName) },
        { label: 'SBR-status', value: displayText(inspector?.sbrStatus) },
        { label: 'SBR-grupp', value: displayText(inspector?.sbrGroup) },
        { label: 'Medlemsnummer', value: displayText(inspector?.membershipNumber) },
        { label: 'Certifieringsnummer', value: displayText(inspector?.certificationNumber) },
        { label: 'Telefon', value: displayText(inspector?.phone) },
        { label: 'E-post', value: displayText(inspector?.email) },
        { label: 'Företag', value: displayText(inspector?.companyName ?? issuerName) },
        { label: 'Org.nr', value: displayText(inspector?.companyOrgNo) },
        {
          label: 'Företagsadress',
          value:
            joinAddress([
              inspector?.companyAddress,
              inspector?.companyPostalCode,
              inspector?.companyCity,
            ]) || 'Ej angivet',
        },
      ],
      longFacts: inspectorCertifications
        ? [{ label: 'Aktiva medlemskap och certifieringar', value: inspectorCertifications }]
        : [],
    }),
    h(Section, { key: 'schedule', title: 'Besiktningsdag och kostnad', facts: inspectionFacts }),
  ]

  const commercialPageChildren: React.ReactNode[] = [
    ...pageFurniture(resolvedIssuer, assignment.id, 3, totalPages),
  ]

  if (isEb) {
    commercialPageChildren.push(
      h(Section, {
        key: 'eb-terms',
        title: 'Uppdragets särskilda villkor',
        facts: ebFacts,
        longFacts: ebLongFacts,
        breakable:
          ebLongFacts.reduce((length, fact) => length + fact.value.length, 0) > 2500,
      })
    )
  }

  if (hasInvoiceFacts) {
    commercialPageChildren.push(
      h(Section, {
        key: 'invoice',
        title: 'Fakturering',
        facts: [
          { label: 'Fakturamottagare', value: displayText(assignment.invoice_name) },
          { label: 'Org.nr/personnummer', value: displayText(assignment.personal_identity_number) },
          { label: 'Faktura-e-post', value: displayText(assignment.invoice_email) },
          {
            label: 'Fakturaadress',
            value: joinInvoiceAddress(
              assignment.invoice_address,
              invoicePostalCode,
              invoiceCity
            ),
          },
          { label: 'Referens/märkning', value: detailText(details, 'invoiceReference') },
        ],
      })
    )
  }

  commercialPageChildren.push(
    h(Section, { key: 'addons', title: 'Tilläggsuppdrag', facts: addonFacts })
  )

  if (!isEb) {
    commercialPageChildren.push(
      h(Section, { key: 'approval', title: 'Godkännande', facts: approvalFacts })
    )
  }

  return h(
    Document,
    {
      title: `Uppdragsbekräftelse - ${typeLabel}`,
      author: resolvedIssuer,
      subject: 'Kopia av elektroniskt godkänd uppdragsbekräftelse',
      creator: 'HusHub',
      language: 'sv-SE',
    },
    h(Page, { key: 'intro', size: 'A4', style: styles.page, wrap: true }, ...introPageChildren),
    h(
      Page,
      { key: 'inspector', size: 'A4', style: styles.page, wrap: true },
      ...inspectorAndSchedulePageChildren
    ),
    h(Page, { key: 'commercial', size: 'A4', style: styles.page, wrap: true }, ...commercialPageChildren),
    ...termsChunks.map((lines, index) =>
      h(
        Page,
        { key: `terms-${index}`, size: 'A4', style: styles.page, wrap: true },
        ...pageFurniture(
          resolvedIssuer,
          assignment.id,
          factsPageCount + index + 1,
          totalPages
        ),
        h(
          View,
          { key: `terms-intro-${index}`, style: styles.termsIntro, wrap: false },
          h(
            Text,
            { style: styles.termsTitle },
            `${termsHeading(terms.role)}${index > 0 ? ' - fortsättning' : ''}`
          ),
          h(Text, { style: styles.termsMeta }, `Villkorsversion: ${normalizePdfText(terms.version)}`),
          h(
            Text,
            { style: styles.termsMeta },
            `Dokumentfingeravtryck (SHA-256): ${formatHash(terms.documentHash)}`
          )
        ),
        h(TermsText, { key: `terms-text-${index}`, lines, keyPrefix: `terms-${index}` })
      )
    )
  )
}

export function buildAcceptedAssignmentConfirmationFilename(input: {
  assignmentType: AssignmentType
  assignmentId: string
  acceptedAt: string | null
}) {
  const acceptedDate = normalizePdfText(input.acceptedAt).slice(0, 10)
  const datePart = /^\d{4}-\d{2}-\d{2}$/.test(acceptedDate) ? acceptedDate : 'godkand'
  const idPart = normalizePdfText(input.assignmentId).replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)
  return `Uppdragsbekraftelse-${input.assignmentType}-${datePart}-${idPart || 'kopia'}.pdf`
}

export async function renderAcceptedAssignmentConfirmationPdf(
  input: AcceptedAssignmentConfirmationPdfInput
) {
  const document = h(
    AcceptedAssignmentConfirmationDocument,
    input
  ) as React.ReactElement<DocumentProps>
  const rendered = await renderToBuffer(document)
  return Buffer.isBuffer(rendered) ? rendered : Buffer.from(rendered)
}
