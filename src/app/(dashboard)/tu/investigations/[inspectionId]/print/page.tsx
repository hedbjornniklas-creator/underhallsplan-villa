import { notFound, redirect } from 'next/navigation'
import TuPrintActions from '@/components/tu/TuPrintActions'
import {
  getTuInvestigationById,
  listTuInvestigationImages,
  requireTuContext,
  type TuInvestigationDetails,
  type TuInvestigationImage,
} from '@/lib/tu/server'

export const dynamic = 'force-dynamic'

const EMPTY_PRINT_VALUES = new Set(['', '-', '--', 'ej angivet', 'ej angivet.'])
const PARTY_HEADINGS = new Set(['Uppdragsgivare', 'Besiktningsman'])

function compact(parts: Array<string | null | undefined>) {
  const filtered = parts.map((part) => part?.trim()).filter(Boolean)
  return filtered.length > 0 ? filtered.join(', ') : null
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

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  const normalized = normalizePrintableText(value)
  if (!normalized) return null
  return (
    <div className="tu-print-info-row grid grid-cols-[42mm_minmax(0,1fr)] gap-3 border-b border-gray-200 py-1.5 text-[13px] leading-5">
      <dt className="font-semibold text-gray-700">{label}</dt>
      <dd className="min-w-0 text-gray-950">{normalized}</dd>
    </div>
  )
}

function ReportSection({ title, text }: { title: string; text: string }) {
  const normalized = normalizePrintableText(text)
  if (!normalized) return null
  return (
    <section className="tu-print-section space-y-2">
      <h2 className="tu-print-section-title border-b border-violet-200 pb-1 text-[15px] font-semibold text-violet-950">{title}</h2>
      <div className="tu-print-section-body whitespace-pre-wrap text-[13px] leading-6 text-gray-950">{normalized}</div>
    </section>
  )
}

function ObjectSummary({ investigation }: { investigation: TuInvestigationDetails }) {
  const propertyAddress = compact([investigation.property?.address ?? investigation.propertyAddress])
  const propertyCity = compact([investigation.property?.postal_code, investigation.property?.city ?? investigation.propertyCity])
  const rows = [
    { label: 'Objekt', value: compact([propertyAddress, propertyCity]) },
    { label: 'Fastighetsbeteckning', value: investigation.objectType === 'villa' ? investigation.cadastralId : null },
    { label: 'BRF', value: investigation.objectType === 'apartment' ? investigation.brfName : null },
    { label: 'Lägenhet', value: investigation.objectType === 'apartment' ? investigation.apartmentNumber : null },
    {
      label: 'Bostadsrättshavare',
      value: investigation.objectType === 'apartment' ? investigation.apartmentHolderName : null,
    },
  ].filter((row) => normalizePrintableText(row.value))

  if (rows.length === 0) return null

  return (
    <section className="tu-print-object-summary">
      <h2 className="tu-print-section-title border-b border-violet-200 pb-1 text-[15px] font-semibold text-violet-950">Objekt</h2>
      <dl className="mt-2">
        {rows.map((row) => (
          <InfoRow key={row.label} label={row.label} value={row.value} />
        ))}
      </dl>
    </section>
  )
}

function CompanyFooter({ investigation }: { investigation: TuInvestigationDetails }) {
  const inspector = investigation.inspector
  const companyAddress = compact([
    inspector?.company_address,
    compact([inspector?.company_postal_code, inspector?.company_city]),
  ])
  const leftLines = [
    inspector?.company_name,
    inspector?.company_orgno ? `Org.nr ${inspector.company_orgno}` : null,
    companyAddress,
  ]
    .map((line) => normalizePrintableText(line))
    .filter(Boolean)
  const rightLines = [inspector?.phone, inspector?.email]
    .map((line) => normalizePrintableText(line))
    .filter(Boolean)

  if (leftLines.length === 0 && rightLines.length === 0) return null

  return (
    <footer className="tu-print-footer border-t border-gray-300 bg-white pt-2 text-[10.5px] leading-4 text-gray-700">
      <div className="min-w-0">
        {leftLines.map((line) => (
          <div key={line}>{line}</div>
        ))}
      </div>
      <div className="tu-print-powered-by flex min-w-0 items-center justify-center gap-1.5 text-center text-[10px] text-gray-500">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/report-assets/BesiktApp.png" alt="BesiktApp" className="h-4 w-auto object-contain" />
        <span>Skapat med BesiktApp</span>
      </div>
      <div className="min-w-0 text-right">
        {rightLines.map((line) => (
          <div key={line}>{line}</div>
        ))}
      </div>
    </footer>
  )
}

function ImageAppendix({ images }: { images: TuInvestigationImage[] }) {
  if (images.length === 0) return null

  return (
    <section className="space-y-4">
      <h2 className="tu-print-section-title border-b border-violet-200 pb-1 text-[15px] font-semibold text-violet-950">Bildbilaga</h2>
      <div className="grid gap-5 sm:grid-cols-2">
        {images.map((image, index) => (
          <figure key={image.id} className="tu-print-block break-inside-avoid-page rounded-md border border-gray-200 p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image.publicUrl}
              alt={image.caption ?? `Bild ${index + 1}`}
              className="h-auto max-h-[95mm] w-full rounded object-contain"
            />
            <figcaption className="mt-2 whitespace-pre-wrap text-xs leading-5 text-gray-700">
              {image.caption?.trim() || `Bild ${index + 1}`}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  )
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

  const objectLine = compact([investigation.propertyAddress, investigation.propertyCity])
  const scopeText = normalizePrintableText(investigation.scopeDescription)
  const printableSections = investigation.reportDraft.sections
    .map((section) => ({
      ...section,
      text: normalizeSectionText(section.key, section.text),
    }))
    .filter((section) => section.text)

  return (
    <main className="tu-print-root min-h-screen bg-neutral-100 text-gray-950 print:bg-white">
      <TuPrintActions
        backHref={`/tu/investigations/${encodeURIComponent(inspectionId)}`}
        autoPrint={autoPrint}
        printTitle={investigation.title || 'Teknisk utredning'}
      />
      <article className="tu-print-document mx-auto my-4 w-full max-w-5xl bg-white px-6 py-8 shadow-sm md:px-10 print:my-0 print:shadow-none">
        <header className="tu-print-header mb-8 border-b-2 border-violet-700 pb-5">
          <div className="min-w-0">
            <div className="tu-print-header-logos mb-7 flex items-center justify-start">
              {investigation.inspector?.logo_url ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={investigation.inspector.logo_url}
                    alt={investigation.inspector.company_name ?? 'Företagslogga'}
                    className="tu-print-company-logo h-12 w-auto object-contain"
                  />
              ) : (
                <div className="text-base font-semibold text-gray-900">
                  {investigation.inspector?.company_name ?? 'Besiktningsbolag'}
                </div>
              )}
            </div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-700">Teknisk utredning</p>
            <h1 className="tu-print-title mt-2 text-3xl font-semibold tracking-tight text-gray-950">{investigation.title}</h1>
            {objectLine ? <p className="mt-2 text-sm text-gray-600">{objectLine}</p> : null}
          </div>
        </header>

        <div className="tu-print-content space-y-6">
          <ObjectSummary investigation={investigation} />

          {scopeText ? (
            <ReportSection title="Utredningens omfattning" text={scopeText} />
          ) : null}

          {printableSections.map((section) => (
            <ReportSection key={section.key} title={section.title} text={section.text} />
          ))}

          <ImageAppendix images={appendixImages} />
        </div>
        <CompanyFooter investigation={investigation} />
      </article>
    </main>
  )
}
