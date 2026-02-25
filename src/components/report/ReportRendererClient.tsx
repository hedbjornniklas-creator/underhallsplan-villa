'use client'

import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import AppendixPage from '@/components/report/AppendixPage'
import ReportCoverPage from '@/components/report/ReportCoverPage'
import ReportPage from '@/components/report/ReportPage'
import type { ReportBlock, ReportSection, TextSource } from '@/lib/report/reportSpec'
import {
  ACCENT_COLOR,
  REPORT_STYLES,
  FONT_FAMILY,
  BASE_FONT_PT,
  LINE_HEIGHT,
  PAGE_HEIGHT_MM,
  PAGE_PADDING_MM,
  PAGE_WIDTH_MM,
  FOOTER_MARK_HEIGHT_MM,
  TEXT_COLOR,
  mmToPx,
} from '@/lib/report/reportTokens'

type ReportRendererClientProps = {
  spec: ResolvedReportSection[]
  mockData: Record<string, unknown>
  coverNotice: string
  rootClassName?: string
}

const PHOTO_POLICY = {
  maxLongSidePx: 1600,
  quality: 0.7,
}

const TRANSPARENT_PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='

const resizedImageCache = new Map<string, string>()

const getImageCacheKey = (src: string) =>
  `${src}|max=${PHOTO_POLICY.maxLongSidePx}|q=${PHOTO_POLICY.quality}`

const toProxyUrl = (src: string) => {
  if (!src) return src
  if (src.startsWith('data:')) return src
  if (src.startsWith('/')) return src
  if (typeof window !== 'undefined' && src.startsWith(window.location.origin)) return src
  return `/api/image-proxy?url=${encodeURIComponent(src)}`
}

const resizeImage = async (src: string): Promise<string> => {
  const cacheKey = getImageCacheKey(src)
  const cached = resizedImageCache.get(cacheKey)
  if (cached) return cached

  const renderToCanvas = (
    width: number,
    height: number,
    draw: (ctx: CanvasRenderingContext2D) => void
  ) => {
    const longestSide = Math.max(width, height)
    const shouldResize = longestSide > PHOTO_POLICY.maxLongSidePx
    const scale = shouldResize ? PHOTO_POLICY.maxLongSidePx / longestSide : 1
    const targetWidth = Math.max(1, Math.round(width * scale))
    const targetHeight = Math.max(1, Math.round(height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = targetWidth
    canvas.height = targetHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return src

    draw(ctx)
    const dataUrl = canvas.toDataURL('image/jpeg', PHOTO_POLICY.quality)
    resizedImageCache.set(cacheKey, dataUrl)
    return dataUrl
  }

  try {
    const fetchSrc = toProxyUrl(src)
    const response = await fetch(fetchSrc, { mode: 'cors', credentials: 'omit' })
    if (response.ok) {
      const blob = await response.blob()
      const bitmap = await createImageBitmap(blob)
      const dataUrl = renderToCanvas(bitmap.width, bitmap.height, (ctx) => {
        ctx.drawImage(bitmap, 0, 0, ctx.canvas.width, ctx.canvas.height)
      })
      if (typeof bitmap.close === 'function') bitmap.close()
      return dataUrl
    }
  } catch {
    // fallback below
  }

  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const width = img.naturalWidth || img.width
      const height = img.naturalHeight || img.height
      if (!width || !height) {
        resolve(src)
        return
      }
      try {
        resolve(
          renderToCanvas(width, height, (ctx) => {
            ctx.drawImage(img, 0, 0, ctx.canvas.width, ctx.canvas.height)
          })
        )
      } catch {
        resolve(src)
      }
    }
    img.onerror = () => resolve(src)
    img.src = toProxyUrl(src)
  })
}

const useResizedImage = (src: string | null) => {
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(null)

  useLayoutEffect(() => {
    let isActive = true
    if (!src) {
      setResolvedSrc(null)
      return () => {
        isActive = false
      }
    }

    setResolvedSrc(null)

    const cacheKey = getImageCacheKey(src)
    const cached = resizedImageCache.get(cacheKey)
    if (cached) {
      setResolvedSrc(cached)
      return () => {
        isActive = false
      }
    }

    resizeImage(src).then((dataUrl) => {
      if (!isActive) return
      setResolvedSrc(dataUrl)
    })

    return () => {
      isActive = false
    }
  }, [src])

  return resolvedSrc
}

const ReportPhoto = ({
  src,
  alt,
  className,
  style,
}: {
  src: string
  alt: string
  className?: string
  style?: CSSProperties
}) => {
  const resizedSrc = useResizedImage(src)
  const ready = Boolean(resizedSrc)
  return (
    <img
      src={resizedSrc ?? TRANSPARENT_PIXEL}
      alt={alt}
      className={className}
      style={style}
      data-report-track="1"
      data-report-ready={ready ? '1' : '0'}
    />
  )
}

type ResolvedReportSection = ReportSection & { appendixText?: string }

type InspectionBlockItem = {
  title?: string | null
  noteText?: string | null
  riskText?: string | null
  ftuText?: string | null
  photoUrls?: string[] | null
  photoRefs?: string | null
  hasDeviations?: boolean | null
}

type InspectionBlockItemEntry = {
  type: 'inspectionBlockItem'
  item: InspectionBlockItem
  marginTopMm: number
  marginBottomMm: number
}

type InspectionRoomGroupEntry = {
  type: 'inspectionRoomGroup'
  title: string
  items: InspectionBlockItem[]
  marginTopMm: number
  marginBottomMm: number
}

type RiskItemEntry = {
  type: 'riskItem'
  title: string
  body: string
  isFirst: boolean
  isLast: boolean
  marginTopMm: number
  marginBottomMm: number
}

type FtuItemEntry = {
  type: 'ftuItem'
  title: string
  body: string
  isFirst: boolean
  isLast: boolean
  marginTopMm: number
  marginBottomMm: number
}

type ExtendedReportBlock =
  | ReportBlock
  | InspectionBlockItemEntry
  | InspectionRoomGroupEntry
  | RiskItemEntry
  | FtuItemEntry

type Entry =
  | {
      kind: 'block'
      id: string
      sectionId: string
      sectionStartOnNewPage: boolean
      block: ExtendedReportBlock
    }
  | {
      kind: 'spacer'
      id: string
      heightPx: number
    }

type PagePlan =
  | {
      kind: 'cover'
      section: ResolvedReportSection
      pageNumber: number
    }
  | {
      kind: 'appendix'
      section: ResolvedReportSection
      rawText: string
      showTitle: boolean
      pageNumber: number
    }
  | {
      kind: 'sections'
      entries: Entry[]
      pageNumber: number
    }

const mmToPxNumber = (mm: number) => (mm * 96) / 25.4

function getMockValue(data: Record<string, unknown>, path: string): string {
  const parts = path.split('.').filter(Boolean)
  let current: any = data

  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = (current as Record<string, unknown>)[part]
    } else {
      return 'saknas'
    }
  }

  if (current === null || current === undefined) return 'saknas'
  return typeof current === 'string' || typeof current === 'number'
    ? String(current)
    : JSON.stringify(current)
}

function getMockPathValue(data: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.').filter(Boolean)
  let current: any = data

  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = (current as Record<string, unknown>)[part]
    } else {
      return null
    }
  }

  return current ?? null
}

function getMockArray<T>(data: Record<string, unknown>, path: string): T[] {
  const value = getMockPathValue(data, path)
  return Array.isArray(value) ? (value as T[]) : []
}

function getMockList(data: Record<string, unknown>, path: string): string[] {
  const parts = path.split('.').filter(Boolean)
  let current: any = data

  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = (current as Record<string, unknown>)[part]
    } else {
      return []
    }
  }

  if (current === null || current === undefined) return []

  if (Array.isArray(current)) {
    return current.map((item) =>
      typeof item === 'string' || typeof item === 'number'
        ? String(item)
        : JSON.stringify(item)
    )
  }

  if (typeof current === 'string') {
    return current.split('\n').map(line => line.trim()).filter(Boolean)
  }

  return []
}

function resolveText(source: TextSource, mockData: Record<string, unknown>): string {
  if (source.kind === 'static') return source.text
  if (source.kind === 'mock') return getMockValue(mockData, source.path)
  return ''
}

function blockMargins(block: { marginTopMm: number; marginBottomMm: number }) {
  return {
    marginTop: mmToPx(block.marginTopMm),
    marginBottom: mmToPx(block.marginBottomMm),
  }
}

function parseBuildingDataLines(content: string) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const index = line.indexOf(':')
      if (index === -1) return null
      const label = line.slice(0, index + 1).trim()
      const value = line.slice(index + 1).trim() || '--'
      return { label, value }
    })
    .filter((row): row is { label: string; value: string } => Boolean(row))
}

const appendxBreakHeadings = [
  'Besiktningsmannens ansvar',
  'Ã„ganderÃ¤tt och nyttjanderÃ¤tt till besiktningsutlÃ¥tandet',
  'Ãƒâ€žganderÃƒÂ¤tt och nyttjanderÃƒÂ¤tt till besiktningsutlÃƒÂ¥tandet',
]

const normalizeAppendixLines = (lines: string[]) => {
  const normalized: string[] = []
  lines.forEach((line) => {
    const isBlank = line.trim().length === 0
    if (isBlank && normalized.length === 0) return
    if (isBlank && normalized[normalized.length - 1]?.trim().length === 0) return
    normalized.push(line)
  })
  while (normalized.length && normalized[normalized.length - 1].trim().length === 0) {
    normalized.pop()
  }
  return normalized
}

const splitAppendixText = (rawText: string) => {
  const lines = rawText.split(/\r?\n/)
  const segments: string[][] = [[]]

  lines.forEach((line) => {
    const trimmed = line.trim()
    if (
      trimmed.length > 0 &&
      appendxBreakHeadings.some((heading) => trimmed.startsWith(heading)) &&
      segments[segments.length - 1].length > 0
    ) {
      segments.push([line])
    } else {
      segments[segments.length - 1].push(line)
    }
  })

  return segments
    .map((segment) => segment.join('\n'))
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
}

const appendixLineHeightPx = (BASE_FONT_PT * 96) / 72 * LINE_HEIGHT
const APPENDIX_PAGE_SAFETY_MM = 10
const appendixAvailableHeightPx = mmToPxNumber(
  PAGE_HEIGHT_MM -
    PAGE_PADDING_MM.top -
    PAGE_PADDING_MM.bottom -
    FOOTER_MARK_HEIGHT_MM -
    6 -
    APPENDIX_PAGE_SAFETY_MM
)
const appendixLinesPerColumn = Math.max(
  1,
  Math.floor(appendixAvailableHeightPx / appendixLineHeightPx)
)
const appendixLinesPerPage = appendixLinesPerColumn
const appendixTitleLineReduction = 6

const chunkAppendixLines = (lines: string[], showTitle: boolean) => {
  const pageSize = Math.max(
    1,
    appendixLinesPerPage - (showTitle ? appendixTitleLineReduction : 0)
  )
  const chunks: string[][] = []
  for (let i = 0; i < lines.length; i += pageSize) {
    chunks.push(lines.slice(i, i + pageSize))
  }
  return chunks
}

const buildGlossaryEntries = (lines: string[]) => {
  const entries: Array<{ term: string; definition?: string }> = []
  let i = 0
  while (i < lines.length) {
    const term = lines[i]?.trim() ?? ''
    if (!term) {
      i += 1
      continue
    }
    const definition = lines[i + 1]?.trim() ?? ''
    if (definition) {
      entries.push({ term, definition })
      i += 2
    } else {
      entries.push({ term })
      i += 1
    }
  }
  return entries
}

export default function ReportRendererClient({
  spec,
  mockData,
  coverNotice,
  rootClassName,
}: ReportRendererClientProps) {
  const [pagePlan, setPagePlan] = useState<{
    pages: PagePlan[]
    sectionPageMap: Map<string, number>
  } | null>(null)

  const measureContainerRef = useRef<HTMLDivElement | null>(null)
  const headerMeasureRef = useRef<HTMLDivElement | null>(null)
  const entryRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const coverSection = useMemo(
    () => spec.find(section => section.type === 'cover') ?? null,
    [spec]
  )

  const appendixSections = useMemo(
    () => spec.filter(section => section.type === 'appendix'),
    [spec]
  )

  const contentSections = useMemo(
    () => spec.filter(section => section.type !== 'cover' && section.type !== 'appendix'),
    [spec]
  )

  const sectionSpacingPx = mmToPxNumber(6)

  const contentEntries = useMemo<Entry[]>(() => {
    const entries: Entry[] = []
    contentSections.forEach((section, sectionIndex) => {
      section.blocks.forEach((block, blockIndex) => {
        if (
          block.type === 'text' &&
          section.id === 'risk' &&
          block.source.kind === 'mock' &&
          block.source.path === 'mock.risk.text'
        ) {
          const raw = resolveText(block.source, mockData)
          const parts = raw
            ? String(raw)
                .trim()
                .split(/\n\s*\n/)
                .map((chunk) =>
                  chunk
                    .split(/\r?\n/)
                    .map((line) => line.trim())
                    .filter(Boolean)
                )
            : []
          const items = parts
            .map((lines) => {
              if (lines.length === 0) return null
              const title = lines[0] ?? ''
              const body = lines.slice(1).join('\n')
              return { title, body }
            })
            .filter((entry): entry is { title: string; body: string } => Boolean(entry))

          items.forEach((item, itemIndex) => {
            entries.push({
              kind: 'block',
              id: `${section.id}-risk-item-${blockIndex}-${itemIndex}`,
              sectionId: section.id,
              sectionStartOnNewPage:
                section.startOnNewPage && blockIndex === 0 && itemIndex === 0,
              block: {
                type: 'riskItem',
                title: item.title,
                body: item.body,
                isFirst: itemIndex === 0,
                isLast: itemIndex === items.length - 1,
                marginTopMm: itemIndex === 0 ? block.marginTopMm : 0,
                marginBottomMm:
                  itemIndex === items.length - 1 ? block.marginBottomMm : 0,
              },
            })
          })
          return
        }

        if (
          block.type === 'text' &&
          section.id === 'ftu' &&
          block.source.kind === 'mock' &&
          block.source.path === 'mock.ftu.text'
        ) {
          const raw = resolveText(block.source, mockData)
          const parts = raw
            ? String(raw)
                .trim()
                .split(/\n\s*\n/)
                .map((chunk) =>
                  chunk
                    .split(/\r?\n/)
                    .map((line) => line.trim())
                    .filter(Boolean)
                )
            : []
          const items = parts
            .map((lines) => {
              if (lines.length === 0) return null
              const title = lines[0] ?? ''
              const body = lines.slice(1).join('\n')
              return { title, body }
            })
            .filter((entry): entry is { title: string; body: string } => Boolean(entry))

          items.forEach((item, itemIndex) => {
            entries.push({
              kind: 'block',
              id: `${section.id}-ftu-item-${blockIndex}-${itemIndex}`,
              sectionId: section.id,
              sectionStartOnNewPage:
                section.startOnNewPage && blockIndex === 0 && itemIndex === 0,
              block: {
                type: 'ftuItem',
                title: item.title,
                body: item.body,
                isFirst: itemIndex === 0,
                isLast: itemIndex === items.length - 1,
                marginTopMm: itemIndex === 0 ? block.marginTopMm : 0,
                marginBottomMm:
                  itemIndex === items.length - 1 ? block.marginBottomMm : 0,
              },
            })
          })
          return
        }

        if (block.type === 'inspectionBlocks') {
          const items = getMockArray<InspectionBlockItem>(mockData, block.itemsPath)
          if (items.length > 0) {
            if (section.id === 'notes-interior' || section.id === 'notes') {
              const groups: Array<{ title: string; items: InspectionBlockItem[] }> = []
              items.forEach((item) => {
                const title = String(item.title ?? '').trim()
                const last = groups[groups.length - 1]
                if (!last || last.title !== title) {
                  groups.push({ title, items: [item] })
                } else {
                  last.items.push(item)
                }
              })

              groups.forEach((group, groupIndex) => {
                entries.push({
                  kind: 'block',
                  id: `${section.id}-room-group-${blockIndex}-${groupIndex}`,
                  sectionId: section.id,
                  sectionStartOnNewPage:
                    section.startOnNewPage && blockIndex === 0 && groupIndex === 0,
                  block: {
                    type: 'inspectionRoomGroup',
                    title: group.title,
                    items: group.items,
                    marginTopMm: groupIndex === 0 ? block.marginTopMm : 0,
                    marginBottomMm:
                      groupIndex === groups.length - 1 ? block.marginBottomMm : 0,
                  },
                })
              })
              return
            }

            items.forEach((item, itemIndex) => {
              entries.push({
                kind: 'block',
                id: `${section.id}-inspection-item-${blockIndex}-${itemIndex}`,
                sectionId: section.id,
                sectionStartOnNewPage:
                  section.startOnNewPage && blockIndex === 0 && itemIndex === 0,
                block: {
                  type: 'inspectionBlockItem',
                  item,
                  marginTopMm: itemIndex === 0 ? block.marginTopMm : 0,
                  marginBottomMm:
                    itemIndex === items.length - 1 ? block.marginBottomMm : 0,
                },
              })
            })
            return
          }
        }

        entries.push({
          kind: 'block',
          id: `${section.id}-block-${blockIndex}`,
          sectionId: section.id,
          sectionStartOnNewPage: section.startOnNewPage && blockIndex === 0,
          block,
        })
      })

      if (sectionIndex < contentSections.length - 1) {
        const nextSection = contentSections[sectionIndex + 1]
        const shouldAddSpacer = !(
          section.id === 'okular' && nextSection?.id === 'building-data'
        )
        if (shouldAddSpacer) {
          entries.push({
            kind: 'spacer',
            id: `${section.id}-spacer`,
            heightPx: sectionSpacingPx,
          })
        }
      }
    })
    return entries
  }, [contentSections, sectionSpacingPx])

  const appendices = useMemo(() => {
    const pages: Array<{ section: ResolvedReportSection; rawText: string; showTitle: boolean }> = []
    appendixSections.forEach((section) => {
      const rawText = section.appendixText ?? ''
      const isAppendix1 =
        section.appendixId === 'APPENDIX_1_VILLKOR_SELLER_SBR' ||
        section.appendixId === 'APPENDIX_1_VILLKOR_BUYER_SBR'
      const isGlossary = section.id === 'appendix-2'
      const isLifespan = section.id === 'appendix-3'
      if (section.appendixText && isAppendix1) {
        const segments = splitAppendixText(rawText)
        let isFirstPage = true
        segments.forEach((segment) => {
          const normalizedLines = normalizeAppendixLines(segment.split(/\r?\n/))
          if (normalizedLines.length === 0) return
          const chunks = chunkAppendixLines(normalizedLines, isFirstPage)
          chunks.forEach((chunk, index) => {
            const showTitle = isFirstPage && index === 0
            const chunkText = chunk.join('\n')
            if (chunkText.trim().length === 0) {
              return
            }
            pages.push({ section, rawText: chunkText, showTitle })
          })
          if (chunks.length > 0) {
            const hasContent = chunks.some((chunk) => chunk.join('\n').trim().length > 0)
            if (hasContent) {
              isFirstPage = false
            }
          }
        })
      } else if (section.appendixText && isLifespan) {
        const normalizedLines = normalizeAppendixLines(rawText.split(/\r?\n/))
        if (normalizedLines.length === 0) return
        const entriesPerPage = Math.max(1, appendixLinesPerColumn * 2)
        const firstPageSize = Math.max(1, entriesPerPage - appendixTitleLineReduction)
        const firstChunk = normalizedLines.slice(0, firstPageSize)
        const remaining = normalizedLines.slice(firstPageSize)
        if (firstChunk.join('\n').trim().length > 0) {
          pages.push({ section, rawText: firstChunk.join('\n'), showTitle: true })
        }
        for (let i = 0; i < remaining.length; i += entriesPerPage) {
          const chunk = remaining.slice(i, i + entriesPerPage)
          const chunkText = chunk.join('\n')
          if (chunkText.trim().length > 0) {
            pages.push({ section, rawText: chunkText, showTitle: false })
          }
        }
      } else if (section.appendixText && isGlossary) {
        const normalizedLines = normalizeAppendixLines(rawText.split(/\r?\n/))
        if (normalizedLines.length === 0) return
        const entries = buildGlossaryEntries(normalizedLines)
        let entryIndex = 0
        let pageIndex = 0
        while (entryIndex < entries.length) {
          const isFirstPage = pageIndex === 0
          const linesPerColumn = Math.max(
            1,
            appendixLinesPerColumn - (isFirstPage ? appendixTitleLineReduction : 0)
          )
          const entriesPerColumn = Math.max(1, Math.floor(linesPerColumn / 2))
          const entriesPerPage = entriesPerColumn * 2
          const chunk = entries.slice(entryIndex, entryIndex + entriesPerPage)
          const chunkLines = chunk.flatMap((entry) =>
            entry.definition ? [entry.term, entry.definition] : [entry.term]
          )
          const chunkText = chunkLines.join('\n')
          if (chunkText.trim().length > 0) {
            pages.push({ section, rawText: chunkText, showTitle: isFirstPage })
          }
          entryIndex += entriesPerPage
          pageIndex += 1
        }
      } else {
        pages.push({ section, rawText, showTitle: true })
      }
    })
    return pages
  }, [appendixSections])

  const headerContent = (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: '11pt',
        color: '#000000',
      }}
    >
      <div>{getMockValue(mockData, 'mock.properties.cadastral_id') ?? 'saknas'}</div>
      <div>{getMockValue(mockData, 'mock.inspections.date') ?? 'saknas'}</div>
    </div>
  )

  const rootClasses = ['report-root', rootClassName].filter(Boolean).join(' ')
  const isPdfMode = rootClasses.includes('report-root--pdf')

  useLayoutEffect(() => {
    if (!measureContainerRef.current) return

    const nodes = contentEntries
      .map(entry => entryRefs.current[entry.id])
      .filter((node): node is HTMLDivElement => Boolean(node))

    if (nodes.length === 0 && contentEntries.length > 0) return

    const container = measureContainerRef.current
    const positions = nodes.map(node => node.offsetTop)
    const totalHeight = container.scrollHeight
    const heights = positions.map((top, index) => {
      if (index < positions.length - 1) {
        return positions[index + 1] - top
      }
      return totalHeight - top
    })

    const headerHeight = headerMeasureRef.current?.getBoundingClientRect().height ?? 0
    const pageHeightPx = mmToPxNumber(PAGE_HEIGHT_MM)
    const paddingTopPx = mmToPxNumber(PAGE_PADDING_MM.top)
    const paddingBottomPx = mmToPxNumber(PAGE_PADDING_MM.bottom)
    const footerMarkPx = mmToPxNumber(FOOTER_MARK_HEIGHT_MM)
    // Extra safety in PDF mode to avoid late-page collisions with fixed footer artwork.
    const safetyMm = isPdfMode ? 14 : 0
    const availableHeight =
      pageHeightPx -
      paddingTopPx -
      paddingBottomPx -
      footerMarkPx -
      headerHeight -
      mmToPxNumber(safetyMm)

    const pages: PagePlan[] = []
    const sectionPageMap = new Map<string, number>()
    const coverCount = coverSection ? 1 : 0

    let currentEntries: Entry[] = []
    let currentHeight = 0

    const hasMeaningfulEntry = (entries: Entry[]) =>
      entries.some((entry) => entry.kind === 'block')

    const pushPage = () => {
      if (currentEntries.length === 0) return
      if (!hasMeaningfulEntry(currentEntries)) {
        currentEntries = []
        currentHeight = 0
        return
      }
      pages.push({
        kind: 'sections',
        entries: currentEntries,
        pageNumber: coverCount + pages.length + 1,
      })
      currentEntries = []
      currentHeight = 0
    }

    contentEntries.forEach((entry, index) => {
      const height = entry.kind === 'spacer' ? entry.heightPx : heights[index] ?? 0

      if (entry.kind === 'block' && entry.sectionStartOnNewPage && currentEntries.length > 0) {
        pushPage()
      }

      if (entry.kind === 'spacer' && currentEntries.length === 0) {
        return
      }

      if (currentHeight + height > availableHeight && currentEntries.length > 0) {
        if (entry.kind === 'spacer') {
          pushPage()
          return
        }
        pushPage()
      }

      if (entry.kind === 'spacer' && currentEntries.length === 0) {
        return
      }

      currentEntries.push(entry)
      currentHeight += height

      if (entry.kind === 'block' && !sectionPageMap.has(entry.sectionId)) {
        sectionPageMap.set(entry.sectionId, coverCount + pages.length + 1)
      }
    })

    pushPage()

    const appendixPages: PagePlan[] = []
    appendices.forEach((appendix, index) => {
      const pageNumber = coverCount + pages.length + appendixPages.length + 1
      appendixPages.push({
        kind: 'appendix',
        section: appendix.section,
        rawText: appendix.rawText,
        showTitle: appendix.showTitle,
        pageNumber,
      })
      if (!sectionPageMap.has(appendix.section.id)) {
        sectionPageMap.set(appendix.section.id, pageNumber)
      }
    })

    const coverPages: PagePlan[] = coverSection
      ? [
          {
            kind: 'cover',
            section: coverSection,
            pageNumber: 1,
          },
        ]
      : []

    setPagePlan({
      pages: [...coverPages, ...pages, ...appendixPages],
      sectionPageMap,
    })
  }, [appendices, contentEntries, coverSection, mockData, isPdfMode])

  const companyLogoValue = getMockValue(mockData, 'mock.company.logo_url')
  const companyLogoUrl = companyLogoValue === 'saknas' ? null : companyLogoValue
  const cadastralId = getMockValue(mockData, 'mock.properties.cadastral_id')
  const address = getMockValue(mockData, 'mock.properties.address')
  const coverPathValue = getMockValue(mockData, 'mock.properties.cover_path')
  const coverIllustrationUrl = coverPathValue === 'saknas' ? null : coverPathValue
  const inspectionDate = getMockValue(mockData, 'mock.inspections.date')
  const assignmentNumber = getMockValue(mockData, 'mock.inspections.assignment_number')
  const companyName = getMockValue(mockData, 'mock.profile.company_name')
  const companyPhone = getMockValue(mockData, 'mock.profile.phone')
  const companyEmail = getMockValue(mockData, 'mock.profile.email')
  const companyOrgno = getMockValue(mockData, 'mock.profile.company_orgno')
  const companyStreet = getMockValue(mockData, 'mock.profile.company_address')
  const companyPostal = getMockValue(mockData, 'mock.profile.company_postal_code')
  const companyCity = getMockValue(mockData, 'mock.profile.company_city')

  const addressParts = [companyStreet, companyPostal, companyCity].filter(
    part => part && part !== 'saknas'
  )
  let companyAddressLine = 'saknas'
  if (addressParts.length) {
    if (companyStreet !== 'saknas' && (companyPostal !== 'saknas' || companyCity !== 'saknas')) {
      const rest = [companyPostal, companyCity].filter(part => part && part !== 'saknas').join(' ')
      companyAddressLine = rest ? `${companyStreet}, ${rest}` : companyStreet
    } else {
      companyAddressLine = addressParts.join(' ')
    }
  }

  const footerLeftLines = [
    companyName,
    companyAddressLine,
    companyPhone === 'saknas' ? 'Telefon: saknas' : `Telefon: ${companyPhone}`,
  ]

  const footerRightLines = [
    'www.webbadress.se',
    companyEmail === 'saknas' ? 'E-post: saknas' : `E-post: ${companyEmail}`,
    companyOrgno === 'saknas' ? 'Org.nr: saknas' : `Org.nr: ${companyOrgno}`,
  ]

  const footerCenterLines = [
    'VÅR KUNSKAP ÄR DIN TRYGGHET',
    '© 2025 SBR Byggingenjörerna. Version 2025.1',
  ]

  const renderInspectionItemContent = (
    item: InspectionBlockItem,
    keyPrefix: string,
    photoVariant: 'compact' | 'wide' = 'compact'
  ) => {
    const noteText = String(item.noteText ?? '').trim()
    const riskText = String(item.riskText ?? '').trim()
    const ftuText = String(item.ftuText ?? '').trim()
    const photoUrls = Array.isArray(item.photoUrls)
      ? item.photoUrls.filter((url) => typeof url === 'string')
      : []

    return (
      <>
        <section className="ob-section ob-section--note">
          <div className="ob-section__head grid grid-cols-[auto_auto_1fr] items-baseline gap-x-2">
            <span className="ob-icon ob-icon--note self-start mt-[1px]" aria-hidden="true">
              {'\u{1F9F1}'}
            </span>
            <span className="ob-section__label text-sm font-bold tracking-wide uppercase leading-relaxed text-gray-900">
              NOTERING
            </span>
            <span className="ob-section__text text-sm leading-relaxed text-gray-900 whitespace-pre-line">
              {noteText || '--'}
            </span>
          </div>
          {photoUrls.length > 0 && (
            <div className="mt-2 space-y-2">
              <div className="flex items-center gap-1.5 text-xs text-gray-700">
                <span aria-hidden="true">{'\u{1F4F7}'}</span>
                <span>Bilder</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {photoVariant === 'wide'
                  ? photoUrls.map((url, urlIndex) => (
                      <ReportPhoto
                        key={`${keyPrefix}-photo-${urlIndex}`}
                        src={url}
                        alt={`Foto ${urlIndex + 1}`}
                        className="h-auto rounded border border-gray-200 object-contain bg-white"
                        style={{ width: '60mm' }}
                      />
                    ))
                  : photoUrls.map((url, urlIndex) => (
                      <div
                        key={`${keyPrefix}-photo-${urlIndex}`}
                        className="h-24 w-32 rounded-md border border-gray-200 bg-white overflow-hidden flex items-center justify-center"
                      >
                        <ReportPhoto
                          src={url}
                          alt={`Foto ${urlIndex + 1}`}
                          className="max-h-full max-w-full object-contain"
                          style={{ width: '100%', height: '100%' }}
                        />
                      </div>
                    ))}
              </div>
            </div>
          )}
        </section>

        {riskText.length > 0 && (
          <div className="mt-4 rounded-md border border-gray-200 bg-white p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-gray-700">
              <span className="ob-icon ob-icon--risk" aria-hidden="true">
                {'\u26A0\uFE0F'}
              </span>
              <span>Riskanalys</span>
            </div>
            <div className="text-sm text-gray-800 whitespace-pre-line">
              {riskText}
            </div>
          </div>
        )}

        {ftuText.length > 0 && (
          <div className="mt-4 rounded-md border border-gray-200 bg-white p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-gray-700">
              <span className="ob-icon ob-icon--ftu" aria-hidden="true">
                {'\u{1F50D}'}
              </span>
              <span>Fortsatt teknisk utredning</span>
            </div>
            <div className="text-sm text-gray-800 whitespace-pre-line">
              {ftuText}
            </div>
          </div>
        )}
      </>
    )
  }

  const renderInspectionBlockItem = (
    item: InspectionBlockItem,
    key: string,
    marginTopMm: number,
    marginBottomMm: number
  ) => {
    const title = String(item.title ?? '')
    return (
      <article
        key={key}
        className="ob-block border border-gray-200 rounded-lg p-4 mb-6 bg-white"
        style={blockMargins({ marginTopMm, marginBottomMm } as ReportBlock)}
      >
        <header className="ob-block__header mb-3">
          <h4 className="ob-block__title text-[15px] font-semibold text-gray-900">
            {title}
          </h4>
        </header>

        {renderInspectionItemContent(item, key)}
      </article>
    )
  }

  const renderBlock = (
    block: ExtendedReportBlock,
    sectionId: string,
    index: number,
    sectionPageMap: Map<string, number>
  ) => {
    if (block.type === 'inspectionBlockItem') {
      return renderInspectionBlockItem(
        block.item,
        `${sectionId}-inspection-item-${index}`,
        block.marginTopMm,
        block.marginBottomMm
      )
    }
    if (block.type === 'riskItem') {
      return (
        <div
          key={`${sectionId}-risk-item-${index}`}
          style={blockMargins({
            marginTopMm: block.marginTopMm,
            marginBottomMm: block.marginBottomMm,
          } as ReportBlock)}
        >
          <div className="flex gap-2">
            <span className="ob-icon ob-icon--risk" aria-hidden="true">
              {'\u26A0\uFE0F'}
            </span>
            <div className="text-sm text-gray-900 whitespace-pre-line">
              <div className="font-semibold">{block.title}</div>
              {block.body && <div className="mt-0.5">{block.body}</div>}
            </div>
          </div>
        </div>
      )
    }
    if (block.type === 'ftuItem') {
      return (
        <div
          key={`${sectionId}-ftu-item-${index}`}
          style={blockMargins({
            marginTopMm: block.marginTopMm,
            marginBottomMm: block.marginBottomMm,
          } as ReportBlock)}
        >
          <div className="flex gap-2">
            <span className="ob-icon ob-icon--ftu" aria-hidden="true">
              {'\u{1F50D}'}
            </span>
            <div className="text-sm text-gray-900 whitespace-pre-line">
              <div className="font-semibold">{block.title}</div>
              {block.body && <div className="mt-0.5">{block.body}</div>}
            </div>
          </div>
        </div>
      )
    }

    if (block.type === 'heading') {
      const preset =
        block.level === 1
          ? REPORT_STYLES.H1
          : block.level === 2
            ? REPORT_STYLES.H2
            : REPORT_STYLES.H3
      const fontSize = block.fontSizePt ? `${block.fontSizePt}pt` : preset.fontSize
      return (
        <div
          key={`${sectionId}-heading-${index}`}
          className="report-heading"
          style={{
            ...blockMargins(block),
            fontSize,
            fontWeight: preset.fontWeight,
            color: block.accent ? ACCENT_COLOR : preset.color,
            textTransform: block.level === 1 ? 'uppercase' : 'none',
            textAlign: block.align ?? 'left',
          }}
        >
          {block.text}
        </div>
      )
    }

    if (block.type === 'toc') {
      return (
        <div
          key={`${sectionId}-toc-${index}`}
          style={{
            ...blockMargins(block),
            display: 'flex',
            flexDirection: 'column',
            gap: mmToPx(2),
            fontSize: REPORT_STYLES.BODY.fontSize,
            color: REPORT_STYLES.BODY.color,
            marginTop: `calc(${mmToPx(block.marginTopMm)} + 18px)`,
          }}
        >
          {block.entries.map((entry, entryIndex) => {
            const pageNumber = entry.sectionId
              ? sectionPageMap.get(entry.sectionId)
              : undefined
            return (
              <div
                key={`${sectionId}-toc-${entryIndex}`}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: mmToPx(4),
                }}
              >
                <span>{entry.label}</span>
                <span>{pageNumber ?? 'â€“'}</span>
              </div>
            )
          })}
        </div>
      )
    }

    if (block.type === 'list') {
      const items = getMockList(mockData, block.itemsPath)
      const rows =
        items.length > 0
          ? items
          : block.emptyPlaceholder
            ? [block.emptyPlaceholder]
            : []
      return (
        <div
          key={`${sectionId}-list-${index}`}
          style={{
            ...blockMargins(block),
            display: 'flex',
            flexDirection: 'column',
            gap: mmToPx(block.rowGapMm ?? 1.5),
            fontSize: '11pt',
            color: REPORT_STYLES.BODY.color,
          }}
        >
          {rows.map((item, rowIndex) => (
            <div key={`${sectionId}-list-${index}-${rowIndex}`}>{item}</div>
          ))}
        </div>
      )
    }

    if (block.type === 'inspectionBlocks') {
      const blocks = getMockArray<InspectionBlockItem>(mockData, block.itemsPath)
      if (blocks.length === 0) {
        return (
          <div
            key={`${sectionId}-inspection-${index}`}
            style={blockMargins(block)}
            className="text-sm text-gray-800"
          >
            --
          </div>
        )
      }

      return (
        <div
          key={`${sectionId}-inspection-${index}`}
          style={blockMargins(block)}
        >
          {blocks.map((item, itemIndex) => {
            return (
              <article
                key={`${sectionId}-inspection-${index}-${itemIndex}`}
                className="ob-block border border-gray-200 rounded-lg p-4 mb-6 bg-white"
              >
                <header className="ob-block__header mb-3">
                  <h4 className="ob-block__title text-[15px] font-semibold text-gray-900">
                    {String(item.title ?? '')}
                  </h4>
                </header>

                {renderInspectionItemContent(
                  item,
                  `${sectionId}-inspection-${index}-${itemIndex}`
                )}
              </article>
            )
          })}
        </div>
      )
    }

    if (block.type === 'inspectionRoomGroup') {
      const title = String(block.title ?? '')
      const extraGapMm = 2
      return (
        <article
          key={`${sectionId}-room-group-${index}`}
          style={{
            ...blockMargins(block),
            marginBottom: mmToPx((block.marginBottomMm ?? 0) + extraGapMm),
          }}
          className="rounded-xl border border-blue-300/70 bg-white p-4 mb-6 break-inside-avoid"
        >
          <header className="mb-3">
            <h4 className="text-[15px] font-semibold text-gray-900">{title}</h4>
          </header>
          <div className="space-y-4">
            {block.items.map((item, itemIndex) => (
              <div
                key={`${sectionId}-room-group-${index}-${itemIndex}`}
                className={
                  itemIndex === 0 ? '' : 'pt-4 border-t border-blue-200/70'
                }
              >
                {renderInspectionItemContent(
                  item,
                  `${sectionId}-room-group-${index}-${itemIndex}`,
                  'wide'
                )}
              </div>
            ))}
          </div>
        </article>
      )
    }

    if (block.type === 'twoColumn') {
      const labelWidth = block.labelWidthMm ?? 65
      const rowGap = block.rowGapMm ?? 2
      return (
        <div
          key={`${sectionId}-table-${index}`}
          style={{
            ...blockMargins(block),
            display: 'grid',
            gridTemplateColumns: `${mmToPx(labelWidth)} 1fr`,
            columnGap: mmToPx(4),
            rowGap: mmToPx(rowGap),
            fontSize: '11pt',
            color: REPORT_STYLES.BODY.color,
          }}
        >
          {block.rows.flatMap((row, rowIndex) => {
            const values = Array.isArray(row.value) ? row.value : [row.value]
            return [
              <div key={`${sectionId}-label-${rowIndex}`} style={{ fontWeight: 400 }}>
                {row.label}
              </div>,
              <div key={`${sectionId}-value-${rowIndex}`}>
                {values.map((valueSource, valueIndex) => (
                  <div key={`${sectionId}-line-${rowIndex}-${valueIndex}`}>
                    {String(resolveText(valueSource, mockData))
                      .split(/\r?\n/)
                      .map((line, lineIndex) => (
                        <div key={`${sectionId}-line-${rowIndex}-${valueIndex}-${lineIndex}`}>
                          {line || '\u00A0'}
                        </div>
                      ))}
                  </div>
                ))}
                {row.note ? (
                  <div
                    style={{
                      marginTop: mmToPx(1),
                      fontSize: row.note.fontSizePt
                        ? `${row.note.fontSizePt}pt`
                        : REPORT_STYLES.SMALL.fontSize,
                      color: row.note.color ?? '#444444',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {row.note.text}
                  </div>
                ) : null}
              </div>,
            ]
          })}
        </div>
      )
    }

    if (block.type === 'handlingarLayout') {
      const labelWidth = block.labelWidthMm ?? 55
      const rowGap = block.rowGapMm ?? 6
      const emptyPlaceholder = block.emptyPlaceholder ?? '--'
      const provided = getMockList(mockData, 'mock.documents.provided')
      const acquisitionText = getMockValue(
        mockData,
        'mock.disclosures.acquisition_text'
      )
      const renovations = getMockList(mockData, 'mock.disclosures.renovations')
      const faults = getMockList(mockData, 'mock.disclosures.property_faults')

      const renderLines = (lines: string[], gapMm: number) => (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: mmToPx(gapMm),
          }}
        >
          {lines.map((line, lineIndex) => (
            <div key={`handlingar-line-${lineIndex}`}>
              {line.length > 0 ? line : '\u00A0'}
            </div>
          ))}
        </div>
      )

      const infoBlocks = [
        { text: block.infoDisclaimer, marginBottomMm: 3 },
        { text: acquisitionText, marginBottomMm: 3 },
        {
          text: block.renovationsLabel,
          marginBottomMm: renovations.length > 0 ? 1.5 : 0,
        },
      ]

      const rowStyle = {
        display: 'grid',
        gridTemplateColumns: `${mmToPx(labelWidth)} 1fr`,
        columnGap: mmToPx(4),
        breakInside: 'avoid',
      } as const

      const textStyle = {
        fontSize: '11pt',
        color: REPORT_STYLES.BODY.color,
        whiteSpace: 'pre-wrap',
      } as const

      return (
        <div
          key={`${sectionId}-handlingar-${index}`}
          style={{
            ...blockMargins(block),
            display: 'flex',
            flexDirection: 'column',
            gap: mmToPx(rowGap),
          }}
        >
          <div style={rowStyle}>
            <div style={textStyle}>{block.labels.provided}</div>
            <div style={textStyle}>
              {renderLines(
                provided.length > 0 ? provided : [emptyPlaceholder],
                1.5
              )}
            </div>
          </div>

          <div style={rowStyle}>
            <div style={textStyle}>{block.labels.info}</div>
            <div style={textStyle}>
              {infoBlocks.map((entry, entryIndex) => (
                <div
                  key={`handlingar-info-${entryIndex}`}
                  style={{
                    marginBottom: mmToPx(entry.marginBottomMm),
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {entry.text}
                </div>
              ))}
              {renovations.length > 0
                ? renderLines(renovations, 1.5)
                : null}
            </div>
          </div>

          <div style={rowStyle}>
            <div style={textStyle}>{block.labels.faults}</div>
            <div style={textStyle}>
              {faults.length > 0 ? renderLines(faults, 1.5) : null}
            </div>
          </div>
        </div>
      )
    }

    if (block.type === 'text') {
      const preset = block.small ? REPORT_STYLES.SMALL : REPORT_STYLES.BODY
      const content = resolveText(block.source, mockData)
      const isBuildingData =
        block.source.kind === 'mock' &&
        block.source.path === 'mock.buildingData.text'
      const isVisualPreface =
        block.source.kind === 'static' &&
        block.source.text.includes('Byggnaden var')
      const boldHeadings = new Set([
        'SÃ¤rskilda fÃ¶rutsÃ¤ttningar vid besiktningen:',
        'Muntliga uppgifter:',
      ])
      if (isBuildingData) {
        const rows = parseBuildingDataLines(String(content))
        return (
          <div
            key={`${sectionId}-text-${index}`}
          style={{
            ...blockMargins(block),
            display: 'grid',
            gridTemplateColumns: `${mmToPx(50)} 1fr`,
            columnGap: mmToPx(4),
            rowGap: mmToPx(4),
            fontSize: preset.fontSize,
            color: preset.color,
              lineHeight: 1.15,
            }}
          >
            {rows.flatMap((row, rowIndex) => [
              <div key={`${sectionId}-building-label-${rowIndex}`} style={{ fontWeight: 400 }}>
                {row.label}
              </div>,
              <div
                key={`${sectionId}-building-value-${rowIndex}`}
                style={{ whiteSpace: 'pre-wrap' }}
              >
                {row.value}
              </div>,
            ])}
          </div>
        )
      }
      if (isVisualPreface) {
        const furnishingLevel = getMockValue(
          mockData,
          'mock.inspection_conditions.furnishing_level'
        )
        const furnishingText =
          furnishingLevel && furnishingLevel !== 'saknas' ? furnishingLevel : null
        const lines = String(content).split(/\r?\n/)
        return (
          <div
            key={`${sectionId}-text-${index}`}
            style={{
              ...blockMargins(block),
              fontSize: preset.fontSize,
              color: preset.color,
              lineHeight: 1.15,
            }}
          >
            {lines.map((line, lineIndex) => {
              let renderedLine = line
              if (
                furnishingText &&
                line.includes('Byggnaden var') &&
                line.includes('vid besiktningstillfÃ¤llet')
              ) {
                renderedLine = line.replace('fullt mÃ¶blerad', furnishingText)
              }
              const trimmed = renderedLine.trim()
              const isBold = boldHeadings.has(trimmed)
              return (
                <div
                  key={`${sectionId}-text-${index}-${lineIndex}`}
                  style={{
                    fontWeight: isBold ? 700 : preset.fontWeight,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {renderedLine.length > 0 ? renderedLine : '\u00A0'}
                </div>
              )
            })}
          </div>
        )
      }
      return (
        <div
          key={`${sectionId}-text-${index}`}
          style={{
            ...blockMargins(block),
            fontSize: preset.fontSize,
            fontWeight: preset.fontWeight,
            color: preset.color,
            whiteSpace: 'pre-wrap',
          }}
        >
          {content}
        </div>
      )
    }

    if (block.type === 'boxedText') {
      const preset = block.small ? REPORT_STYLES.SMALL : REPORT_STYLES.BODY
      const content = resolveText(block.source, mockData)
      return (
        <div
          key={`${sectionId}-boxed-text-${index}`}
          style={blockMargins(block)}
          className="rounded-lg border border-transparent bg-white p-4"
        >
          <div
            style={{
              fontSize: preset.fontSize,
              fontWeight: preset.fontWeight,
              color: preset.color,
              whiteSpace: 'pre-wrap',
            }}
          >
            {content}
          </div>
        </div>
      )
    }

    if (block.type === 'field') {
      const value = getMockValue(mockData, block.path)
      return (
        <div
          key={`${sectionId}-field-${index}`}
          style={{
            ...blockMargins(block),
            fontSize: REPORT_STYLES.BODY.fontSize,
          }}
        >
          <strong>{block.label}:</strong> {value}
        </div>
      )
    }

    if (block.type === 'image') {
      if (!block.label && block.heightMm <= 2) {
        return (
          <div
            key={`${sectionId}-image-${index}`}
            style={{
              ...blockMargins(block),
              height: mmToPx(block.heightMm),
              backgroundColor: ACCENT_COLOR,
            }}
          />
        )
      }
      return (
        <div
          key={`${sectionId}-image-${index}`}
          style={{
            ...blockMargins(block),
            width: mmToPx(block.widthMm),
            height: mmToPx(block.heightMm),
            border: '1px solid #cbd5e1',
            backgroundColor: '#f8fafc',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#64748b',
            fontSize: REPORT_STYLES.SMALL.fontSize,
          }}
        >
          {block.label}
        </div>
      )
    }

    if (block.type === 'pageBreak') {
      return (
        <div
          key={`${sectionId}-page-${index}`}
          style={{
            ...blockMargins(block),
            borderTop: '2px solid #e2e8f0',
            paddingTop: mmToPx(3),
            color: '#64748b',
            fontSize: REPORT_STYLES.SMALL.fontSize,
          }}
        >
          {block.label ?? 'Sidbrytning'}
        </div>
      )
    }

    return null
  }

  return (
    <div className={rootClasses} style={{ backgroundColor: '#f1f5f9', padding: mmToPx(6) }}>
      <div
        ref={measureContainerRef}
        style={{
          position: 'absolute',
          left: '-99999px',
          top: 0,
          visibility: 'hidden',
          width: mmToPxNumber(PAGE_WIDTH_MM) - mmToPxNumber(PAGE_PADDING_MM.left) - mmToPxNumber(PAGE_PADDING_MM.right),
          fontFamily: FONT_FAMILY,
          color: TEXT_COLOR,
          lineHeight: LINE_HEIGHT,
        }}
      >
        <div
          ref={headerMeasureRef}
          style={{
            marginTop: mmToPx(-PAGE_PADDING_MM.top / 2),
            marginBottom: mmToPx(6),
          }}
        >
          {headerContent}
        </div>
        {contentEntries.map((entry, index) => {
          if (entry.kind === 'spacer') {
            return (
              <div
                key={entry.id}
                ref={node => {
                  entryRefs.current[entry.id] = node
                }}
                style={{ height: `${entry.heightPx}px` }}
              />
            )
          }
          return (
            <div
              key={entry.id}
              ref={node => {
                entryRefs.current[entry.id] = node
              }}
            >
              {renderBlock(entry.block, entry.sectionId, index, new Map())}
            </div>
          )
        })}
      </div>

      {pagePlan?.pages.map((page) => {
        if (page.kind === 'cover') {
          return (
            <ReportPage
              key={`page-cover-${page.pageNumber}`}
              pageNumber={page.pageNumber}
              footerLeftLines={footerLeftLines}
              footerRightLines={footerRightLines}
              footerCenterLines={footerCenterLines}
              header={undefined}
            >
              <ReportCoverPage
                companyLogoUrl={companyLogoUrl}
                cadastralId={cadastralId}
                address={address}
                inspectionDate={inspectionDate}
                assignmentNumber={assignmentNumber}
                coverIllustrationUrl={coverIllustrationUrl}
                coverNotice={coverNotice}
              />
            </ReportPage>
          )
        }

        if (page.kind === 'appendix') {
          return (
            <ReportPage
              key={`page-appendix-${page.pageNumber}`}
              pageNumber={page.pageNumber}
              footerLeftLines={[]}
              footerRightLines={[]}
              footerCenterLines={footerCenterLines}
              header={headerContent}
            >
              <AppendixPage
                title={page.section.title ?? 'Bilaga'}
                rawText={page.rawText}
                showTitle={page.showTitle}
                variant={
                  page.section.id === 'appendix-2'
                    ? 'glossary'
                    : page.section.id === 'appendix-3'
                      ? 'lifespan'
                      : 'longform'
                }
              />
            </ReportPage>
          )
        }

        return (
          <ReportPage
            key={`page-${page.pageNumber}`}
            pageNumber={page.pageNumber}
            footerLeftLines={[]}
            footerRightLines={[]}
            footerCenterLines={footerCenterLines}
            header={headerContent}
          >
            {page.entries.map((entry, index) => {
              if (entry.kind === 'spacer') {
                return <div key={`${entry.id}-page`} style={{ height: `${entry.heightPx}px` }} />
              }
              return (
                <div key={`${entry.id}-page`}>
                  {renderBlock(entry.block, entry.sectionId, index, pagePlan.sectionPageMap)}
                </div>
              )
            })}
          </ReportPage>
        )
      })}
    </div>
  )
}




