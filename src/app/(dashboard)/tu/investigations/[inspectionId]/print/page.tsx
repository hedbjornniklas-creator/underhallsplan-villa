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

function formatDate(value: string | null | undefined) {
  if (!value) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString('sv-SE')
}

function compact(parts: Array<string | null | undefined>) {
  const filtered = parts.map((part) => part?.trim()).filter(Boolean)
  return filtered.length > 0 ? filtered.join(', ') : null
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  const normalized = value?.trim()
  if (!normalized) return null
  return (
    <div className="grid grid-cols-[42mm_minmax(0,1fr)] gap-3 border-b border-gray-200 py-2 text-sm">
      <dt className="font-semibold text-gray-700">{label}</dt>
      <dd className="min-w-0 text-gray-950">{normalized}</dd>
    </div>
  )
}

function ReportSection({ title, text }: { title: string; text: string }) {
  const normalized = text.trim()
  if (!normalized) return null
  return (
    <section className="tu-print-block break-inside-avoid-page space-y-2">
      <h2 className="border-b border-violet-200 pb-1 text-base font-semibold text-violet-950">{title}</h2>
      <div className="whitespace-pre-wrap text-sm leading-7 text-gray-950">{normalized}</div>
    </section>
  )
}

function ObjectDetails({ investigation }: { investigation: TuInvestigationDetails }) {
  const propertyAddress = compact([investigation.property?.address ?? investigation.propertyAddress])
  const propertyCity = compact([investigation.property?.postal_code, investigation.property?.city ?? investigation.propertyCity])
  const customerAddress = compact([
    investigation.inspection.customer_address,
    compact([investigation.inspection.customer_postal_code, investigation.inspection.customer_city]),
  ])
  const inspectionDateTime = compact([formatDate(investigation.date), investigation.inspectionTime])

  return (
    <section className="tu-print-block rounded-md border border-gray-200 p-4">
      <h2 className="mb-2 text-base font-semibold text-gray-950">Uppgifter</h2>
      <dl>
        <InfoRow label="Objekt" value={compact([propertyAddress, propertyCity])} />
        <InfoRow label="Fastighetsbeteckning" value={investigation.objectType === 'villa' ? investigation.cadastralId : null} />
        <InfoRow label="BRF" value={investigation.objectType === 'apartment' ? investigation.brfName : null} />
        <InfoRow label="Lägenhet" value={investigation.objectType === 'apartment' ? investigation.apartmentNumber : null} />
        <InfoRow
          label="Bostadsrättshavare"
          value={investigation.objectType === 'apartment' ? investigation.apartmentHolderName : null}
        />
        <InfoRow label="Besiktningsdatum" value={inspectionDateTime} />
        <InfoRow label="Uppdragsgivare" value={investigation.inspection.customer_name} />
        <InfoRow label="Uppdragsgivarens adress" value={customerAddress} />
        <InfoRow label="Telefon" value={investigation.inspection.customer_phone} />
        <InfoRow label="E-post" value={investigation.inspection.customer_email} />
      </dl>
    </section>
  )
}

function ImageAppendix({ images }: { images: TuInvestigationImage[] }) {
  if (images.length === 0) return null

  return (
    <section className="space-y-4">
      <h2 className="border-b border-violet-200 pb-1 text-base font-semibold text-violet-950">Bildbilaga</h2>
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

  const printableSections = investigation.reportDraft.sections.filter((section) => section.text.trim())

  return (
    <main className="tu-print-root min-h-screen bg-neutral-100 text-gray-950 print:bg-white">
      <TuPrintActions
        backHref={`/tu/investigations/${encodeURIComponent(inspectionId)}`}
        autoPrint={autoPrint}
      />
      <article className="tu-print-document mx-auto my-4 w-full max-w-5xl bg-white px-6 py-8 shadow-sm md:px-10 print:my-0 print:shadow-none">
        <header className="mb-8 border-b-2 border-violet-700 pb-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-700">Teknisk utredning</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-gray-950">{investigation.title}</h1>
          <p className="mt-2 text-sm text-gray-600">
            {compact([investigation.propertyAddress, investigation.propertyCity]) ?? 'Objekt saknas'}
          </p>
        </header>

        <div className="space-y-7">
          <ObjectDetails investigation={investigation} />

          {investigation.scopeDescription ? (
            <ReportSection title="Utredningens omfattning" text={investigation.scopeDescription} />
          ) : null}

          {printableSections.map((section) => (
            <ReportSection key={section.key} title={section.title} text={section.text} />
          ))}

          <ImageAppendix images={appendixImages} />
        </div>
      </article>
    </main>
  )
}
