'use client'

import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import AppendixPage from '@/components/report/AppendixPage'
import ReportCoverPage from '@/components/report/ReportCoverPage'
import ReportPage from '@/components/report/ReportPage'
import type { ReportBlock, ReportSection, TextSource } from '@/lib/report/reportSpec'
import {
  ACCENT_COLOR,
  APPENDIX_FONT_PT,
  REPORT_STYLES,
  FONT_FAMILY,
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
  inspectionSide?: 'buyer' | 'seller' | 'apartment' | null
  rootClassName?: string
}

const PHOTO_POLICY = {
  digitalMaxLongSidePx: 1600,
  pdfMaxLongSidePx: 900,
  digitalQuality: 72,
  pdfQuality: 68,
}

const TRANSPARENT_PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='

const toProxyUrl = (src: string, maxLongSidePx: number, quality: number) => {
  if (!src) return src
  if (src.startsWith('data:')) return src
  if (src.startsWith('/')) return src
  if (typeof window !== 'undefined' && src.startsWith(window.location.origin)) return src
  const params = new URLSearchParams({
    url: src,
    max: String(maxLongSidePx),
    q: String(quality),
  })
  return `/api/image-proxy?${params.toString()}`
}

const ReportPhoto = ({
  src,
  alt,
  className,
  style,
  maxLongSidePx = PHOTO_POLICY.digitalMaxLongSidePx,
  quality = PHOTO_POLICY.digitalQuality,
  onSettled,
}: {
  src: string
  alt: string
  className?: string
  style?: CSSProperties
  maxLongSidePx?: number
  quality?: number
  onSettled?: () => void
}) => {
  const imageSrc = useMemo(
    () => toProxyUrl(src, maxLongSidePx, quality),
    [maxLongSidePx, quality, src]
  )
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)

  useLayoutEffect(() => {
    setReady(false)
    setFailed(false)
  }, [imageSrc])

  return (
    <img
      src={failed ? TRANSPARENT_PIXEL : imageSrc}
      alt={alt}
      className={className}
      style={style}
      onLoad={() => {
        setReady((wasReady) => {
          if (!wasReady) onSettled?.()
          return true
        })
      }}
      onError={() => {
        setFailed(true)
        setReady((wasReady) => {
          if (!wasReady) onSettled?.()
          return true
        })
      }}
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

type InspectionRoomGroupItemEntry = {
  type: 'inspectionRoomGroupItem'
  title: string
  item: InspectionBlockItem
  isFirstInGroup: boolean
  isLastInGroup: boolean
  marginTopMm: number
  marginBottomMm: number
}

type InspectionItemSegmentKind = 'note' | 'photos' | 'risk' | 'ftu'

type InspectionRoomGroupItemSegmentEntry = {
  type: 'inspectionRoomGroupItemSegment'
  title: string
  item: InspectionBlockItem
  segment: InspectionItemSegmentKind
  photoUrls: string[]
  photoStartIndex: number
  photoTotal: number
  isFirstInGroup: boolean
  isFirstSegmentInItem: boolean
  suppressTopBorder: boolean
  isLastInGroup: boolean
  marginTopMm: number
  marginBottomMm: number
}

type PdfInspectionSegment = {
  segment: InspectionItemSegmentKind
  photoUrls: string[]
  photoStartIndex: number
  photoTotal: number
}

type InspectionFloorHeaderEntry = {
  type: 'inspectionFloorHeader'
  title: string
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

type BuildingDataRowEntry = {
  type: 'buildingDataRow'
  label: string
  value: string
  marginTopMm: number
  marginBottomMm: number
}

type ExtendedReportBlock =
  | ReportBlock
  | InspectionBlockItemEntry
  | InspectionRoomGroupEntry
  | InspectionRoomGroupItemEntry
  | InspectionRoomGroupItemSegmentEntry
  | InspectionFloorHeaderEntry
  | RiskItemEntry
  | FtuItemEntry
  | BuildingDataRowEntry

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

type ReportIconName = 'note' | 'risk' | 'ftu' | 'photo'

function ReportIcon({ name }: { name: ReportIconName }) {
  const baseStyle: CSSProperties = {
    width: '13px',
    height: '13px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: '0 0 13px',
    position: 'relative',
  }

  if (name === 'note') {
    return (
      <span style={baseStyle} aria-hidden="true">
        <span
          style={{
            width: '11px',
            height: '12px',
            border: '1.5px solid #5b9bd5',
            borderRadius: '2px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            gap: '2px',
            padding: '2px',
          }}
        >
          <span style={{ height: '1px', backgroundColor: '#5b9bd5' }} />
          <span style={{ height: '1px', backgroundColor: '#5b9bd5' }} />
          <span style={{ height: '1px', width: '70%', backgroundColor: '#5b9bd5' }} />
        </span>
      </span>
    )
  }

  if (name === 'risk') {
    return (
      <span
        style={{
          ...baseStyle,
          borderRadius: '999px',
          border: '1.5px solid #b45309',
          color: '#b45309',
          fontSize: '10px',
          fontWeight: 700,
          lineHeight: 1,
        }}
        aria-hidden="true"
      >
        !
      </span>
    )
  }

  if (name === 'ftu') {
    return (
      <span style={baseStyle} aria-hidden="true">
        <span
          style={{
            width: '8px',
            height: '8px',
            border: '1.7px solid #374151',
            borderRadius: '999px',
            position: 'absolute',
            left: '1px',
            top: '1px',
          }}
        />
        <span
          style={{
            width: '6px',
            height: '1.7px',
            backgroundColor: '#374151',
            position: 'absolute',
            right: '0px',
            bottom: '1px',
            transform: 'rotate(45deg)',
            transformOrigin: 'center',
            borderRadius: '999px',
          }}
        />
      </span>
    )
  }

  return (
    <span style={baseStyle} aria-hidden="true">
      <span
        style={{
          width: '12px',
          height: '9px',
          border: '1.5px solid #374151',
          borderRadius: '2px',
          position: 'relative',
        }}
      >
        <span
          style={{
            width: '4px',
            height: '4px',
            border: '1.2px solid #374151',
            borderRadius: '999px',
            position: 'absolute',
            left: '3px',
            top: '2px',
          }}
        />
      </span>
    </span>
  )
}

const PDF_PHOTOS_PER_SEGMENT = 2
const PDF_PHOTO_FRAME_WIDTH_MM = 60
const PDF_PHOTO_FRAME_HEIGHT_MM = 72

const getInspectionPhotoUrls = (item: InspectionBlockItem) =>
  Array.isArray(item.photoUrls)
    ? item.photoUrls.filter(
        (url): url is string => typeof url === 'string' && url.trim().length > 0
      )
    : []

const chunkItems = <T,>(items: T[], size: number) => {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

const buildPdfInspectionSegments = (item: InspectionBlockItem) => {
  const allPhotoUrls = getInspectionPhotoUrls(item)
  const photoTotal = allPhotoUrls.length
  const segments: PdfInspectionSegment[] = [
    { segment: 'note', photoUrls: [], photoStartIndex: 0, photoTotal },
  ]

  if (String(item.riskText ?? '').trim().length > 0) {
    segments.push({ segment: 'risk', photoUrls: [], photoStartIndex: 0, photoTotal })
  }

  if (String(item.ftuText ?? '').trim().length > 0) {
    segments.push({ segment: 'ftu', photoUrls: [], photoStartIndex: 0, photoTotal })
  }

  chunkItems(allPhotoUrls, PDF_PHOTOS_PER_SEGMENT).forEach(
    (photoUrls, chunkIndex) => {
      segments.push({
        segment: 'photos',
        photoUrls,
        photoStartIndex: chunkIndex * PDF_PHOTOS_PER_SEGMENT + 1,
        photoTotal,
      })
    }
  )

  return segments
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
  const rows: Array<{ label: string; value: string }> = []

  content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const index = line.indexOf(':')
      if (index === -1) {
        const previous = rows[rows.length - 1]
        if (previous) previous.value = `${previous.value}\n${line}`.trim()
        return
      }

      const label = line.slice(0, index + 1).trim()
      const value = line.slice(index + 1).trim() || '--'
      rows.push({ label, value })
    })

  return rows
}

function splitInspectionGroupTitle(title: string) {
  const parts = title.split(/\s+-\s+/)
  if (parts.length < 2) return { context: '', label: title.trim() }

  const context = parts[0]?.trim() ?? ''
  const label = parts.slice(1).join(' - ').trim()
  const isFloorContext =
    /^plan\s+\d+$/i.test(context) ||
    /^källare/i.test(context) ||
    /^allmänt$/i.test(context) ||
    /^vind$/i.test(context) ||
    /^inredd\s+vind$/i.test(context)

  if (!isFloorContext || !label) return { context: '', label: title.trim() }
  return { context, label }
}

const appendixBreakHeadings = [
  'Besiktningsmannens ansvar',
  'Äganderätt och nyttjanderätt till besiktningsutlåtandet',
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
      appendixBreakHeadings.some((heading) => trimmed.startsWith(heading)) &&
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

const APPENDIX_LINE_HEIGHT = 1.15
const APPENDIX_PAGE_SAFETY_MM = 30
const APPENDIX_HEADER_RESERVE_MM = 10
const APPENDIX_MAX_LINES_PER_COLUMN = 38
const APPENDIX_LONGFORM_CHARS_PER_LINE = 108
const appendixLineHeightPx = (APPENDIX_FONT_PT * 96) / 72 * APPENDIX_LINE_HEIGHT
const appendixAvailableHeightPx = mmToPxNumber(
  PAGE_HEIGHT_MM -
    PAGE_PADDING_MM.top -
    PAGE_PADDING_MM.bottom -
    FOOTER_MARK_HEIGHT_MM -
    APPENDIX_HEADER_RESERVE_MM -
    6 -
    APPENDIX_PAGE_SAFETY_MM
)
const appendixLinesPerColumn = Math.max(
  1,
  Math.min(
    APPENDIX_MAX_LINES_PER_COLUMN,
    Math.floor(appendixAvailableHeightPx / appendixLineHeightPx)
  )
)
const appendixLinesPerPage = appendixLinesPerColumn
const appendixTitleLineReduction = 7

const estimateAppendixLineUnits = (line: string) => {
  const trimmed = line.trim()
  if (!trimmed) return 0.7
  return Math.max(1, Math.ceil(trimmed.length / APPENDIX_LONGFORM_CHARS_PER_LINE))
}

const chunkAppendixLines = (lines: string[], showTitle: boolean, columns = 1) => {
  const chunks: string[][] = []
  let current: string[] = []
  let currentUnits = 0
  const pageCapacity = Math.max(1, appendixLinesPerPage * columns)
  const titleReduction = showTitle ? appendixTitleLineReduction * columns : 0
  let limit = Math.max(
    1,
    pageCapacity - titleReduction
  )

  lines.forEach((line) => {
    const units = estimateAppendixLineUnits(line)
    if (current.length > 0 && currentUnits + units > limit) {
      chunks.push(current)
      current = []
      currentUnits = 0
      limit = pageCapacity
    }
    current.push(line)
    currentUnits += units
  })

  if (current.length > 0) {
    chunks.push(current)
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
  inspectionSide,
  rootClassName,
}: ReportRendererClientProps) {
  const rootClasses = ['report-root', rootClassName].filter(Boolean).join(' ')
  const isPdfMode = rootClasses.includes('report-root--pdf')

  const [pagePlan, setPagePlan] = useState<{
    pages: PagePlan[]
    sectionPageMap: Map<string, number>
  } | null>(null)
  const [imageSettledVersion, setImageSettledVersion] = useState(0)
  const [paginationImageVersion, setPaginationImageVersion] = useState(-1)

  const measureContainerRef = useRef<HTMLDivElement | null>(null)
  const headerMeasureRef = useRef<HTMLDivElement | null>(null)
  const entryRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const notifyReportImageSettled = useCallback(() => {
    if (!isPdfMode) return
    setImageSettledVersion((version) => version + 1)
  }, [isPdfMode])

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

        if (
          block.type === 'text' &&
          block.source.kind === 'mock' &&
          block.source.path === 'mock.buildingData.text'
        ) {
          const rows = parseBuildingDataLines(resolveText(block.source, mockData))
          rows.forEach((row, rowIndex) => {
            entries.push({
              kind: 'block',
              id: `${section.id}-building-data-row-${blockIndex}-${rowIndex}`,
              sectionId: section.id,
              sectionStartOnNewPage:
                section.startOnNewPage && blockIndex === 0 && rowIndex === 0,
              block: {
                type: 'buildingDataRow',
                label: row.label,
                value: row.value,
                marginTopMm: rowIndex === 0 ? block.marginTopMm : 0,
                marginBottomMm:
                  rowIndex === rows.length - 1 ? block.marginBottomMm : 1.4,
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

              let previousInteriorFloor = ''
              groups.forEach((group, groupIndex) => {
                if (isPdfMode) {
                  const titleParts = splitInspectionGroupTitle(group.title)
                  const roomTitle =
                    section.id === 'notes-interior' && titleParts.context
                      ? titleParts.label
                      : group.title
                  const startsNewInteriorFloor =
                    section.id === 'notes-interior' &&
                    titleParts.context &&
                    titleParts.context !== previousInteriorFloor
                  if (startsNewInteriorFloor) {
                    entries.push({
                      kind: 'block',
                      id: `${section.id}-floor-header-${blockIndex}-${groupIndex}`,
                      sectionId: section.id,
                      sectionStartOnNewPage:
                        section.startOnNewPage && blockIndex === 0 && groupIndex === 0,
                      block: {
                        type: 'inspectionFloorHeader',
                        title: titleParts.context,
                        marginTopMm: groupIndex === 0 ? block.marginTopMm : 2,
                        marginBottomMm: 1.5,
                      },
                    })
                    previousInteriorFloor = titleParts.context
                  }

                  group.items.forEach((item, itemIndex) => {
                    const itemSegments = buildPdfInspectionSegments(item)
                    itemSegments.forEach((segment, segmentIndex) => {
                      const isFirstSegment = segmentIndex === 0
                      const isLastSegment = segmentIndex === itemSegments.length - 1

                      entries.push({
                        kind: 'block',
                        id: `${section.id}-room-group-${blockIndex}-${groupIndex}-${itemIndex}-${segment.segment}-${segmentIndex}`,
                        sectionId: section.id,
                        sectionStartOnNewPage:
                          section.id !== 'notes-interior' &&
                          section.startOnNewPage &&
                          blockIndex === 0 &&
                          groupIndex === 0 &&
                          itemIndex === 0 &&
                          isFirstSegment,
                        block: {
                          type: 'inspectionRoomGroupItemSegment',
                          title: roomTitle,
                          item,
                          segment: segment.segment,
                          photoUrls: segment.photoUrls,
                          photoStartIndex: segment.photoStartIndex,
                          photoTotal: segment.photoTotal,
                          isFirstInGroup: itemIndex === 0 && isFirstSegment,
                          isFirstSegmentInItem: isFirstSegment,
                          suppressTopBorder:
                            Boolean(startsNewInteriorFloor) &&
                            itemIndex === 0 &&
                            isFirstSegment,
                          isLastInGroup:
                            itemIndex === group.items.length - 1 && isLastSegment,
                          marginTopMm:
                            groupIndex === 0 && itemIndex === 0 && isFirstSegment
                              ? block.marginTopMm
                              : 0,
                          marginBottomMm:
                            groupIndex === groups.length - 1 &&
                            itemIndex === group.items.length - 1 &&
                            isLastSegment
                              ? block.marginBottomMm
                              : 0,
                        },
                      })
                    })
                  })
                } else {
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
                }
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
  }, [contentSections, isPdfMode, mockData, sectionSpacingPx])

  const appendices = useMemo(() => {
    const pages: Array<{ section: ResolvedReportSection; rawText: string; showTitle: boolean }> = []
    appendixSections.forEach((section) => {
      const rawText = section.appendixText ?? ''
      const isAppendix1 =
        section.appendixId === 'APPENDIX_1_VILLKOR_SELLER_SBR' ||
        section.appendixId === 'APPENDIX_1_VILLKOR_BUYER_SBR' ||
        section.appendixId === 'APPENDIX_1_VILLKOR_APARTMENT_SBR'
      const isGlossary = section.id === 'appendix-2'
      const isLifespan = section.id === 'appendix-3'
      if (section.appendixText && isAppendix1) {
        const segments = splitAppendixText(rawText)
        let isFirstPage = true
        segments.forEach((segment) => {
          const normalizedLines = normalizeAppendixLines(segment.split(/\r?\n/))
          if (normalizedLines.length === 0) return
          const chunks = chunkAppendixLines(normalizedLines, isFirstPage, 2)
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

  const isApartment = inspectionSide === 'apartment'
  const headerLeft = isApartment
    ? `BRF: ${getMockValue(mockData, 'mock.properties.brf_name') ?? 'saknas'} | LGH: ${getMockValue(mockData, 'mock.properties.apartment_number') ?? 'saknas'}`
    : (getMockValue(mockData, 'mock.properties.cadastral_id') ?? 'saknas')

  const headerContent = (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: '11pt',
        color: '#000000',
      }}
    >
      <div>{headerLeft}</div>
      <div>{getMockValue(mockData, 'mock.inspections.date') ?? 'saknas'}</div>
    </div>
  )

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
    // The page padding already reserves space for the footer. Keep only a small
    // buffer for browser rounding so short trailing rows are not pushed to a new page.
    const safetyMm = isPdfMode ? 8 : 0
    const availableHeight =
      pageHeightPx -
      paddingTopPx -
      paddingBottomPx -
      footerMarkPx -
      headerHeight -
      mmToPxNumber(safetyMm)

    const sectionPageMap = new Map<string, number>()
    const coverCount = coverSection ? 1 : 0

    const hasMeaningfulEntry = (entries: Entry[]) =>
      entries.some((entry) => entry.kind === 'block')

    const heightByEntryId = new Map<string, number>()
    contentEntries.forEach((entry, index) => {
      heightByEntryId.set(
        entry.id,
        entry.kind === 'spacer' ? entry.heightPx : heights[index] ?? 0
      )
    })

    const paginateSectionEntries = (
      entriesSubset: Entry[],
      startPageNumber: number
    ): PagePlan[] => {
      const subsetPages: PagePlan[] = []
      let currentEntries: Entry[] = []
      let currentHeight = 0

      const pushSubsetPage = () => {
        if (currentEntries.length === 0) return
        if (!hasMeaningfulEntry(currentEntries)) {
          currentEntries = []
          currentHeight = 0
          return
        }
        subsetPages.push({
          kind: 'sections',
          entries: currentEntries,
          pageNumber: startPageNumber + subsetPages.length,
        })
        currentEntries = []
        currentHeight = 0
      }

      entriesSubset.forEach((entry) => {
        const height = heightByEntryId.get(entry.id) ?? 0

        if (entry.kind === 'block' && entry.sectionStartOnNewPage && currentEntries.length > 0) {
          pushSubsetPage()
        }

        if (entry.kind === 'spacer' && currentEntries.length === 0) {
          return
        }

        if (currentHeight + height > availableHeight && currentEntries.length > 0) {
          if (entry.kind === 'spacer') {
            pushSubsetPage()
            return
          }
          pushSubsetPage()
        }

        if (entry.kind === 'spacer' && currentEntries.length === 0) {
          return
        }

        currentEntries.push(entry)
        currentHeight += height

        if (entry.kind === 'block' && !sectionPageMap.has(entry.sectionId)) {
          sectionPageMap.set(entry.sectionId, startPageNumber + subsetPages.length)
        }
      })

      pushSubsetPage()
      return subsetPages
    }

    const firstPostAppendixEntryIndex = contentEntries.findIndex(
      (entry) => entry.kind === 'block' && entry.sectionId.startsWith('appendix-')
    )

    const mainSectionEntries =
      firstPostAppendixEntryIndex >= 0
        ? contentEntries.slice(0, firstPostAppendixEntryIndex)
        : contentEntries
    const postAppendixEntries =
      firstPostAppendixEntryIndex >= 0
        ? contentEntries.slice(firstPostAppendixEntryIndex)
        : []

    const pages = paginateSectionEntries(mainSectionEntries, coverCount + 1)

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

    const postAppendixPages = paginateSectionEntries(
      postAppendixEntries,
      coverCount + pages.length + appendixPages.length + 1
    )

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
      pages: [...coverPages, ...pages, ...appendixPages, ...postAppendixPages],
      sectionPageMap,
    })
    setPaginationImageVersion((version) =>
      version === imageSettledVersion ? version : imageSettledVersion
    )
  }, [appendices, contentEntries, coverSection, mockData, isPdfMode, imageSettledVersion])

  const companyLogoValue = getMockValue(mockData, 'mock.company.logo_url')
  const companyLogoUrl = companyLogoValue === 'saknas' ? null : companyLogoValue
  const cadastralId = getMockValue(mockData, 'mock.properties.cadastral_id')
  const brfName = getMockValue(mockData, 'mock.properties.brf_name')
  const apartmentNumber = getMockValue(mockData, 'mock.properties.apartment_number')
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

  const renderPdfLabel = (
    label: string,
    tone: 'default' | 'risk' | 'ftu' | 'photo' = 'default'
  ) => {
    const iconName: ReportIconName =
      tone === 'risk'
        ? 'risk'
        : tone === 'ftu'
          ? 'ftu'
          : tone === 'photo'
            ? 'photo'
            : 'note'
    const color =
      tone === 'risk'
        ? '#b45309'
        : tone === 'ftu'
          ? '#334155'
          : '#475569'

    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: mmToPx(1.2),
          fontSize: '9pt',
          fontWeight: 700,
          color,
          lineHeight: 1.2,
        }}
      >
        <ReportIcon name={iconName} />
        <span>{label}</span>
      </div>
    )
  }

  const formatPdfPhotoLabel = (startIndex: number, count: number) => {
    if (count <= 0) return 'Bilder'
    const start = Math.max(1, startIndex)
    const end = start + count - 1
    return start === end ? `Bilder ${start}` : `Bilder ${start}-${end}`
  }

  const renderInspectionItemContent = (
    item: InspectionBlockItem,
    keyPrefix: string,
    photoVariant: 'compact' | 'wide' = 'compact'
  ) => {
    const noteText = String(item.noteText ?? '').trim()
    const riskText = String(item.riskText ?? '').trim()
    const ftuText = String(item.ftuText ?? '').trim()
    const photoUrls = getInspectionPhotoUrls(item)

    if (isPdfMode) {
      const labelWidth = mmToPx(30)
      const renderPdfRow = (
        label: string,
        body: ReactNode,
        tone: 'default' | 'risk' | 'ftu' = 'default'
      ) => (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `${labelWidth} 1fr`,
            columnGap: mmToPx(3),
            marginTop: mmToPx(1.5),
            alignItems: 'start',
          }}
        >
          {renderPdfLabel(label, tone)}
          <div
            style={{
              fontSize: '10.5pt',
              color: '#111827',
              lineHeight: 1.25,
              whiteSpace: 'pre-line',
            }}
          >
            {body}
          </div>
        </div>
      )

      const renderPdfImageRow = (urls: string[]) => (
        <div
          style={{
            marginTop: mmToPx(1.8),
          }}
        >
          {renderPdfLabel(formatPdfPhotoLabel(1, urls.length), 'photo')}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: mmToPx(3),
              justifyContent: urls.length === 1 ? 'flex-start' : 'center',
              marginTop: mmToPx(2),
              width: '100%',
            }}
          >
            {urls.map((url, urlIndex) => (
              <div
                key={`${keyPrefix}-photo-frame-${urlIndex}`}
                style={{
                  width: mmToPx(PDF_PHOTO_FRAME_WIDTH_MM),
                  height: mmToPx(PDF_PHOTO_FRAME_HEIGHT_MM),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: '#ffffff',
                }}
              >
                <ReportPhoto
                  src={url}
                  alt={`Foto ${urlIndex + 1}`}
                  className="object-contain bg-white"
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                  }}
                  maxLongSidePx={PHOTO_POLICY.pdfMaxLongSidePx}
                  quality={PHOTO_POLICY.pdfQuality}
                  onSettled={notifyReportImageSettled}
                />
              </div>
            ))}
          </div>
        </div>
      )

      return (
        <>
          {renderPdfRow('Notering', noteText || '--')}

          {riskText.length > 0
            ? renderPdfRow('Riskanalys', riskText, 'risk')
            : null}

          {ftuText.length > 0
            ? renderPdfRow('FTU', ftuText, 'ftu')
            : null}

          {photoUrls.length > 0 ? renderPdfImageRow(photoUrls) : null}
        </>
      )
    }

    return (
      <>
        <section className="ob-section ob-section--note">
          <div className="ob-section__head grid grid-cols-[auto_auto_1fr] items-baseline gap-x-2">
            <span className="ob-icon ob-icon--note self-start mt-[3px]" aria-hidden="true">
              <ReportIcon name="note" />
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
                <ReportIcon name="photo" />
                <span>Bilder</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {photoVariant === 'wide'
                  ? photoUrls.map((url, urlIndex) => (
                      <ReportPhoto
                        key={`${keyPrefix}-photo-${urlIndex}`}
                        src={url}
                        alt={`Foto ${urlIndex + 1}`}
                        className={
                          isPdfMode
                            ? 'h-auto object-contain bg-white'
                            : 'h-auto rounded border border-gray-200 object-contain bg-white'
                        }
                        style={{ width: '60mm' }}
                        onSettled={notifyReportImageSettled}
                      />
                    ))
                  : photoUrls.map((url, urlIndex) => (
                      <div
                        key={`${keyPrefix}-photo-${urlIndex}`}
                        className={
                          isPdfMode
                            ? 'h-24 w-32 bg-white overflow-hidden flex items-center justify-center'
                            : 'h-24 w-32 rounded-md border border-gray-200 bg-white overflow-hidden flex items-center justify-center'
                        }
                      >
                        <ReportPhoto
                          src={url}
                          alt={`Foto ${urlIndex + 1}`}
                          className="max-h-full max-w-full object-contain"
                          style={{ width: '100%', height: '100%' }}
                          onSettled={notifyReportImageSettled}
                        />
                      </div>
                    ))}
              </div>
            </div>
          )}
        </section>

        {riskText.length > 0 && (
          <div
            className={
              isPdfMode
                ? 'mt-3 border-l-2 border-amber-500 bg-white py-1 pl-3'
                : 'mt-4 rounded-md border border-gray-200 bg-white p-3'
            }
          >
            <div className="flex items-center gap-2 text-xs font-semibold text-gray-700">
              <span className="ob-icon ob-icon--risk" aria-hidden="true">
                <ReportIcon name="risk" />
              </span>
              <span>Riskanalys</span>
            </div>
            <div className="text-sm text-gray-800 whitespace-pre-line">
              {riskText}
            </div>
          </div>
        )}

        {ftuText.length > 0 && (
          <div
            className={
              isPdfMode
                ? 'mt-3 border-l-2 border-slate-400 bg-white py-1 pl-3'
                : 'mt-4 rounded-md border border-gray-200 bg-white p-3'
            }
          >
            <div className="flex items-center gap-2 text-xs font-semibold text-gray-700">
              <span className="ob-icon ob-icon--ftu" aria-hidden="true">
                <ReportIcon name="ftu" />
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

  const renderPdfInspectionSegmentContent = (
    block: InspectionRoomGroupItemSegmentEntry,
    keyPrefix: string
  ) => {
    const labelWidth = mmToPx(30)
    const noteText = String(block.item.noteText ?? '').trim()
    const riskText = String(block.item.riskText ?? '').trim()
    const ftuText = String(block.item.ftuText ?? '').trim()

    const renderPdfRow = (
      label: string,
      body: ReactNode,
      tone: 'default' | 'risk' | 'ftu' = 'default'
    ) => (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `${labelWidth} 1fr`,
          columnGap: mmToPx(3),
          marginTop: mmToPx(1.5),
          alignItems: 'start',
        }}
      >
        {renderPdfLabel(label, tone)}
        <div
          style={{
            fontSize: '10.5pt',
            color: '#111827',
            lineHeight: 1.25,
            whiteSpace: 'pre-line',
          }}
        >
          {body}
        </div>
      </div>
    )

    const renderPdfImageRow = (urls: string[]) => (
      <div
        style={{
          marginTop: mmToPx(1.8),
        }}
      >
        {renderPdfLabel(
          formatPdfPhotoLabel(block.photoStartIndex, urls.length),
          'photo'
        )}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: mmToPx(3),
            justifyContent: urls.length === 1 ? 'flex-start' : 'center',
            marginTop: mmToPx(2),
            width: '100%',
          }}
        >
          {urls.map((url, urlIndex) => (
            <div
              key={`${keyPrefix}-photo-frame-${urlIndex}`}
              style={{
                width: mmToPx(PDF_PHOTO_FRAME_WIDTH_MM),
                height: mmToPx(PDF_PHOTO_FRAME_HEIGHT_MM),
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#ffffff',
              }}
            >
              <ReportPhoto
                src={url}
                alt={`Foto ${urlIndex + 1}`}
                className="object-contain bg-white"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                }}
                maxLongSidePx={PHOTO_POLICY.pdfMaxLongSidePx}
                quality={PHOTO_POLICY.pdfQuality}
                onSettled={notifyReportImageSettled}
              />
            </div>
          ))}
        </div>
      </div>
    )

    if (block.segment === 'photos') {
      if (block.photoUrls.length === 0) return null
      return renderPdfImageRow(block.photoUrls)
    }

    if (block.segment === 'risk') {
      return riskText.length > 0
        ? renderPdfRow('Riskanalys', riskText, 'risk')
        : null
    }

    if (block.segment === 'ftu') {
      return ftuText.length > 0 ? renderPdfRow('FTU', ftuText, 'ftu') : null
    }

    return renderPdfRow('Notering', noteText || '--')
  }

  const renderPdfInspectionSegment = (
    block: InspectionRoomGroupItemSegmentEntry,
    key: string
  ) => {
    const rowTitle = block.title.trim()
    const content = renderPdfInspectionSegmentContent(block, key)
    if (!content) return null
    const topBorder =
      block.isFirstSegmentInItem && !block.suppressTopBorder
        ? block.isFirstInGroup
          ? `${mmToPx(0.35)} solid #94a3b8`
          : '1px solid #d1d9e6'
        : 'none'

    return (
      <article
        key={key}
        className="ob-block bg-white"
        style={blockMargins({
          marginTopMm: block.marginTopMm,
          marginBottomMm: block.marginBottomMm,
        } as ReportBlock)}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `${mmToPx(46)} 1fr`,
            columnGap: mmToPx(4),
          }}
        >
          <div
            style={{
              borderTop: topBorder,
              fontSize: '10.5pt',
              fontWeight: 700,
              color: '#111827',
              lineHeight: 1.2,
              paddingTop: mmToPx(2.5),
              paddingBottom: mmToPx(2.5),
              paddingRight: mmToPx(2),
              wordBreak: 'break-word',
            }}
          >
            {block.isFirstInGroup ? rowTitle : null}
          </div>
          <div
            style={{
              borderTop: topBorder,
              paddingTop: mmToPx(2.5),
              paddingBottom: mmToPx(2.5),
            }}
          >
            {content}
          </div>
        </div>
      </article>
    )
  }

  const renderPdfInspectionRow = (
    item: InspectionBlockItem,
    key: string,
    title: string,
    marginTopMm: number,
    marginBottomMm: number,
    showTitle = true
  ) => {
    const rowTitle = title.trim()
    return (
      <article
        key={key}
        className="ob-block bg-white"
        style={blockMargins({ marginTopMm, marginBottomMm } as ReportBlock)}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `${mmToPx(46)} 1fr`,
            columnGap: mmToPx(4),
          }}
        >
          <div
            style={{
              borderTop: showTitle ? '1px solid #cbd5e1' : 'none',
              fontSize: '10.5pt',
              fontWeight: 700,
              color: '#111827',
              lineHeight: 1.2,
              paddingTop: mmToPx(2.5),
              paddingBottom: mmToPx(2.5),
              paddingRight: mmToPx(2),
              wordBreak: 'break-word',
            }}
          >
            {showTitle ? rowTitle : null}
          </div>
          <div
            style={{
              borderTop: '1px solid #cbd5e1',
              paddingTop: mmToPx(2.5),
              paddingBottom: mmToPx(2.5),
            }}
          >
            {renderInspectionItemContent(item, key, 'wide')}
          </div>
        </div>
      </article>
    )
  }

  const renderInspectionBlockItem = (
    item: InspectionBlockItem,
    key: string,
    marginTopMm: number,
    marginBottomMm: number
  ) => {
    const title = String(item.title ?? '')
    if (isPdfMode) {
      return renderPdfInspectionRow(item, key, title, marginTopMm, marginBottomMm)
    }
    return (
      <article
        key={key}
        className={
          isPdfMode
            ? 'ob-block bg-white pb-4 mb-5 border-b border-slate-200'
            : 'ob-block border border-gray-200 rounded-lg p-4 mb-6 bg-white'
        }
        style={blockMargins({ marginTopMm, marginBottomMm } as ReportBlock)}
      >
        <header className={isPdfMode ? 'ob-block__header mb-2' : 'ob-block__header mb-3'}>
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
    if (block.type === 'inspectionFloorHeader') {
      return (
        <div
          key={`${sectionId}-floor-header-${index}`}
          style={{
            ...blockMargins(block),
            backgroundColor: '#eaf2fb',
            color: '#111827',
            fontSize: '12pt',
            fontWeight: 700,
            lineHeight: 1.2,
            padding: `${mmToPx(2.2)} ${mmToPx(3)}`,
          }}
        >
          {block.title}
        </div>
      )
    }

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
              <ReportIcon name="risk" />
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
              <ReportIcon name="ftu" />
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
      const notesScope =
        sectionId === 'notes'
          ? 'Byggnad - utsida'
          : sectionId === 'notes-interior'
            ? inspectionSide === 'apartment'
              ? 'Lägenhet - insida'
              : 'Byggnad - insida'
            : null
      if (
        notesScope &&
        block.level === 3 &&
        String(block.text).trim() === notesScope
      ) {
        return null
      }
      const preset =
        block.level === 1
          ? REPORT_STYLES.H1
          : block.level === 2
            ? REPORT_STYLES.H2
            : REPORT_STYLES.H3
      const fontSize = block.fontSizePt ? `${block.fontSizePt}pt` : preset.fontSize
      const headingText =
        notesScope && block.level === 2 && String(block.text).trim() === 'Noteringar'
          ? `Noteringar - ${notesScope}`
          : block.text
      const isNotesMainHeading =
        notesScope && block.level === 2 && String(block.text).trim() === 'Noteringar'
      return (
        <div
          key={`${sectionId}-heading-${index}`}
          className="report-heading"
          style={{
            ...blockMargins(block),
            ...(isNotesMainHeading
              ? {
                  backgroundColor: ACCENT_COLOR,
                  color: '#ffffff',
                  padding: `${mmToPx(2)} ${mmToPx(3)}`,
                }
              : {}),
            fontSize,
            fontWeight: preset.fontWeight,
            color: isNotesMainHeading
              ? '#ffffff'
              : block.accent
                ? ACCENT_COLOR
                : preset.color,
            textTransform: block.level === 1 ? 'uppercase' : 'none',
          textAlign: block.align ?? 'left',
          }}
        >
          {headingText}
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
                <span>{pageNumber ?? '–'}</span>
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
            if (isPdfMode) {
              return renderPdfInspectionRow(
                item,
                `${sectionId}-inspection-${index}-${itemIndex}`,
                String(item.title ?? ''),
                0,
                0
              )
            }
            return (
              <article
                key={`${sectionId}-inspection-${index}-${itemIndex}`}
                className={
                  isPdfMode
                    ? 'ob-block bg-white pb-4 mb-5 border-b border-slate-200'
                    : 'ob-block border border-gray-200 rounded-lg p-4 mb-6 bg-white'
                }
              >
                <header className={isPdfMode ? 'ob-block__header mb-2' : 'ob-block__header mb-3'}>
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

    if (block.type === 'inspectionRoomGroupItem') {
      const title = String(block.title ?? '')
      return renderPdfInspectionRow(
        block.item,
        `${sectionId}-room-group-item-${index}`,
        title,
        block.marginTopMm,
        block.marginBottomMm,
        block.isFirstInGroup
      )
    }

    if (block.type === 'inspectionRoomGroupItemSegment') {
      return renderPdfInspectionSegment(
        block,
        `${sectionId}-room-group-item-segment-${index}`
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

    if (block.type === 'table') {
      const rows = getMockArray<Record<string, unknown>>(mockData, block.rowsPath)
      const configuredWidth = block.columns.reduce(
        (sum, column) => sum + (column.widthPercent ?? 0),
        0
      )
      const unspecifiedCount = block.columns.filter(
        (column) => column.widthPercent === undefined
      ).length
      const fallbackWidth =
        unspecifiedCount > 0
          ? Math.max(0, 100 - configuredWidth) / unspecifiedCount
          : 0

      const formatCellValue = (value: unknown) => {
        if (value === null || value === undefined) return '--'
        const text = String(value).trim()
        return text.length > 0 ? text : '--'
      }

      return (
        <div
          key={`${sectionId}-table-${index}`}
          style={blockMargins(block)}
        >
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              tableLayout: 'fixed',
              fontSize: REPORT_STYLES.BODY.fontSize,
              color: REPORT_STYLES.BODY.color,
            }}
          >
            <thead>
              <tr>
                {block.columns.map((column, columnIndex) => (
                  <th
                    key={`${sectionId}-table-head-${index}-${columnIndex}`}
                    style={{
                      textAlign: column.align ?? 'left',
                      fontWeight: 700,
                      borderBottom: '1px solid #334155',
                      padding: `${mmToPx(1)}px ${mmToPx(1.5)}px`,
                      width: `${column.widthPercent ?? fallbackWidth}%`,
                    }}
                  >
                    {column.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length > 0 ? (
                rows.map((row, rowIndex) => (
                  <tr key={`${sectionId}-table-row-${index}-${rowIndex}`}>
                    {block.columns.map((column, columnIndex) => {
                      const text = formatCellValue(row[column.key])
                      return (
                        <td
                          key={`${sectionId}-table-cell-${index}-${rowIndex}-${columnIndex}`}
                          style={{
                            textAlign: column.align ?? 'left',
                            verticalAlign: 'top',
                            borderBottom: '1px solid #cbd5e1',
                            padding: `${mmToPx(1)}px ${mmToPx(1.5)}px`,
                            whiteSpace: 'pre-wrap',
                          }}
                        >
                          {text
                            .split(/\r?\n/)
                            .map((line, lineIndex) => (
                              <div
                                key={`${sectionId}-table-line-${index}-${rowIndex}-${columnIndex}-${lineIndex}`}
                              >
                                {line || '\u00A0'}
                              </div>
                            ))}
                        </td>
                      )
                    })}
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={block.columns.length}
                    style={{
                      textAlign: 'left',
                      padding: `${mmToPx(1.5)}px`,
                      color: '#475569',
                    }}
                  >
                    {block.emptyPlaceholder ?? '--'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
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
        {
          text: acquisitionText,
          marginBottomMm: renovations.length > 0 ? 3 : 0,
        },
        ...(renovations.length > 0
          ? [
              {
                text: block.renovationsLabel,
                marginBottomMm: 1.5,
              },
            ]
          : []),
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

    if (block.type === 'buildingDataRow') {
      return (
        <div
          key={`${sectionId}-building-data-row-${index}`}
          style={{
            ...blockMargins(block),
            display: 'grid',
            gridTemplateColumns: `${mmToPx(50)} 1fr`,
            columnGap: mmToPx(4),
            rowGap: mmToPx(4),
            fontSize: REPORT_STYLES.BODY.fontSize,
            color: REPORT_STYLES.BODY.color,
            lineHeight: 1.15,
          }}
        >
          <div style={{ fontWeight: 400 }}>{block.label}</div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{block.value}</div>
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
        'Särskilda förutsättningar vid besiktningen:',
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
                line.includes('vid besiktningstillfället')
              ) {
                renderedLine = line.replace('fullt möblerad', furnishingText)
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
      if ((sectionId === 'notes' || sectionId === 'notes-interior') && !block.label && block.heightMm <= 2) {
        return null
      }
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
    <div
      className={rootClasses}
      data-report-pagination-ready={
        pagePlan && paginationImageVersion === imageSettledVersion ? '1' : '0'
      }
      data-report-image-version={imageSettledVersion}
      data-report-pagination-image-version={paginationImageVersion}
      style={{ backgroundColor: '#f1f5f9', padding: mmToPx(6) }}
    >
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
                inspectionSide={inspectionSide}
                cadastralId={cadastralId}
                brfName={brfName}
                apartmentNumber={apartmentNumber}
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




