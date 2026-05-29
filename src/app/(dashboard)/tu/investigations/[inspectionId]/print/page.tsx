import { notFound, redirect } from 'next/navigation'
import TuPrintActions from '@/components/tu/TuPrintActions'
import TuPrintPagedDocument, {
  type TuPrintHeader,
  type TuPrintImage,
  type TuPrintMetaRow,
  type TuPrintSection,
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

function formatDate(value: string | null | undefined) {
  if (!value) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString('sv-SE')
}

function formatTime(value: string | null | undefined) {
  if (!value) return null
  const normalized = value.trim()
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

function buildReportMetaRows(investigation: TuInvestigationDetails): TuPrintMetaRow[] {
  const assignment = investigation.assignment
  return [
    toPrintRow('Arbetsnummer', investigation.assignmentNumber ?? investigation.inspection.assignment_number),
    toPrintRow('Besiktningsdag', formatDate(investigation.date ?? investigation.inspection.date)),
    toPrintRow('Tid', formatTime(investigation.inspectionTime ?? investigation.inspection.inspection_time)),
    toPrintRow('Beställare', assignment?.customer_name ?? investigation.inspection.customer_name),
    toPrintRow('Telefon', assignment?.customer_phone ?? investigation.inspection.customer_phone),
    toPrintRow('E-post', assignment?.customer_email ?? investigation.inspection.customer_email),
  ].filter((row): row is TuPrintMetaRow => Boolean(row))
}

function buildObjectRows(investigation: TuInvestigationDetails): TuPrintMetaRow[] {
  const propertyAddress = compact([investigation.property?.address ?? investigation.propertyAddress])
  const propertyCity = compact([
    investigation.property?.postal_code,
    investigation.property?.city ?? investigation.propertyCity,
  ])

  return [
    toPrintRow('Objekt', compact([propertyAddress, propertyCity])),
    toPrintRow('Fastighetsbeteckning', investigation.objectType === 'villa' ? investigation.cadastralId : null),
    toPrintRow('BRF', investigation.objectType === 'apartment' ? investigation.brfName : null),
    toPrintRow('Lägenhet', investigation.objectType === 'apartment' ? investigation.apartmentNumber : null),
    toPrintRow(
      'Bostadsrättshavare',
      investigation.objectType === 'apartment' ? investigation.apartmentHolderName : null
    ),
  ].filter((row): row is TuPrintMetaRow => Boolean(row))
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

function resolveDocumentTitle() {
  return 'Fördjupad teknisk utredning'
}

function buildHeader(investigation: TuInvestigationDetails): TuPrintHeader {
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
    documentTitle: resolveDocumentTitle(),
    objectIdentifier: (objectIdentifier || address || '-').toLocaleUpperCase('sv-SE'),
    projectType: 'Teknisk utredning',
    date: formatDate(investigation.date ?? investigation.inspection.date) ?? '-',
    address: address ?? '-',
    assignmentNumber: investigation.assignmentNumber ?? investigation.inspection.assignment_number ?? '-',
  }
}

export default async function TuInvestigationPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ inspectionId: string }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const { inspectionId } = await params
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const autoPrint = resolvedSearchParams?.autoprint === '1'

  let investigation: TuInvestigationDetails | null = null
  let appendixImages: TuInvestigationImage[] = []

  try {
    const context = await requireTuContext()
    investigation = await getTuInvestigationById({
      orgId: context.orgId,
      inspectionId,
      inspectorProfileId: context.userId,
    })
    if (!investigation) notFound()
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

  const printableSections: TuPrintSection[] = investigation.reportDraft.sections
    .map((section) => ({
      key: section.key,
      title: section.title,
      text: normalizeSectionText(section.key, section.text),
    }))
    .filter((section) => Boolean(section.text))
  const printableImages: TuPrintImage[] = appendixImages.map((image, index) => ({
    id: image.id,
    src: image.publicUrl,
    caption: image.caption?.trim() || `Bild ${index + 1}`,
  }))
  const companyLogoAlt = investigation.inspector?.company_name ?? 'Besiktningsbolag'

  return (
    <main className="tu-print-root min-h-screen bg-neutral-100 text-gray-950 print:bg-white">
      <TuPrintActions
        backHref={`/tu/investigations/${encodeURIComponent(inspectionId)}`}
        autoPrint={autoPrint}
        printTitle=""
      />
      <TuPrintPagedDocument
        companyLogoUrl={investigation.inspector?.logo_url ?? null}
        companyLogoAlt={companyLogoAlt}
        header={buildHeader(investigation)}
        metaRows={buildReportMetaRows(investigation)}
        objectRows={buildObjectRows(investigation)}
        sections={printableSections}
        appendixImages={printableImages}
        footer={buildFooter(investigation)}
      />
    </main>
  )
}
