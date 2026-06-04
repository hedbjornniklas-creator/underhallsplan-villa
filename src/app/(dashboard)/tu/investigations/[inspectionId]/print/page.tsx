import { notFound, redirect } from 'next/navigation'
import TuPrintActions from '@/components/tu/TuPrintActions'
import TuPrintPagedDocument, {
  type TuPrintHeader,
  type TuPrintImage,
  type TuPrintMetaRow,
  type TuPrintPartiesSection,
  type TuPrintSection,
  type TuPrintSignature,
} from '@/components/tu/TuPrintPagedDocument'
import {
  getTuInvestigationById,
  listTuInvestigationImages,
  requireTuContext,
  type TuInvestigationDetails,
  type TuInvestigationImage,
} from '@/lib/tu/server'

export const dynamic = 'force-dynamic'

const EMPTY_PRINT_VALUES = new Set(['-', '--', 'ej angivet', 'ej angivet.'])
const PARTY_HEADINGS = new Set(['Uppdragsgivare', 'Besiktningsman'])

function compact(parts: Array<string | null | undefined>) {
  const filtered = parts.map((part) => part?.trim()).filter(Boolean)
  return filtered.length > 0 ? filtered.join(', ') : null
}

function formatReportDate(value: Date) {
  return value.toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' })
}

function formatReportDateLong(value: Date) {
  return value.toLocaleDateString('sv-SE', {
    timeZone: 'Europe/Stockholm',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function formatInspectionDate(value: string | null | undefined) {
  const normalized = normalizePrintableText(value)
  if (!normalized) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized

  const parsed = new Date(normalized)
  if (Number.isNaN(parsed.getTime())) return normalized

  return parsed.toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' })
}

function formatInspectionTime(value: string | null | undefined) {
  const normalized = normalizePrintableText(value)
  if (!normalized) return null

  const match = normalized.match(/^(\d{2}):(\d{2})/)
  return match ? `${match[1]}:${match[2]}` : normalized
}

function normalizePrintableText(value: string | null | undefined) {
  const lines = String(value ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => !EMPTY_PRINT_VALUES.has(line.trim().toLowerCase()))

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function normalizeAssignmentPartiesText(value: string) {
  const cleaned = normalizePrintableText(value)
  if (!cleaned) return ''

  const lines = cleaned.split('\n')
  const segments: string[] = []
  let currentHeading: string | null = null
  let currentRows: string[] = []
  const standaloneRows: string[] = []

  const flush = () => {
    if (!currentHeading) return
    const rows = currentRows.map((line) => line.trim()).filter(Boolean)
    if (rows.length > 0) {
      segments.push([currentHeading, ...rows].join('\n'))
    }
    currentHeading = null
    currentRows = []
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (PARTY_HEADINGS.has(trimmed)) {
      flush()
      currentHeading = trimmed
      continue
    }
    if (currentHeading) {
      currentRows.push(line)
    } else if (trimmed) {
      standaloneRows.push(line)
    }
  }
  flush()

  return [...standaloneRows, ...segments].join('\n\n').trim()
}

function normalizeSectionText(key: string, text: string) {
  return key === 'assignment_parties'
    ? normalizeAssignmentPartiesText(text)
    : normalizePrintableText(text)
}

function toPrintRow(label: string, value: string | null | undefined): TuPrintMetaRow | null {
  const normalized = normalizePrintableText(value)
  return normalized ? { label, value: normalized } : null
}

type AssignmentPartiesFields = {
  customerName?: string | null
  customerRole?: string | null
  customerPhone?: string | null
  customerEmail?: string | null
  customerAttendees?: string | null
  propertyOwnerName?: string | null
  inspectorName?: string | null
  inspectorMembershipNumber?: string | null
  inspectorPhone?: string | null
  inspectorEmail?: string | null
  hasCustomerRows: boolean
  hasInspectorRows: boolean
}

function parseAssignmentPartiesFields(value: string | null | undefined): AssignmentPartiesFields {
  const parsed: AssignmentPartiesFields = {
    hasCustomerRows: false,
    hasInspectorRows: false,
  }
  const text = normalizeAssignmentPartiesText(value ?? '')
  let activeBlock: 'customer' | 'inspector' | null = null

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue

    const normalizedHeading = line.toLowerCase()
    if (normalizedHeading === 'uppdragsgivare') {
      activeBlock = 'customer'
      continue
    }
    if (normalizedHeading === 'besiktningsman') {
      activeBlock = 'inspector'
      continue
    }

    const separatorIndex = line.indexOf(':')
    if (!activeBlock || separatorIndex < 0) continue

    const label = line.slice(0, separatorIndex).trim().toLowerCase()
    const fieldValue = normalizePrintableText(line.slice(separatorIndex + 1))
    if (!fieldValue) continue

    if (activeBlock === 'customer') {
      parsed.hasCustomerRows = true
      if (label === 'namn') parsed.customerName = fieldValue
      if (label === 'roll/beställartyp' || label === 'roll' || label === 'beställartyp') {
        parsed.customerRole = fieldValue
      }
      if (label === 'telefon') parsed.customerPhone = fieldValue
      if (label === 'e-post' || label === 'e.post' || label === 'e-mail' || label === 'email') {
        parsed.customerEmail = fieldValue
      }
      if (label === 'närvarande') parsed.customerAttendees = fieldValue
      if (label === 'fastighetsägare') parsed.propertyOwnerName = fieldValue
    }

    if (activeBlock === 'inspector') {
      parsed.hasInspectorRows = true
      if (label === 'namn') parsed.inspectorName = fieldValue
      if (label === 'medlemsnummer') parsed.inspectorMembershipNumber = fieldValue
      if (label === 'telefon') parsed.inspectorPhone = fieldValue
      if (label === 'e-post' || label === 'e.post' || label === 'e-mail' || label === 'email') {
        parsed.inspectorEmail = fieldValue
      }
    }
  }

  return parsed
}

function buildPartiesSection(investigation: TuInvestigationDetails): TuPrintPartiesSection {
  const assignment = investigation.assignment
  const inspector = investigation.inspector
  const assignmentPartiesText =
    investigation.reportDraft.sections.find((section) => section.key === 'assignment_parties')?.text ?? ''
  const assignmentParties = parseAssignmentPartiesFields(assignmentPartiesText)
  const customerName =
    assignmentParties.customerName ?? assignment?.customer_name ?? investigation.inspection.customer_name
  const customerRole = assignmentParties.customerRole ?? assignment?.orderer_role
  const customerPhone =
    assignmentParties.customerPhone ?? assignment?.customer_phone ?? investigation.inspection.customer_phone
  const customerEmail =
    assignmentParties.customerEmail ?? assignment?.customer_email ?? investigation.inspection.customer_email
  const customerAttendees = assignmentParties.customerAttendees ?? customerName
  const propertyOwnerName = assignmentParties.propertyOwnerName ?? assignment?.property_owner_name
  const address = investigation.property?.address ?? investigation.propertyAddress
  const postalCity = compact([
    investigation.property?.postal_code ?? assignment?.property_postal_code,
    investigation.property?.city ?? investigation.propertyCity ?? assignment?.property_city,
  ])
  const cadastralOrApartment =
    investigation.objectType === 'apartment'
      ? compact([
          investigation.brfName,
          investigation.apartmentNumber ? `Lgh ${investigation.apartmentNumber}` : null,
        ])
      : investigation.cadastralId
  const objectIdentifierLabel =
    investigation.objectType === 'apartment' ? 'BRF/lägenhet' : 'Fastighetsbeteckning'
  const inspectionDate = formatInspectionDate(assignment?.preferred_date ?? investigation.inspection.date)
  const inspectionTime = formatInspectionTime(assignment?.preferred_time ?? investigation.inspection.inspection_time)

  return {
    leftRows: [
      toPrintRow('Besiktningsman', assignmentParties.inspectorName ?? inspector?.full_name),
      toPrintRow('Medlemsnummer SBR', assignmentParties.inspectorMembershipNumber ?? inspector?.membership_number),
      toPrintRow('Telefon', assignmentParties.inspectorPhone ?? inspector?.phone),
      toPrintRow('E-Post', assignmentParties.inspectorEmail ?? inspector?.email),
      toPrintRow('Närvarande', customerAttendees),
      toPrintRow('Besiktningsdag', inspectionDate),
      toPrintRow('Klockslag', inspectionTime),
    ].filter((row): row is TuPrintMetaRow => Boolean(row)),
    rightRows: [
      toPrintRow('Uppdragsgivare', customerName),
      toPrintRow('Roll/beställartyp', customerRole),
      toPrintRow('Telefon', customerPhone),
      toPrintRow('E-post', customerEmail),
      toPrintRow('Fastighetsägare', propertyOwnerName),
      toPrintRow(objectIdentifierLabel, cadastralOrApartment),
      toPrintRow('Kommun', assignment?.property_municipality ?? investigation.property?.municipality),
      toPrintRow('Adress', address),
      toPrintRow('Postnummer, ort', postalCity),
    ].filter((row): row is TuPrintMetaRow => Boolean(row)),
  }
}

function buildFooter(investigation: TuInvestigationDetails) {
  const inspector = investigation.inspector
  const companyAddress = compact([
    inspector?.company_address,
    compact([inspector?.company_postal_code, inspector?.company_city]),
  ])
  const companyLines = [
    inspector?.company_name,
    inspector?.company_orgno ? `Org.nr ${inspector.company_orgno}` : null,
    companyAddress,
  ]
    .map((line) => normalizePrintableText(line))
    .filter(Boolean)
  const contactLines = [inspector?.phone, inspector?.email]
    .map((line) => normalizePrintableText(line))
    .filter(Boolean)

  return {
    companyLines,
    contactLines,
  }
}

function resolveDocumentTitle(investigation: TuInvestigationDetails) {
  return normalizePrintableText(investigation.title) || 'Teknisk utredning'
}

function buildHeader(investigation: TuInvestigationDetails, reportDate: string): TuPrintHeader {
  const address = compact([
    investigation.property?.address ?? investigation.propertyAddress,
    investigation.property?.city ?? investigation.propertyCity,
  ])
  const apartmentIdentifier = compact([
    investigation.brfName,
    investigation.apartmentNumber ? `Lgh ${investigation.apartmentNumber}` : null,
  ])
  const objectIdentifier =
    investigation.objectType === 'apartment'
      ? apartmentIdentifier
      : normalizePrintableText(investigation.cadastralId)

  return {
    documentTitle: resolveDocumentTitle(investigation),
    objectIdentifierLabel:
      investigation.objectType === 'apartment' ? 'Objekt, BRF/lägenhet' : 'Objekt, Fastighetsbeteckning',
    objectIdentifier: (objectIdentifier || address || '-').toLocaleUpperCase('sv-SE'),
    projectType: normalizePrintableText(investigation.projectType) || 'Fördjupad teknisk utredning',
    reportDate,
    address: address ?? '-',
    assignmentNumber: investigation.assignmentNumber ?? investigation.inspection.assignment_number ?? '-',
  }
}

function buildSignature(
  investigation: TuInvestigationDetails,
  reportDateLong: string
): TuPrintSignature | null {
  const inspector = investigation.inspector
  if (!inspector) return null

  const inspectorName = normalizePrintableText(inspector.full_name)
  const credentialLines = (inspector.certification_items ?? [])
    .map((item) => {
      const name = normalizePrintableText(item.name)
      if (!name) return null
      const number = normalizePrintableText(item.number_value)
      return number ? `${name} ${number}` : name
    })
    .filter((line): line is string => Boolean(line))

  const hasSignatureData =
    Boolean(inspectorName) ||
    Boolean(inspector.avatar_url) ||
    Boolean(inspector.signature_url) ||
    credentialLines.length > 0
  if (!hasSignatureData) return null

  const location = normalizePrintableText(inspector.company_city)
  const locationAndDate = location
    ? `${location}, den ${reportDateLong}`
    : `Den ${reportDateLong}`

  return {
    locationAndDate,
    inspectorName: inspectorName || 'Besiktningsman',
    avatarUrl: inspector.avatar_url ?? null,
    signatureUrl: inspector.signature_url ?? null,
    credentialLines,
  }
}

export default async function TuInvestigationPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ inspectionId: string }>
  searchParams?: Promise<{ pdf?: string }>
}) {
  const { inspectionId } = await params
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const isPdfRender = resolvedSearchParams.pdf === '1'

  let investigation: TuInvestigationDetails | null = null
  let coverImages: TuInvestigationImage[] = []
  let appendixImages: TuInvestigationImage[] = []

  try {
    const context = await requireTuContext()
    investigation = await getTuInvestigationById({
      orgId: context.orgId,
      inspectionId,
      inspectorProfileId: context.userId,
    })
    if (!investigation) notFound()
    coverImages = await listTuInvestigationImages({
      orgId: context.orgId,
      inspectionId,
      sectionKey: 'cover',
    })
    appendixImages = await listTuInvestigationImages({
      orgId: context.orgId,
      inspectionId,
      sectionKey: 'appendix',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') redirect('/login')
    if (message === 'TU_INVESTIGATION_NOT_FOUND') notFound()
    throw error
  }

  if (!investigation) notFound()

  const reportDate = new Date()
  const reportDateShort = formatReportDate(reportDate)
  const reportDateLong = formatReportDateLong(reportDate)
  const printableSections: TuPrintSection[] = investigation.reportDraft.sections
    .filter((section) => section.key !== 'assignment_parties' && section.key !== 'signature')
    .map((section) => ({
      id: section.id,
      key: section.key,
      title: section.title,
      text: normalizeSectionText(section.key, section.text),
      subsections: (section.subsections ?? [])
        .map((subsection) => ({
          id: subsection.id,
          title: normalizePrintableText(subsection.title),
          text: normalizePrintableText(subsection.text),
        }))
        .filter((subsection) => Boolean(subsection.title && subsection.text)),
    }))
    .filter((section) => Boolean(section.text || (section.subsections && section.subsections.length > 0)))
  const printableImages: TuPrintImage[] = appendixImages.map((image, index) => ({
    id: image.id,
    src: image.publicUrl,
    caption: image.caption?.trim() || `Bild ${index + 1}`,
  }))
  const coverImageSource = coverImages[0] ?? null
  const coverImage: TuPrintImage | null = coverImageSource
    ? {
        id: coverImageSource.id,
        src: coverImageSource.publicUrl,
        caption: coverImageSource.caption?.trim() || 'Omslagsbild',
      }
    : null
  const companyLogoAlt = investigation.inspector?.company_name ?? 'Besiktningsbolag'

  return (
    <main className="tu-print-root min-h-screen bg-neutral-100 text-gray-950 print:bg-white">
      {isPdfRender ? null : (
        <TuPrintActions
          backHref={`/tu/investigations/${encodeURIComponent(inspectionId)}`}
          inspectionId={inspectionId}
          printTitle=""
        />
      )}
      <TuPrintPagedDocument
        companyLogoUrl={investigation.inspector?.logo_url ?? null}
        companyLogoAlt={companyLogoAlt}
        header={buildHeader(investigation, reportDateShort)}
        coverTitle={normalizePrintableText(investigation.title) || 'Fördjupad teknisk utredning'}
        coverImage={coverImage}
        parties={buildPartiesSection(investigation)}
        metaRows={[]}
        objectRows={[]}
        sections={printableSections}
        signature={buildSignature(investigation, reportDateLong)}
        appendixImages={printableImages}
        footer={buildFooter(investigation)}
      />
    </main>
  )
}
