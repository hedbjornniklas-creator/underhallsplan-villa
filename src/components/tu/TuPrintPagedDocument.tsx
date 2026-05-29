'use client'

import type { CSSProperties, ReactNode } from 'react'
import { useCallback, useLayoutEffect, useMemo, useState } from 'react'

const PAGE_WIDTH_MM = 210
const PAGE_HEIGHT_MM = 297
const PAGE_X_PADDING_MM = 18
const PAGE_HEADER_TOP_MM = 9
const PAGE_CONTENT_TOP_MM = 51
const PAGE_CONTENT_BOTTOM_MM = 62
const CONTENT_WIDTH_MM = PAGE_WIDTH_MM - PAGE_X_PADDING_MM * 2
const CONTENT_HEIGHT_MM = PAGE_HEIGHT_MM - PAGE_CONTENT_TOP_MM - PAGE_CONTENT_BOTTOM_MM
const SECTION_CHUNK_TARGET_CHARS = 480

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

export type TuPrintImage = {
  id: string
  src: string
  caption: string
}

export type TuPrintHeader = {
  documentTitle: string
  objectIdentifier: string
  projectType: string
  date: string
  address: string
  assignmentNumber: string
}

export type TuPrintPagedDocumentProps = {
  companyLogoUrl: string | null
  companyLogoAlt: string
  header: TuPrintHeader
  metaRows: TuPrintMetaRow[]
  objectRows: TuPrintMetaRow[]
  sections: TuPrintSection[]
  appendixImages: TuPrintImage[]
  footer: {
    companyLines: string[]
    contactLines: string[]
  }
}

type PrintableBlock =
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
      type: 'image'
      image: TuPrintImage
    }

type PagePlan = {
  pages: PrintableBlock[][]
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
  }

  if (props.appendixImages.length > 0) {
    blocks.push({ id: 'appendix-title', type: 'appendix-title' })
    props.appendixImages.forEach((image) => {
      blocks.push({ id: `image-${image.id}`, type: 'image', image })
    })
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
  const maxHeight = mmToPxNumber(CONTENT_HEIGHT_MM)
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
    <section className="tu-report-block tu-report-rows-block">
      <h2 className="border-b border-violet-200 pb-1 text-[15px] font-semibold leading-tight text-violet-950">
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
    <section className="tu-report-block tu-report-section-block">
      {!continuation ? (
        <h2 className="border-b border-violet-200 pb-1 text-[15px] font-semibold leading-tight text-violet-950">
          {title}
        </h2>
      ) : null}
      <div className={continuation ? '' : 'mt-2'}>
        <p className="whitespace-pre-wrap text-[13px] leading-6 text-gray-950">{text}</p>
      </div>
    </section>
  )
}

function ImageBlock({
  image,
  onImageReady,
}: {
  image: TuPrintImage
  onImageReady?: (id: string) => void
}) {
  return (
    <figure className="tu-report-block tu-report-image-block rounded-md border border-gray-200 p-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image.src}
        alt={image.caption}
        data-tu-print-measure-image="true"
        className="mx-auto h-auto max-h-[104mm] w-full rounded object-contain"
        onLoad={() => onImageReady?.(image.id)}
        onError={() => onImageReady?.(image.id)}
      />
      <figcaption className="mt-2 whitespace-pre-wrap text-[11px] leading-5 text-gray-700">
        {image.caption}
      </figcaption>
    </figure>
  )
}

function PrintableBlockView({
  block,
  onImageReady,
}: {
  block: PrintableBlock
  onImageReady?: (id: string) => void
}) {
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
      <section className="tu-report-block tu-report-appendix-title">
        <h2 className="border-b border-violet-200 pb-1 text-[15px] font-semibold leading-tight text-violet-950">
          Bildbilaga
        </h2>
      </section>
    )
  }
  return <ImageBlock image={block.image} onImageReady={onImageReady} />
}

function getHeaderValueStyle(value: string, nowrap: boolean): CSSProperties {
  const length = value.length
  const fontSize = nowrap
    ? length > 12
      ? 17
      : 20
    : length > 52
      ? 13
      : length > 38
        ? 15
        : length > 24
          ? 17
          : 20

  return {
    fontSize,
    lineHeight: nowrap ? 1.05 : 1.08,
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
    <div className="flex h-full min-h-0 min-w-0 flex-col justify-start overflow-hidden px-2 py-1">
      <div className="shrink-0 text-[11px] leading-none text-black">{label}</div>
      <div
        className="mt-1 min-w-0 overflow-hidden break-words font-medium text-black"
        style={getHeaderValueStyle(value, nowrap)}
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
        height: mm(33),
        gridTemplateColumns: '63mm 35mm 34mm 42mm',
        gridTemplateRows: '11mm 11mm 11mm',
      }}
    >
      <div className="min-h-0 min-w-0 overflow-hidden border-b border-r border-black">
        <HeaderValue label="Dokument" value={header.documentTitle} />
      </div>
      <div className="col-span-2 min-h-0 min-w-0 overflow-hidden border-b border-r border-black">
        <HeaderValue label="Datum" value={header.date} nowrap />
      </div>
      <div className="row-span-3 min-h-0 min-w-0 overflow-hidden border-black">
        <div className="flex h-full items-center justify-center p-2">
          {companyLogoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={companyLogoUrl}
              alt={companyLogoAlt}
              className="tu-report-header-logo h-auto max-h-[24mm] max-w-[38mm] object-contain"
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
        className="absolute grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_32mm] items-end gap-6 border-t border-gray-300 pt-2 text-[10px] leading-4 text-gray-700"
        style={{
          left: mm(PAGE_X_PADDING_MM),
          right: mm(PAGE_X_PADDING_MM),
          bottom: mm(8),
          minHeight: mm(17),
        }}
      >
        <div className="min-w-0">
          {footer.companyLines.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
        <div className="min-w-0 text-center">
          {footer.contactLines.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
        <div className="flex min-w-0 flex-col items-end justify-end gap-1 text-right text-[9px] text-gray-500">
          <span>Skapat med</span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/report-assets/BesiktApp.png"
            alt="BesiktApp"
            className="h-auto max-h-[4.5mm] max-w-[24mm] object-contain"
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
    footer,
    header,
    metaRows,
    objectRows,
    sections,
  } = props
  const blocks = useMemo(
    () =>
      buildPrintableBlocks({
        appendixImages,
        companyLogoAlt,
        companyLogoUrl,
        footer,
        header,
        metaRows,
        objectRows,
        sections,
      }),
    [
      appendixImages,
      companyLogoAlt,
      companyLogoUrl,
      footer,
      header,
      metaRows,
      objectRows,
      sections,
    ]
  )
  const [pagePlan, setPagePlan] = useState<PagePlan | null>(null)
  const [readyImageIds, setReadyImageIds] = useState<Set<string>>(() => new Set())
  const totalImageCount = appendixImages.length

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
  const totalPages = Math.max(1, pages.length)

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
        {pages.map((pageBlocks, pageIndex) => (
          <PageChrome
            key={`tu-print-page-${pageIndex}`}
            companyLogoUrl={props.companyLogoUrl}
            companyLogoAlt={props.companyLogoAlt}
            header={props.header}
            footer={props.footer}
            pageNumber={pageIndex + 1}
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
