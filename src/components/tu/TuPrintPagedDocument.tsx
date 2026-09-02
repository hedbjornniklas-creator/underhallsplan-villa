'use client'

import type { CSSProperties, ReactNode } from 'react'
import { useCallback, useLayoutEffect, useMemo, useState } from 'react'

const PAGE_WIDTH_MM = 210
const PAGE_HEIGHT_MM = 297
const PAGE_X_PADDING_MM = 18
const PAGE_HEADER_TOP_MM = 9
const PAGE_CONTENT_TOP_MM = 43
const PAGE_CONTENT_BOTTOM_MM = 32
const CONTENT_WIDTH_MM = PAGE_WIDTH_MM - PAGE_X_PADDING_MM * 2
const CONTENT_HEIGHT_MM = PAGE_HEIGHT_MM - PAGE_CONTENT_TOP_MM - PAGE_CONTENT_BOTTOM_MM
const SECTION_CHUNK_TARGET_CHARS = 320
const PAGE_PACKING_SAFETY_MM = 4
const BLOCK_GAP_MM = 5
const SECTION_GAP_MM = 6
const PRINT_IMAGE_POLICY = {
  coverMaxLongSidePx: 1200,
  appendixMaxLongSidePx: 900,
  quality: 68,
}

const mmToPxNumber = (mm: number) => (mm * 96) / 25.4
const mm = (value: number) => `${value}mm`
const PRINT_TEXT_STYLE = {
  overflowWrap: 'normal',
  wordBreak: 'normal',
  hyphens: 'none',
} satisfies CSSProperties
const PRINT_META_VALUE_STYLE = {
  ...PRINT_TEXT_STYLE,
  overflowWrap: 'anywhere',
} satisfies CSSProperties

function toPrintImageProxyUrl(src: string, maxLongSidePx: number) {
  if (!src) return src
  if (src.startsWith('data:')) return src
  if (src.startsWith('/')) return src

  const params = new URLSearchParams({
    url: src,
    max: String(maxLongSidePx),
    q: String(PRINT_IMAGE_POLICY.quality),
  })
  return `/api/image-proxy?${params.toString()}`
}

function getCoverPrintImageSrc(src: string) {
  return toPrintImageProxyUrl(src, PRINT_IMAGE_POLICY.coverMaxLongSidePx)
}

function getAppendixPrintImageSrc(src: string) {
  return toPrintImageProxyUrl(src, PRINT_IMAGE_POLICY.appendixMaxLongSidePx)
}

export type TuPrintMetaRow = {
  label: string
  value: string
}

export type TuPrintSection = {
  id: string
  key: string
  title: string
  text: string
  subsections?: TuPrintSubsection[]
}

export type TuPrintSubsection = {
  id: string
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
  objectIdentifierLabel: string
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
      numberLabel: string
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
      sectionId: string
      sectionKey: string
      numberLabel: string
      title: string
      text: string
      continuation: boolean
    }
  | {
      id: string
      type: 'subsection'
      numberLabel: string
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
  numberLabel: string | null
  label: string
  pageNumber: number | null
}

function normalizeTextNewlines(text: string) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function splitParagraphs(text: string) {
  return normalizeTextNewlines(text)
    .split(/\n[ \t]*\n+/)
    .map((paragraph) => paragraph.replace(/^[ \t\n]+|[ \t\n]+$/g, ''))
    .filter((paragraph) => paragraph.trim())
}

function isListIntroParagraph(paragraph: string) {
  return /:\s*$/.test(paragraph.trim())
}

function isListItemLine(line: string) {
  return /^(?:[-–—•*]\s+|\d+[.)]\s+)/.test(line.trim())
}

function startsWithListItem(paragraph: string) {
  const firstLine = paragraph
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)

  return Boolean(firstLine && isListItemLine(firstLine))
}

function chunkLongTextAtWords(text: string) {
  const normalized = text.trim()
  if (normalized.length <= SECTION_CHUNK_TARGET_CHARS) return [normalized]

  const chunks: string[] = []
  let current = ''
  const tokens = normalized.split(/(\s+)/)

  for (const token of tokens) {
    const next = `${current}${token}`
    if (current.trim() && next.length > SECTION_CHUNK_TARGET_CHARS) {
      chunks.push(current.trimEnd())
      current = token.trimStart()
      continue
    }
    current = next
  }

  if (current.trim()) chunks.push(current.trimEnd())
  return chunks.length > 0 ? chunks : [normalized]
}

function chunkParagraph(paragraph: string) {
  const normalized = paragraph.trim()
  if (normalized.length <= SECTION_CHUNK_TARGET_CHARS) return [normalized]

  const sentenceMatches =
    normalized.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) ?? [normalized]
  const chunks: string[] = []
  let current = ''

  for (const rawSentence of sentenceMatches) {
    const sentence = rawSentence.trim()
    if (!sentence) continue

    if (sentence.length > SECTION_CHUNK_TARGET_CHARS) {
      if (current.trim()) {
        chunks.push(current.trimEnd())
        current = ''
      }
      chunks.push(...chunkLongTextAtWords(sentence))
      continue
    }

    const next = current ? `${current} ${sentence}` : sentence
    if (current.trim() && next.length > SECTION_CHUNK_TARGET_CHARS) {
      chunks.push(current.trimEnd())
      current = sentence
      continue
    }
    current = next
  }

  if (current.trim()) chunks.push(current.trimEnd())
  return chunks.length > 0 ? chunks : chunkLongTextAtWords(normalized)
}

function splitListParagraph(paragraph: string) {
  const lines = paragraph.split('\n')
  const firstListIndex = lines.findIndex((line) => isListItemLine(line))
  if (firstListIndex < 0) return null

  const intro = lines.slice(0, firstListIndex).join('\n').trim()
  const items: string[] = []
  let currentItem = ''

  for (const line of lines.slice(firstListIndex)) {
    if (isListItemLine(line)) {
      if (currentItem.trim()) items.push(currentItem.trimEnd())
      currentItem = line.trimEnd()
      continue
    }
    currentItem = currentItem ? `${currentItem}\n${line.trimEnd()}` : line.trimEnd()
  }

  if (currentItem.trim()) items.push(currentItem.trimEnd())
  return { intro, items }
}

function chunkListParagraph(paragraph: string) {
  const list = splitListParagraph(paragraph)
  if (!list) return chunkParagraph(paragraph)

  const chunks: string[] = []
  let current = list.intro
  let hasListItemInCurrent = false

  for (const item of list.items) {
    const next = current ? `${current}\n${item}` : item
    if (
      current.trim() &&
      hasListItemInCurrent &&
      next.length > SECTION_CHUNK_TARGET_CHARS
    ) {
      chunks.push(current.trimEnd())
      current = item
    } else {
      current = next
    }
    hasListItemInCurrent = true
  }

  if (current.trim()) chunks.push(current.trimEnd())
  return chunks.length > 0 ? chunks : chunkParagraph(paragraph)
}

function appendChunkUnit(chunks: string[], current: string, unit: string) {
  if (!unit.trim()) return current

  const next = current ? `${current}\n\n${unit}` : unit
  if (current.trim() && next.length > SECTION_CHUNK_TARGET_CHARS) {
    chunks.push(current.trimEnd())
    return unit
  }

  return next
}

function chunkSectionText(text: string) {
  const paragraphs = splitParagraphs(text)
  const chunks: string[] = []
  let currentChunk = ''

  for (let index = 0; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs[index]
    const nextParagraph = paragraphs[index + 1]

    if (
      nextParagraph &&
      isListIntroParagraph(paragraph) &&
      startsWithListItem(nextParagraph)
    ) {
      const combined = `${paragraph}\n\n${nextParagraph}`
      if (combined.length <= SECTION_CHUNK_TARGET_CHARS * 2) {
        for (const unit of chunkListParagraph(combined)) {
          currentChunk = appendChunkUnit(chunks, currentChunk, unit)
        }
        index += 1
        continue
      }
    }

    const paragraphChunks = splitListParagraph(paragraph)
      ? chunkListParagraph(paragraph)
      : chunkParagraph(paragraph)
    for (const unit of paragraphChunks) {
      currentChunk = appendChunkUnit(chunks, currentChunk, unit)
    }
  }

  if (currentChunk.trim()) chunks.push(currentChunk.trimEnd())
  return chunks
}

function buildPrintableBlocks(props: TuPrintPagedDocumentProps): PrintableBlock[] {
  const blocks: PrintableBlock[] = []
  let signatureInserted = false
  let sectionNumber = 0

  if (props.parties && (props.parties.leftRows.length > 0 || props.parties.rightRows.length > 0)) {
    sectionNumber += 1
    blocks.push({
      id: 'parties',
      type: 'parties',
      parties: props.parties,
      numberLabel: String(sectionNumber),
    })
  }
  if (props.metaRows.length > 0) {
    blocks.push({ id: 'meta', type: 'meta', rows: props.metaRows })
  }
  if (props.objectRows.length > 0) {
    blocks.push({ id: 'object', type: 'object', rows: props.objectRows })
  }

  for (const section of props.sections) {
    const chunks = chunkSectionText(section.text)
    const printableSubsections =
      section.subsections?.filter((subsection) => subsection.title.trim() && subsection.text.trim()) ?? []
    const shouldPrintSectionHeader = chunks.length > 0 || printableSubsections.length > 0
    const sectionChunks = chunks.length > 0 ? chunks : shouldPrintSectionHeader ? [''] : []
    if (shouldPrintSectionHeader) sectionNumber += 1
    const numberLabel = String(sectionNumber)

    sectionChunks.forEach((chunk, index) => {
      blocks.push({
        id: `section-${section.id}-${index}`,
        type: 'section',
        sectionId: section.id,
        sectionKey: section.key,
        numberLabel,
        title: section.title,
        text: chunk,
        continuation: index > 0,
      })
    })

    printableSubsections.forEach((subsection, subsectionIndex) => {
      const subsectionNumberLabel = `${numberLabel}.${subsectionIndex + 1}`
      const subsectionChunks = chunkSectionText(subsection.text)
      subsectionChunks.forEach((chunk, index) => {
        blocks.push({
          id: `subsection-${section.id}-${subsection.id}-${index}`,
          type: 'subsection',
          numberLabel: subsectionNumberLabel,
          title: subsection.title,
          text: chunk,
          continuation: index > 0,
        })
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
    if (block.type === 'appendix-title' && current.length > 0) {
      pages.push(current)
      current = []
      currentHeight = 0
    }

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
      if (block.type === 'section' && !pageById.has(`section:${block.sectionId}`)) {
        pageById.set(`section:${block.sectionId}`, pageNumber)
      }
      if (block.type === 'appendix-title' && !pageById.has('appendix')) {
        pageById.set('appendix', pageNumber)
      }
    }
  })

  const entries: TocEntry[] = []
  let sectionNumber = 0
  if (props.parties && (props.parties.leftRows.length > 0 || props.parties.rightRows.length > 0)) {
    sectionNumber += 1
    entries.push({
      id: 'parties',
      numberLabel: String(sectionNumber),
      label: 'Uppdragsgivare och besiktningsman',
      pageNumber: pageById.get('parties') ?? null,
    })
  }

  for (const section of props.sections) {
    sectionNumber += 1
    entries.push({
      id: `section:${section.id}`,
      numberLabel: String(sectionNumber),
      label: section.title,
      pageNumber: pageById.get(`section:${section.id}`) ?? null,
    })
  }

  if (props.appendixImages.length > 0) {
    entries.push({
      id: 'appendix',
      numberLabel: null,
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
      className="tu-report-block tu-report-rows-block border-t border-violet-200 pt-5"
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
            <dd
              className="min-w-0 whitespace-pre-wrap text-[12px] leading-5 text-gray-950"
              style={PRINT_TEXT_STYLE}
            >
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
    <dl className="grid grid-cols-[32mm_minmax(0,1fr)] gap-x-3 gap-y-[2px]">
      {rows.map((row) => {
        const compactValue = row.value.includes('@') || row.value.length > 34
        return (
          <div key={row.label} className="contents">
            <dt className="text-[12px] font-semibold leading-4 text-gray-950">{row.label}</dt>
            <dd
              className={
                compactValue
                  ? 'min-w-0 whitespace-pre-wrap text-[10.5px] leading-[15px] text-gray-950'
                  : 'min-w-0 whitespace-pre-wrap text-[12px] leading-4 text-gray-950'
              }
              style={PRINT_META_VALUE_STYLE}
            >
              {row.value}
            </dd>
          </div>
        )
      })}
    </dl>
  )
}

function PartiesBlock({
  numberLabel,
  parties,
}: {
  numberLabel: string
  parties: TuPrintPartiesSection
}) {
  return (
    <section className="tu-report-block tu-report-parties-block" style={{ marginBottom: mm(SECTION_GAP_MM) }}>
      <h2 className="mb-3 text-[15px] font-semibold leading-tight text-violet-950">
        {numberLabel}. Uppdragsgivare och besiktningsman
      </h2>
      <div className="grid gap-x-5" style={{ gridTemplateColumns: '0.86fr 1px 1.14fr' }}>
        <PartyRows rows={parties.leftRows} />
        <div className="min-h-[27mm] self-stretch bg-[#2f6ea3]" />
        <PartyRows rows={parties.rightRows} />
      </div>
    </section>
  )
}

function SectionBlock({
  numberLabel,
  title,
  text,
  continuation,
  showDivider,
}: {
  numberLabel: string
  title: string
  text: string
  continuation: boolean
  showDivider: boolean
}) {
  return (
    <section
      className={
        continuation
          ? 'tu-report-block tu-report-section-block'
          : showDivider
            ? 'tu-report-block tu-report-section-block border-t border-violet-200 pt-4'
            : 'tu-report-block tu-report-section-block'
      }
      style={{ marginBottom: mm(SECTION_GAP_MM) }}
    >
      {!continuation ? (
        <h2 className="text-[15px] font-semibold leading-tight text-violet-950">
          {numberLabel}. {title}
        </h2>
      ) : null}
      {text.trim() ? (
        <div className={continuation ? '' : 'mt-2'}>
          <p
            className="whitespace-pre-wrap text-[13px] leading-6 text-gray-950"
            style={PRINT_TEXT_STYLE}
          >
            {text}
          </p>
        </div>
      ) : null}
    </section>
  )
}

function SubsectionBlock({
  numberLabel,
  title,
  text,
  continuation,
}: {
  numberLabel: string
  title: string
  text: string
  continuation: boolean
}) {
  return (
    <section
      className="tu-report-block tu-report-subsection-block"
      style={{ marginBottom: mm(BLOCK_GAP_MM) }}
    >
      {!continuation ? (
        <h3 className="text-[13px] font-semibold leading-tight text-gray-950">
          {numberLabel}. {title}
        </h3>
      ) : null}
      <div className={continuation ? '' : 'mt-1.5'}>
        <p
          className="whitespace-pre-wrap text-[13px] leading-6 text-gray-950"
          style={PRINT_TEXT_STYLE}
        >
          {text}
        </p>
      </div>
    </section>
  )
}

function SignatureBlock({ signature }: { signature: TuPrintSignature }) {
  const hasCredentials = signature.credentialLines.length > 0

  return (
    <section
      className="tu-report-block tu-report-signature-block border-t border-violet-200 pt-3"
      style={{ marginTop: mm(2), marginBottom: mm(BLOCK_GAP_MM) }}
    >
      <div className="flex items-start gap-4">
        {signature.avatarUrl ? (
          <div className="h-[20mm] w-[20mm] shrink-0 overflow-hidden bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={signature.avatarUrl}
              alt={signature.inspectorName}
              className="h-full w-full object-cover"
            />
          </div>
        ) : null}
        <div className="min-w-0 w-[72mm]">
          <div className="text-[12px] font-semibold leading-4 text-gray-950">
            {signature.locationAndDate}
          </div>

          {signature.signatureUrl ? (
            <div className="mt-1.5 flex h-[12mm] w-[38mm] items-center overflow-hidden bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={signature.signatureUrl}
                alt={`Underskrift ${signature.inspectorName}`}
                className="max-h-full max-w-full object-contain"
              />
            </div>
          ) : null}

          <div className="mt-1 text-[12px] font-semibold leading-4 text-gray-950">
            {signature.inspectorName}
          </div>
          {hasCredentials ? (
            <div className="mt-0.5 space-y-0.5 text-[11px] leading-4 text-gray-950">
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

function ImageGridBlock({
  images,
  onImageReady,
}: {
  images: TuPrintImage[]
  onImageReady?: (id: string) => void
}) {
  const singleImage = images.length === 1
  const twoImages = images.length === 2
  const gridClassName = singleImage
    ? 'grid grid-cols-1 justify-items-center'
    : 'grid grid-cols-2 gap-x-5 gap-y-5'
  const figureClassName = singleImage
    ? 'grid h-[132mm] w-full max-w-[155mm] grid-rows-[minmax(0,1fr)_auto]'
    : twoImages
      ? 'grid h-[108mm] grid-rows-[minmax(0,1fr)_auto]'
      : 'grid h-[66mm] grid-rows-[minmax(0,1fr)_auto]'
  return (
    <section
      className={`tu-report-block tu-report-image-grid-block ${gridClassName}`}
      style={{ marginBottom: mm(BLOCK_GAP_MM) }}
    >
      {images.map((image) => (
        <figure key={image.id} className={figureClassName}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={getAppendixPrintImageSrc(image.src)}
            alt={image.caption}
            data-tu-print-measure-image="true"
            className="h-full w-full object-contain object-center"
            onLoad={() => onImageReady?.(image.id)}
            onError={() => onImageReady?.(image.id)}
          />
          <figcaption className="mt-1 max-h-[12mm] overflow-hidden whitespace-pre-wrap text-[9px] leading-3 text-gray-700">
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
  isFirstOnPage = false,
}: {
  block: PrintableBlock
  onImageReady?: (id: string) => void
  isFirstOnPage?: boolean
}) {
  if (block.type === 'parties') {
    return <PartiesBlock numberLabel={block.numberLabel} parties={block.parties} />
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
        numberLabel={block.numberLabel}
        title={block.title}
        text={block.text}
        continuation={block.continuation}
        showDivider={!isFirstOnPage}
      />
    )
  }
  if (block.type === 'subsection') {
    return (
      <SubsectionBlock
        numberLabel={block.numberLabel}
        title={block.title}
        text={block.text}
        continuation={block.continuation}
      />
    )
  }
  if (block.type === 'appendix-title') {
    return (
      <section
        className="tu-report-block tu-report-appendix-title border-t border-violet-200 pt-2"
        style={{ marginBottom: mm(3) }}
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
    fontSize: '9.6pt',
    lineHeight: 1.22,
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
    <div className="flex h-full min-h-0 min-w-0 flex-col justify-start overflow-hidden px-1.5 py-0.5">
      <div className="shrink-0 text-[6pt] leading-[1.15] text-black">{label}</div>
      <div
        className="min-w-0 overflow-hidden break-words pb-0.5 font-medium text-black"
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
        <HeaderValue label={header.objectIdentifierLabel} value={header.objectIdentifier} />
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
        <div className="text-center text-[16px] font-medium leading-6 text-violet-950">
          Utlåtande över
        </div>
        <div className="mt-1 max-w-[150mm] text-center text-[32px] font-medium leading-tight text-violet-950">
          {coverTitle}
        </div>
        <div className="mt-7 text-center text-[10px] font-bold uppercase tracking-wide text-black">
          {header.objectIdentifier}
        </div>

        <div className="mt-7 flex h-[88mm] w-[142mm] items-center justify-center overflow-hidden bg-white">
          {coverImage ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={getCoverPrintImageSrc(coverImage.src)}
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
          <h2 className="text-[17px] font-medium text-violet-950">Innehåll</h2>
          <ol className="mt-3 space-y-2 text-[12px] leading-snug text-black">
            {tocEntries.map((entry) => (
              <li key={entry.id} className="grid grid-cols-[7mm_minmax(0,max-content)_minmax(12mm,1fr)_9mm] items-end gap-1">
                <span className="text-right">
                  {entry.numberLabel ? `${entry.numberLabel}.` : ''}
                </span>
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
        className="absolute grid grid-cols-3 items-end gap-4 border-t border-gray-300 pt-1.5 text-[9px] leading-[1.25] text-gray-700"
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
        <div className="flex min-w-0 justify-end self-end">
          <div className="flex flex-col items-center justify-end gap-1 text-center text-[8px] text-gray-500">
          <span>Skapat med</span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/report-assets/BesiktApp.png"
            alt="BesiktApp"
            className="h-auto max-h-[4mm] max-w-[22mm] object-contain"
          />
          </div>
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
      className="report-root tu-print-paged-document"
      data-report-pagination-ready={pagePlan ? '1' : '0'}
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
            src={getCoverPrintImageSrc(coverImage.src)}
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

      <div className="tu-print-pages flex flex-col items-center gap-4">
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
            {pageBlocks.map((block, blockIndex) => (
              <PrintableBlockView key={block.id} block={block} isFirstOnPage={blockIndex === 0} />
            ))}
          </PageChrome>
        ))}
      </div>
    </div>
  )
}
