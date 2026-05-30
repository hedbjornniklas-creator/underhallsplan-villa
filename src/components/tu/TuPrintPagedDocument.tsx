'use client'

import type { CSSProperties, ReactNode } from 'react'
import { useCallback, useLayoutEffect, useMemo, useState } from 'react'

const PAGE_WIDTH_MM = 210
const PAGE_HEIGHT_MM = 297
const PAGE_X_PADDING_MM = 18
const PAGE_HEADER_TOP_MM = 9
const PAGE_CONTENT_TOP_MM = 43
const PAGE_CONTENT_BOTTOM_MM = 62
const CONTENT_WIDTH_MM = PAGE_WIDTH_MM - PAGE_X_PADDING_MM * 2
const CONTENT_HEIGHT_MM = PAGE_HEIGHT_MM - PAGE_CONTENT_TOP_MM - PAGE_CONTENT_BOTTOM_MM
const SECTION_CHUNK_TARGET_CHARS = 480
const PAGE_PACKING_SAFETY_MM = 10
const BLOCK_GAP_MM = 5
const SECTION_GAP_MM = 6

const mmToPxNumber = (mm: number) => (mm * 96) / 25.4
const mm = (value: number) => `${value}mm`

export type TuPrintMetaRow = {
  label: string
  value: string
}

export type TuPrintSection = {
  key: string
  title: string
  text: string
}

export type TuPrintPartiesSection = {
  leftRows: TuPrintMetaRow[]
  rightRows: TuPrintMetaRow[]
}

export type TuPrintImage = {
  id: string
  src: string
  caption: string
}

export type TuPrintHeader = {
  documentTitle: string
  objectIdentifier: string
  projectType: string
  reportDate: string
  address: string
  assignmentNumber: string
}

export type TuPrintSignature = {
  locationAndDate: string
  inspectorName: string
  avatarUrl: string | null
  signatureUrl: string | null
  credentialLines: string[]
}

export type TuPrintPagedDocumentProps = {
  companyLogoUrl: string | null
  companyLogoAlt: string
  header: TuPrintHeader
  coverTitle: string
  coverImage: TuPrintImage | null
  parties: TuPrintPartiesSection | null
  metaRows: TuPrintMetaRow[]
  objectRows: TuPrintMetaRow[]
  sections: TuPrintSection[]
  signature: TuPrintSignature | null
  appendixImages: TuPrintImage[]
  footer: {
    companyLines: string[]
    contactLines: string[]
  }
}

type PrintableBlock =
  | {
      id: string
      type: 'parties'
      parties: TuPrintPartiesSection
    }
  | {
      id: string
      type: 'meta'
      rows: TuPrintMetaRow[]
    }
  | {
      id: string
      type: 'object'
      rows: TuPrintMetaRow[]
    }
  | {
      id: string
      type: 'section'
      sectionKey: string
      title: string
      text: string
      continuation: boolean
    }
  | {
      id: string
      type: 'appendix-title'
    }
  | {
      id: string
      type: 'signature'
      signature: TuPrintSignature
    }
  | {
      id: string
      type: 'image-grid'
      images: TuPrintImage[]
    }

type PagePlan = {
  pages: PrintableBlock[][]
}

type TocEntry = {
  id: string
  label: string
  pageNumber: number | null
}

function splitParagraphs(text: string) {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
}

function chunkParagraph(paragraph: string) {
  const normalized = paragraph.trim()
  if (normalized.length <= SECTION_CHUNK_TARGET_CHARS) return [normalized]

  const chunks: string[] = []
  let current = ''
  const tokens = normalized.split(/(\s+)/)

  for (const token of tokens) {
    const next = `${current}${token}`
    if (current.trim() && next.length > SECTION_CHUNK_TARGET_CHARS) {
      chunks.push(current)
      current = token.trimStart()
      continue
    }
    current = next
  }

  if (current.trim()) chunks.push(current)
  return chunks.length > 0 ? chunks : [normalized]
}

function buildPrintableBlocks(props: TuPrintPagedDocumentProps): PrintableBlock[] {
  const blocks: PrintableBlock[] = []
  let signatureInserted = false

  if (props.parties && (props.parties.leftRows.length > 0 || props.parties.rightRows.length > 0)) {
    blocks.push({ id: 'parties', type: 'parties', parties: props.parties })
  }
  if (props.metaRows.length > 0) {
    blocks.push({ id: 'meta', type: 'meta', rows: props.metaRows })
  }
  if (props.objectRows.length > 0) {
    blocks.push({ id: 'object', type: 'object', rows: props.objectRows })
  }

  for (const section of props.sections) {
    const chunks = splitParagraphs(section.text).flatMap(chunkParagraph)
    chunks.forEach((chunk, index) => {
      blocks.push({
        id: `section-${section.key}-${index}`,
        type: 'section',
        sectionKey: section.key,
        title: section.title,
        text: chunk,
        continuation: index > 0,
      })
    })

    if (section.key === 'closing_comments' && props.signature) {
      blocks.push({ id: 'signature', type: 'signature', signature: props.signature })
      signatureInserted = true
    }
  }

  if (props.signature && !signatureInserted) {
    blocks.push({ id: 'signature', type: 'signature', signature: props.signature })
  }

  if (props.appendixImages.length > 0) {
    blocks.push({ id: 'appendix-title', type: 'appendix-title' })
    for (let index = 0; index < props.appendixImages.length; index += 4) {
      const images = props.appendixImages.slice(index, index + 4)
      blocks.push({
        id: `image-grid-${images.map((image) => image.id).join('-')}`,
        type: 'image-grid',
        images,
      })
    }
  }

  return blocks
}

function readBlockHeight(element: HTMLElement) {
  const target =
    element.firstElementChild instanceof HTMLElement ? element.firstElementChild : element
  const rect = target.getBoundingClientRect()
  const style = window.getComputedStyle(target)
  const marginTop = Number.parseFloat(style.marginTop || '0') || 0
  const marginBottom = Number.parseFloat(style.marginBottom || '0') || 0
  return rect.height + marginTop + marginBottom
}

function createPagePlan(blocks: PrintableBlock[], heights: Map<string, number>): PagePlan {
  const maxHeight = mmToPxNumber(CONTENT_HEIGHT_MM - PAGE_PACKING_SAFETY_MM)
  const pages: PrintableBlock[][] = []
  let current: PrintableBlock[] = []
  let currentHeight = 0

  for (const block of blocks) {
    const height = heights.get(block.id) ?? 0
    if (current.length > 0 && currentHeight + height > maxHeight) {
      pages.push(current)
      current = []
      currentHeight = 0
    }

    current.push(block)
    currentHeight += height
  }

  if (current.length > 0) pages.push(current)
  return { pages }
}

function buildTocEntries(props: TuPrintPagedDocumentProps, pages: PrintableBlock[][]): TocEntry[] {
  const pageById = new Map<string, number>()

  pages.forEach((pageBlocks, pageIndex) => {
    const pageNumber = pageIndex + 2
    for (const block of pageBlocks) {
      if (block.type === 'parties' && !pageById.has('parties')) {
        pageById.set('parties', pageNumber)
      }
      if (block.type === 'section' && !pageById.has(`section:${block.sectionKey}`)) {
        pageById.set(`section:${block.sectionKey}`, pageNumber)
      }
      if (block.type === 'appendix-title' && !pageById.has('appendix')) {
        pageById.set('appendix', pageNumber)
      }
    }
  })

  const entries: TocEntry[] = []
  if (props.parties && (props.parties.leftRows.length > 0 || props.parties.rightRows.length > 0)) {
    entries.push({
      id: 'parties',
      label: 'Uppdragsgivare och besiktningsman',
      pageNumber: pageById.get('parties') ?? null,
    })
  }

  for (const section of props.sections) {
    entries.push({
      id: `section:${section.key}`,
      label: section.title,
      pageNumber: pageById.get(`section:${section.key}`) ?? null,
    })
  }

  if (props.appendixImages.length > 0) {
    entries.push({
      id: 'appendix',
      label: 'Bilder från fastigheten',
      pageNumber: pageById.get('appendix') ?? null,
    })
  }

  return entries
}

function RowsBlock({
  title,
  rows,
  columns = 2,
}: {
  title: string
  rows: TuPrintMetaRow[]
  columns?: 1 | 2
}) {
  if (rows.length === 0) return null

  return (
    <section
      className="tu-report-block tu-report-rows-block border-t border-violet-200 pt-3"
      style={{ marginBottom: mm(BLOCK_GAP_MM) }}
    >
      <h2 className="text-[15px] font-semibold leading-tight text-violet-950">
        {title}
      </h2>
      <dl
        className={
          columns === 2
            ? 'mt-2 grid gap-x-8 gap-y-2 sm:grid-cols-2'
            : 'mt-2 grid gap-y-1'
        }
      >
        {rows.map((row) => (
          <div
            key={`${title}-${row.label}`}
            className="grid grid-cols-[34mm_minmax(0,1fr)] gap-3 border-b border-gray-200 pb-1.5"
          >
            <dt className="text-[12px] font-semibold text-gray-600">{row.label}</dt>
            <dd className="min-w-0 whitespace-pre-wrap text-[12px] leading-5 text-gray-950">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function PartyRows({ rows }: { rows: TuPrintMetaRow[] }) {
  return (
    <dl className="grid grid-cols-[38mm_minmax(0,1fr)] gap-x-5 gap-y-1">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="text-[13px] font-semibold leading-5 text-gray-950">{row.label}</dt>
          <dd className="min-w-0 whitespace-pre-wrap text-[13px] leading-5 text-gray-950">
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function PartiesBlock({ parties }: { parties: TuPrintPartiesSection }) {
  return (
    <section className="tu-report-block tu-report-parties-block" style={{ marginBottom: mm(SECTION_GAP_MM) }}>
      <h2 className="mb-6 text-[15px] font-semibold leading-tight text-violet-950">
        Uppdragsgivare och besiktningsman
      </h2>
      <div className="grid grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)] gap-x-5">
        <PartyRows rows={parties.leftRows} />
        <div className="min-h-[33mm] bg-[#2f6ea3]" />
        <PartyRows rows={parties.rightRows} />
      </div>
    </section>
  )
}

function SectionBlock({
  title,
  text,
  continuation,
}: {
  title: string
  text: string
  continuation: boolean
}) {
  return (
    <section
      className={
        continuation
          ? 'tu-report-block tu-report-section-block'
          : 'tu-report-block tu-report-section-block border-t border-violet-200 pt-3'
      }
      style={{ marginBottom: mm(SECTION_GAP_MM) }}
    >
      {!continuation ? (
        <h2 className="text-[15px] font-semibold leading-tight text-violet-950">
          {title}
        </h2>
      ) : null}
      <div className={continuation ? '' : 'mt-2'}>
        <p className="whitespace-pre-wrap text-[13px] leading-6 text-gray-950">{text}</p>
      </div>
    </section>
  )
}

function SignatureBlock({ signature }: { signature: TuPrintSignature }) {
  const hasCredentials = signature.credentialLines.length > 0

  return (
    <section
      className="tu-report-block tu-report-signature-block border-t border-violet-200 pt-5"
      style={{ marginTop: mm(4), marginBottom: mm(SECTION_GAP_MM) }}
    >
      <div className="w-[72mm]">
        {signature.avatarUrl ? (
          <div className="mb-2 h-[26mm] w-[26mm] overflow-hidden bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={signature.avatarUrl}
              alt={signature.inspectorName}
              className="h-full w-full object-cover"
            />
          </div>
        ) : null}

        <div className="text-[13px] font-semibold leading-5 text-gray-950">
          {signature.locationAndDate}
        </div>

        {signature.signatureUrl ? (
          <div className="mt-3 flex h-[16mm] w-[42mm] items-center overflow-hidden bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={signature.signatureUrl}
              alt={`Underskrift ${signature.inspectorName}`}
              className="max-h-full max-w-full object-contain"
            />
          </div>
        ) : null}

        <div className="mt-2 text-[13px] font-semibold leading-5 text-gray-950">
          {signature.inspectorName}
        </div>
        {hasCredentials ? (
          <div className="mt-0.5 space-y-0.5 text-[12px] leading-5 text-gray-950">
            {signature.credentialLines.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  )
}

function ImageGridBlock({
  images,
  onImageReady,
}: {
  images: TuPrintImage[]
  onImageReady?: (id: string) => void
}) {
  return (
    <section
      className="tu-report-block tu-report-image-grid-block grid grid-cols-2 gap-3"
      style={{ marginBottom: mm(BLOCK_GAP_MM) }}
    >
      {images.map((image) => (
        <figure key={image.id} className="rounded border border-gray-200 p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.src}
            alt={image.caption}
            data-tu-print-measure-image="true"
            className="mx-auto h-auto max-h-[52mm] w-full rounded object-contain"
            onLoad={() => onImageReady?.(image.id)}
            onError={() => onImageReady?.(image.id)}
          />
          <figcaption className="mt-1.5 max-h-[11mm] overflow-hidden whitespace-pre-wrap text-[10px] leading-4 text-gray-700">
            {image.caption}
          </figcaption>
        </figure>
      ))}
    </section>
  )
}

function PrintableBlockView({
  block,
  onImageReady,
}: {
  block: PrintableBlock
  onImageReady?: (id: string) => void
}) {
  if (block.type === 'parties') {
    return <PartiesBlock parties={block.parties} />
  }
  if (block.type === 'meta') {
    return <RowsBlock title="Uppgifter" rows={block.rows} />
  }
  if (block.type === 'object') {
    return <RowsBlock title="Objekt" rows={block.rows} columns={1} />
  }
  if (block.type === 'section') {
    return (
      <SectionBlock
        title={block.title}
        text={block.text}
        continuation={block.continuation}
      />
    )
  }
  if (block.type === 'appendix-title') {
    return (
      <section
        className="tu-report-block tu-report-appendix-title border-t border-violet-200 pt-3"
        style={{ marginBottom: mm(BLOCK_GAP_MM) }}
      >
        <h2 className="text-[15px] font-semibold leading-tight text-violet-950">
          Bildbilaga
        </h2>
      </section>
    )
  }
  if (block.type === 'signature') {
    return <SignatureBlock signature={block.signature} />
  }
  return <ImageGridBlock images={block.images} onImageReady={onImageReady} />
}

function getHeaderValueStyle(nowrap: boolean): CSSProperties {
  return {
    fontSize: '10pt',
    lineHeight: nowrap ? 1.05 : 1.12,
    whiteSpace: nowrap ? 'nowrap' : 'normal',
  }
}

function HeaderValue({
  label,
  value,
  nowrap = false,
}: {
  label: string
  value: string
  nowrap?: boolean
}) {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col justify-start overflow-hidden px-1.5 py-1">
      <div className="shrink-0 text-[6pt] leading-none text-black">{label}</div>
      <div
        className="mt-0.5 min-w-0 overflow-hidden break-words font-medium text-black"
        style={getHeaderValueStyle(nowrap)}
      >
        {value || '-'}
      </div>
    </div>
  )
}

function ReportHeader({
  header,
  companyLogoUrl,
  companyLogoAlt,
  pageNumber,
  totalPages,
}: {
  header: TuPrintHeader
  companyLogoUrl: string | null
  companyLogoAlt: string
  pageNumber: number
  totalPages: number
}) {
  const pageValue = `${pageNumber} (${totalPages})`

  return (
    <div
      className="tu-report-header-table grid overflow-hidden border border-black text-black"
      style={{
        height: mm(25.5),
        gridTemplateColumns: '63mm 35mm 34mm 42mm',
        gridTemplateRows: '8.5mm 8.5mm 8.5mm',
      }}
    >
      <div className="min-h-0 min-w-0 overflow-hidden border-b border-r border-black">
        <HeaderValue label="Dokument" value={header.documentTitle} />
      </div>
      <div className="col-span-2 min-h-0 min-w-0 overflow-hidden border-b border-r border-black">
        <HeaderValue label="Rapportdatum" value={header.reportDate} nowrap />
      </div>
      <div className="row-span-3 min-h-0 min-w-0 overflow-hidden border-black">
        <div className="flex h-full items-center justify-center p-2">
          {companyLogoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={companyLogoUrl}
                  alt={companyLogoAlt}
                  className="tu-report-header-logo h-auto max-h-[18mm] max-w-[37mm] object-contain"
                />
          ) : (
            <span className="text-center text-[15px] font-semibold leading-tight text-gray-900">
              {companyLogoAlt}
            </span>
          )}
        </div>
      </div>
      <div className="min-h-0 min-w-0 overflow-hidden border-b border-r border-black">
        <HeaderValue label="Objekt, Fastighetsbeteckning" value={header.objectIdentifier} />
      </div>
      <div className="col-span-2 min-h-0 min-w-0 overflow-hidden border-b border-r border-black">
        <HeaderValue label="Adress" value={header.address} />
      </div>
      <div className="min-h-0 min-w-0 overflow-hidden border-r border-black">
        <HeaderValue label="Projekttyp" value={header.projectType} />
      </div>
      <div className="min-h-0 min-w-0 overflow-hidden border-r border-black">
        <HeaderValue label="Arbetsnummer" value={header.assignmentNumber} nowrap />
      </div>
      <div className="min-h-0 min-w-0 overflow-hidden border-r border-black">
        <HeaderValue label="Sida" value={pageValue} nowrap />
      </div>
    </div>
  )
}

function CoverPage({
  companyLogoUrl,
  companyLogoAlt,
  coverImage,
  coverTitle,
  header,
  pageNumber,
  tocEntries,
  totalPages,
}: {
  companyLogoUrl: string | null
  companyLogoAlt: string
  coverImage: TuPrintImage | null
  coverTitle: string
  header: TuPrintHeader
  pageNumber: number
  tocEntries: TocEntry[]
  totalPages: number
}) {
  const pageStyle = {
    width: mm(PAGE_WIDTH_MM),
    height: mm(PAGE_HEIGHT_MM),
    minHeight: mm(PAGE_HEIGHT_MM),
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: '#ffffff',
  } satisfies CSSProperties

  return (
    <section className="tu-report-page bg-white shadow-sm ring-1 ring-gray-200" style={pageStyle}>
      <header
        className="absolute"
        style={{
          top: mm(PAGE_HEADER_TOP_MM),
          left: mm(PAGE_X_PADDING_MM),
          right: mm(PAGE_X_PADDING_MM),
        }}
      >
        <ReportHeader
          header={header}
          companyLogoUrl={companyLogoUrl}
          companyLogoAlt={companyLogoAlt}
          pageNumber={pageNumber}
          totalPages={totalPages}
        />
      </header>

      <div
        className="absolute flex flex-col items-center text-gray-950"
        style={{
          top: mm(50),
          left: mm(PAGE_X_PADDING_MM),
          right: mm(PAGE_X_PADDING_MM),
          bottom: mm(16),
        }}
      >
        <div className="max-w-[150mm] text-center text-[16px] font-medium leading-7 text-violet-950">
          {coverTitle}
        </div>
        <div className="mt-6 text-center text-[10px] font-bold uppercase tracking-wide text-black">
          {header.objectIdentifier}
        </div>

        <div className="mt-7 flex h-[72mm] w-[112mm] items-center justify-center overflow-hidden bg-white">
          {coverImage ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={coverImage.src}
              alt={coverImage.caption || 'Omslagsbild'}
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center border border-dashed border-violet-200 text-[11px] text-gray-500">
              Ingen omslagsbild vald
            </div>
          )}
        </div>

        <div className="mt-9 w-[150mm] self-center">
          <h2 className="text-[13px] font-medium text-violet-950">Innehåll</h2>
          <ol className="mt-2 space-y-1.5 text-[9px] leading-tight text-black">
            {tocEntries.map((entry, index) => (
              <li key={entry.id} className="grid grid-cols-[7mm_minmax(0,max-content)_minmax(12mm,1fr)_9mm] items-end gap-1">
                <span className="text-right">{index + 1}.</span>
                <span className="min-w-0 font-semibold">{entry.label}</span>
                <span className="mb-1 border-b border-dotted border-black" aria-hidden />
                <span className="text-right font-semibold">{entry.pageNumber ?? ''}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  )
}

function PageChrome({
  children,
  companyLogoUrl,
  companyLogoAlt,
  header,
  footer,
  pageNumber,
  totalPages,
}: {
  children: ReactNode
  companyLogoUrl: string | null
  companyLogoAlt: string
  header: TuPrintHeader
  footer: TuPrintPagedDocumentProps['footer']
  pageNumber: number
  totalPages: number
}) {
  const pageStyle = {
    width: mm(PAGE_WIDTH_MM),
    height: mm(PAGE_HEIGHT_MM),
    minHeight: mm(PAGE_HEIGHT_MM),
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: '#ffffff',
  } satisfies CSSProperties

  return (
    <section className="tu-report-page bg-white shadow-sm ring-1 ring-gray-200" style={pageStyle}>
      <header
        className="absolute"
        style={{
          top: mm(PAGE_HEADER_TOP_MM),
          left: mm(PAGE_X_PADDING_MM),
          right: mm(PAGE_X_PADDING_MM),
        }}
      >
        <ReportHeader
          header={header}
          companyLogoUrl={companyLogoUrl}
          companyLogoAlt={companyLogoAlt}
          pageNumber={pageNumber}
          totalPages={totalPages}
        />
      </header>

      <div
        className="absolute overflow-hidden"
        style={{
          top: mm(PAGE_CONTENT_TOP_MM),
          left: mm(PAGE_X_PADDING_MM),
          right: mm(PAGE_X_PADDING_MM),
          bottom: mm(PAGE_CONTENT_BOTTOM_MM),
        }}
      >
        {children}
      </div>

      <footer
        className="absolute grid grid-cols-[minmax(0,62mm)_minmax(0,52mm)_32mm] items-end justify-between gap-4 border-t border-gray-300 pt-1.5 text-[9px] leading-[1.25] text-gray-700"
        style={{
          left: mm(PAGE_X_PADDING_MM),
          right: mm(PAGE_X_PADDING_MM),
          bottom: mm(7),
          height: mm(18),
        }}
      >
        <div className="min-w-0 self-end">
          {footer.companyLines.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
        <div className="min-w-0 self-end text-center">
          {footer.contactLines.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
        <div className="flex min-w-0 flex-col items-end justify-end gap-1 self-end text-right text-[8px] text-gray-500">
          <span>Skapat med</span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/report-assets/BesiktApp.png"
            alt="BesiktApp"
            className="h-auto max-h-[4mm] max-w-[22mm] object-contain"
          />
        </div>
      </footer>
    </section>
  )
}

export default function TuPrintPagedDocument(props: TuPrintPagedDocumentProps) {
  const {
    appendixImages,
    companyLogoAlt,
    companyLogoUrl,
    coverImage,
    coverTitle,
    footer,
    header,
    metaRows,
    objectRows,
    parties,
    sections,
    signature,
  } = props
  const blocks = useMemo(
    () =>
      buildPrintableBlocks({
        appendixImages,
        companyLogoAlt,
        companyLogoUrl,
        coverImage,
        coverTitle,
        footer,
        header,
        metaRows,
        objectRows,
        parties,
        sections,
        signature,
      }),
    [
      appendixImages,
      companyLogoAlt,
      companyLogoUrl,
      coverImage,
      coverTitle,
      footer,
      header,
      metaRows,
      objectRows,
      parties,
      sections,
      signature,
    ]
  )
  const [pagePlan, setPagePlan] = useState<PagePlan | null>(null)
  const [readyImageIds, setReadyImageIds] = useState<Set<string>>(() => new Set())
  const totalImageCount = appendixImages.length + (coverImage ? 1 : 0)

  const markImageReady = useCallback((id: string) => {
    setReadyImageIds((current) => {
      if (current.has(id)) return current
      const next = new Set(current)
      next.add(id)
      return next
    })
  }, [])

  useLayoutEffect(() => {
    const measuredImages = Array.from(
      document.querySelectorAll<HTMLImageElement>('[data-tu-print-measure-image="true"]')
    )
    const measuredImagesReady =
      measuredImages.length === 0 ||
      measuredImages.every((image) => image.complete && image.naturalWidth > 0)
    if (totalImageCount > 0 && readyImageIds.size < totalImageCount && !measuredImagesReady) return

    let cancelled = false
    const measure = () => {
      if (cancelled) return
      const heights = new Map<string, number>()
      for (const block of blocks) {
        const element = document.querySelector<HTMLElement>(
          `[data-tu-print-block-id="${block.id}"]`
        )
        if (!element) continue
        heights.set(block.id, readBlockHeight(element))
      }
      setPagePlan(createPagePlan(blocks, heights))
    }

    const frame = window.requestAnimationFrame(() => {
      window.setTimeout(measure, 40)
    })

    return () => {
      cancelled = true
      window.cancelAnimationFrame(frame)
    }
  }, [blocks, readyImageIds.size, totalImageCount])

  const pages = pagePlan?.pages ?? []
  const totalPages = Math.max(1, pages.length + 1)
  const tocEntries = pagePlan ? buildTocEntries(props, pages) : []

  return (
    <div
      className="tu-print-paged-document"
      data-tu-print-pagination-ready={pagePlan ? '1' : '0'}
    >
      <div
        className="tu-print-measure pointer-events-none absolute left-[-10000px] top-0 opacity-0"
        aria-hidden="true"
        style={{ width: mm(CONTENT_WIDTH_MM) }}
      >
        {coverImage ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={coverImage.src}
            alt=""
            data-tu-print-measure-image="true"
            onLoad={() => markImageReady(`cover-${coverImage.id}`)}
            onError={() => markImageReady(`cover-${coverImage.id}`)}
          />
        ) : null}
        {blocks.map((block) => (
          <div key={block.id} data-tu-print-block-id={block.id}>
            <PrintableBlockView block={block} onImageReady={markImageReady} />
          </div>
        ))}
      </div>

      {!pagePlan ? (
        <div className="mx-auto my-8 max-w-5xl rounded-md border border-violet-100 bg-white p-6 text-sm text-gray-600 shadow-sm print:hidden">
          Förbereder utskriftslayout...
        </div>
      ) : null}

      <div className="tu-print-pages flex flex-col gap-4">
        <CoverPage
          companyLogoUrl={companyLogoUrl}
          companyLogoAlt={companyLogoAlt}
          coverImage={coverImage}
          coverTitle={coverTitle}
          header={header}
          pageNumber={1}
          tocEntries={tocEntries}
          totalPages={totalPages}
        />
        {pages.map((pageBlocks, pageIndex) => (
          <PageChrome
            key={`tu-print-page-${pageIndex}`}
            companyLogoUrl={props.companyLogoUrl}
            companyLogoAlt={props.companyLogoAlt}
            header={props.header}
            footer={props.footer}
            pageNumber={pageIndex + 2}
            totalPages={totalPages}
          >
            {pageBlocks.map((block) => (
              <PrintableBlockView key={block.id} block={block} />
            ))}
          </PageChrome>
        ))}
      </div>
    </div>
  )
}
