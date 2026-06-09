/* eslint-disable @next/next/no-img-element */
import TuPublicReportToolbar, {
  type TuPublicDeliveryDocumentLink,
} from '@/components/tu/TuPublicReportToolbar'
import type {
  TuPrintImage,
  TuPrintMetaRow,
  TuPrintPartiesSection,
  TuPrintSection,
  TuPrintSignature,
} from '@/components/tu/TuPrintPagedDocument'
import type { TuReportSnapshotPayloadV1 } from '@/lib/tu/reportSnapshot'

function formatPublishedAt(value: string | null | undefined) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function normalizeText(value: string | null | undefined) {
  return String(value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
}

function splitParagraphs(value: string | null | undefined) {
  const text = normalizeText(value)
  if (!text) return []
  return text
    .split(/\n[ \t]*\n+/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function rowValue(row: TuPrintMetaRow) {
  return normalizeText(row.value)
}

function DetailRows({ rows }: { rows: TuPrintMetaRow[] }) {
  const visibleRows = rows.filter((row) => rowValue(row))
  if (visibleRows.length === 0) return null

  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {visibleRows.map((row) => (
        <div key={`${row.label}-${row.value}`} className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">{row.label}</dt>
          <dd className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-950">{rowValue(row)}</dd>
        </div>
      ))}
    </dl>
  )
}

function PartiesSection({ parties }: { parties: TuPrintPartiesSection }) {
  const hasInspector = parties.leftRows.some((row) => rowValue(row))
  const hasCustomer = parties.rightRows.some((row) => rowValue(row))
  if (!hasInspector && !hasCustomer) return null

  return (
    <section id="section-1" className="scroll-mt-6 border-t border-slate-200 pt-8">
      <h2 className="text-xl font-semibold text-slate-950">1. Uppdragsgivare och besiktningsman</h2>
      <div className="mt-5 grid gap-6 lg:grid-cols-2">
        {hasInspector ? (
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-600">Besiktningsman</h3>
            <div className="mt-3">
              <DetailRows rows={parties.leftRows} />
            </div>
          </div>
        ) : null}
        {hasCustomer ? (
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-600">Uppdragsgivare</h3>
            <div className="mt-3">
              <DetailRows rows={parties.rightRows} />
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}

function SectionText({ text }: { text: string }) {
  const paragraphs = splitParagraphs(text)
  if (paragraphs.length === 0) return null

  return (
    <div className="space-y-4 text-base leading-8 text-slate-900">
      {paragraphs.map((paragraph, index) => (
        <p key={`${paragraph.slice(0, 32)}-${index}`} className="whitespace-pre-wrap break-words">
          {paragraph}
        </p>
      ))}
    </div>
  )
}

function ReportSection({ section, number }: { section: TuPrintSection; number: number }) {
  const text = normalizeText(section.text)
  const subsections = (section.subsections ?? []).filter(
    (subsection) => normalizeText(subsection.title) || normalizeText(subsection.text)
  )

  if (!text && subsections.length === 0) return null

  return (
    <section id={`section-${number}`} className="scroll-mt-6 border-t border-slate-200 pt-8">
      <h2 className="text-xl font-semibold text-slate-950">
        {number}. {section.title}
      </h2>
      {text ? (
        <div className="mt-4">
          <SectionText text={text} />
        </div>
      ) : null}
      {subsections.length > 0 ? (
        <div className="mt-6 space-y-6">
          {subsections.map((subsection, index) => {
            const title = normalizeText(subsection.title)
            const subsectionText = normalizeText(subsection.text)
            return (
              <div key={subsection.id || `${section.id}-${index}`}>
                {title ? (
                  <h3 className="text-base font-semibold text-slate-950">
                    {number}.{index + 1} {title}
                  </h3>
                ) : null}
                {subsectionText ? (
                  <div className={title ? 'mt-2' : undefined}>
                    <SectionText text={subsectionText} />
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}
    </section>
  )
}

function ClickableImage({
  image,
  className,
}: {
  image: TuPrintImage
  className: string
}) {
  return (
    <a
      href={image.src}
      target="_blank"
      rel="noreferrer"
      className="group block overflow-hidden rounded-lg border border-slate-200 bg-slate-100 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2"
      title="Öppna bild"
    >
      <img src={image.src} alt={image.caption || 'Bild'} className={className} />
      {image.caption ? (
        <span className="block border-t border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 group-hover:text-violet-800">
          {image.caption}
        </span>
      ) : null}
    </a>
  )
}

function ImageAppendix({ images, startNumber }: { images: TuPrintImage[]; startNumber: number }) {
  if (images.length === 0) return null

  return (
    <section id={`section-${startNumber}`} className="scroll-mt-6 border-t border-slate-200 pt-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-950">{startNumber}. Bildbilaga</h2>
          <p className="mt-1 text-sm text-slate-500">Klicka på en bild för att öppna den i större format.</p>
        </div>
        <span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-sm font-medium text-violet-800">
          {images.length} bilder
        </span>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {images.map((image) => (
          <ClickableImage
            key={image.id}
            image={image}
            className="aspect-[4/3] w-full object-cover transition group-hover:scale-[1.01]"
          />
        ))}
      </div>
    </section>
  )
}

function SignatureBlock({ signature }: { signature: TuPrintSignature | null }) {
  if (!signature) return null

  return (
    <section className="border-t border-slate-200 pt-8">
      <p className="text-sm text-slate-600">{signature.locationAndDate}</p>
      <div className="mt-4 flex flex-wrap items-end gap-4">
        {signature.signatureUrl ? (
          <img src={signature.signatureUrl} alt="Signatur" className="max-h-20 w-auto object-contain" />
        ) : null}
        {signature.avatarUrl ? (
          <img src={signature.avatarUrl} alt={signature.inspectorName} className="h-16 w-16 rounded-full object-cover" />
        ) : null}
        <div>
          <div className="font-semibold text-slate-950">{signature.inspectorName}</div>
          {signature.credentialLines.length > 0 ? (
            <div className="mt-1 space-y-0.5 text-sm text-slate-600">
              {signature.credentialLines.map((line) => (
                <div key={line}>{line}</div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}

export default function TuPublicReportSnapshotView({
  snapshot,
  shareEndpoint,
  shareUrl,
  pdfDownloadUrl,
  deliveryDocuments = [],
}: {
  snapshot: TuReportSnapshotPayloadV1
  shareEndpoint: string | null
  shareUrl: string | null
  pdfDownloadUrl: string | null
  deliveryDocuments?: TuPublicDeliveryDocumentLink[]
}) {
  const report = snapshot.report
  const publishedAt = formatPublishedAt(snapshot.createdAt)
  const sections = report.sections.filter(
    (section) =>
      normalizeText(section.text) ||
      (section.subsections ?? []).some((subsection) => normalizeText(subsection.title) || normalizeText(subsection.text))
  )
  const hasParties = Boolean(
    report.parties &&
      (report.parties.leftRows.some((row) => rowValue(row)) || report.parties.rightRows.some((row) => rowValue(row)))
  )
  const firstSectionNumber = hasParties ? 2 : 1
  const appendixNumber = firstSectionNumber + sections.length
  const contentLinks = [
    ...(hasParties ? [{ href: '#section-1', label: '1. Uppdragsgivare och besiktningsman' }] : []),
    ...sections.map((section, index) => ({
      href: `#section-${firstSectionNumber + index}`,
      label: `${firstSectionNumber + index}. ${section.title}`,
    })),
    ...(report.appendixImages.length > 0
      ? [{ href: `#section-${appendixNumber}`, label: `${appendixNumber}. Bildbilaga` }]
      : []),
  ]

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <TuPublicReportToolbar
        shareEndpoint={shareEndpoint}
        shareUrl={shareUrl}
        pdfDownloadUrl={pdfDownloadUrl}
        deliveryDocuments={deliveryDocuments}
      />

      <div className="mx-auto w-full max-w-6xl px-4 pb-10">
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="grid gap-0 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="p-5 md:p-7">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-700">
                Digitalt utlåtande
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 md:text-4xl">
                {report.header.documentTitle}
              </h1>
              <p className="mt-3 text-lg leading-8 text-slate-700">{report.coverTitle}</p>
              <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">
                    {report.header.objectIdentifierLabel}
                  </dt>
                  <dd className="mt-1 font-semibold text-slate-950">{report.header.objectIdentifier}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">Adress</dt>
                  <dd className="mt-1 font-semibold text-slate-950">{report.header.address}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">Rapportdatum</dt>
                  <dd className="mt-1 font-semibold text-slate-950">{report.header.reportDate}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">Arbetsnummer</dt>
                  <dd className="mt-1 font-semibold text-slate-950">{report.header.assignmentNumber}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">Projekttyp</dt>
                  <dd className="mt-1 font-semibold text-slate-950">{report.header.projectType}</dd>
                </div>
              </dl>
              {publishedAt ? (
                <p className="mt-6 text-xs text-slate-500">Publicerad version: {publishedAt}</p>
              ) : null}
            </div>

            <div className="border-t border-slate-200 bg-slate-50 p-5 lg:border-l lg:border-t-0 md:p-7">
              {report.companyLogoUrl ? (
                <img
                  src={report.companyLogoUrl}
                  alt={report.companyLogoAlt}
                  className="mb-4 h-12 w-auto rounded-md bg-white object-contain"
                />
              ) : null}
              {report.coverImage ? (
                <ClickableImage
                  image={report.coverImage}
                  className="aspect-[4/3] w-full object-cover transition group-hover:scale-[1.01]"
                />
              ) : (
                <div className="flex aspect-[4/3] items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white text-sm text-slate-500">
                  Ingen omslagsbild
                </div>
              )}
            </div>
          </div>
        </section>

        {contentLinks.length > 0 ? (
          <nav className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="Innehåll">
            <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-600">Innehåll</h2>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {contentLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800 transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-900"
                >
                  {link.label}
                </a>
              ))}
            </div>
          </nav>
        ) : null}

        <article className="mt-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:p-7">
          <div className="space-y-8">
            {report.parties ? <PartiesSection parties={report.parties} /> : null}
            {sections.map((section, index) => (
              <ReportSection key={section.id} section={section} number={firstSectionNumber + index} />
            ))}
            <SignatureBlock signature={report.signature} />
            <ImageAppendix images={report.appendixImages} startNumber={appendixNumber} />
          </div>
        </article>
      </div>
    </main>
  )
}
