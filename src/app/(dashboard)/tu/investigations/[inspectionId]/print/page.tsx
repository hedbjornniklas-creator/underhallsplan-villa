import { notFound, redirect } from 'next/navigation'
import TuPrintActions from '@/components/tu/TuPrintActions'
import TuPrintPagedDocument, {
  type TuPrintHeader,
  type TuPrintImage,
  type TuPrintMetaRow,
  type TuPrintPartiesSection,
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

function formatReportDate(value: Date) {
  return value.toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' })
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

function buildPartiesSection(investigation: TuInvestigationDetails): TuPrintPartiesSection {
  const assignment = investigation.assignment
  const inspector = investigation.inspector
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

  return {
    leftRows: [
      toPrintRow('Besiktningsman', inspector?.full_name),
      toPrintRow('Medlemsnummer SBR', inspector?.membership_number),
      toPrintRow('Telefon', inspector?.phone),
      toPrintRow('E-Post', inspector?.email),
      toPrintRow('Närvarande', assignment?.customer_name ?? investigation.inspection.customer_name),
    ].filter((row): row is TuPrintMetaRow => Boolean(row)),
    rightRows: [
      toPrintRow('Fastighetsägare', assignment?.property_owner_name ?? investigation.property?.owner_name),
      toPrintRow('Beställare', assignment?.customer_name ?? investigation.inspection.customer_name),
      toPrintRow('Fastighetsbeteckning', cadastralOrApartment),
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

function resolveDocumentTitle() {
  return 'Teknisk utredning'
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
    projectType: 'Fördjupad teknisk utredning',
    reportDate: formatReportDate(new Date()),
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

  const printableSections: TuPrintSection[] = investigation.reportDraft.sections
    .filter((section) => section.key !== 'assignment_parties')
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
      <TuPrintActions
        backHref={`/tu/investigations/${encodeURIComponent(inspectionId)}`}
        autoPrint={autoPrint}
        printTitle=""
      />
      <TuPrintPagedDocument
        companyLogoUrl={investigation.inspector?.logo_url ?? null}
        companyLogoAlt={companyLogoAlt}
        header={buildHeader(investigation)}
        coverTitle={normalizePrintableText(investigation.title) || 'Fördjupad teknisk utredning'}
        coverImage={coverImage}
        parties={buildPartiesSection(investigation)}
        metaRows={[]}
        objectRows={[]}
        sections={printableSections}
        appendixImages={printableImages}
        footer={buildFooter(investigation)}
      />
    </main>
  )
}
