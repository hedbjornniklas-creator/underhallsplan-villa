'use client'

import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import AppendixPage from '@/components/report/AppendixPage'
import ReportCoverPage from '@/components/report/ReportCoverPage'
import ReportPage from '@/components/report/ReportPage'
import type { ReportBlock, ReportSection, TextSource } from '@/lib/report/reportSpec'
import {
  ACCENT_COLOR,
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

type Entry =
  | {
      kind: 'block'
      id: string
      sectionId: string
      sectionStartOnNewPage: boolean
      block: ReportBlock
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

function blockMargins(block: ReportBlock) {
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
  'Besiktningen omfattar inte',
  'Besiktningsmannens ansvar',
  'Äganderätt och nyttjanderätt till besiktningsutlåtandet',
  'Ã„ganderÃ¤tt och nyttjanderÃ¤tt till besiktningsutlÃ¥tandet',
]

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

  return segments.map((segment) => segment.join('\n'))
}

export default function ReportRendererClient({
  spec,
  mockData,
  coverNotice,
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
        entries.push({
          kind: 'block',
          id: `${section.id}-block-${blockIndex}`,
          sectionId: section.id,
          sectionStartOnNewPage: section.startOnNewPage && blockIndex === 0,
          block,
        })
      })

      if (sectionIndex < contentSections.length - 1) {
        entries.push({
          kind: 'spacer',
          id: `${section.id}-spacer`,
          heightPx: sectionSpacingPx,
        })
      }
    })
    return entries
  }, [contentSections, sectionSpacingPx])

  const appendices = useMemo(() => {
    const pages: Array<{ section: ResolvedReportSection; rawText: string; showTitle: boolean }> = []
    appendixSections.forEach((section) => {
      const rawText = section.appendixText ?? ''
      if (section.appendixText && section.appendixId === 'APPENDIX_1_VILLKOR_SELLER_SBR_2024') {
        const segments = splitAppendixText(rawText)
        segments.forEach((segment, index) => {
          pages.push({ section, rawText: segment, showTitle: index === 0 })
        })
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
    const availableHeight = pageHeightPx - paddingTopPx - paddingBottomPx - footerMarkPx - headerHeight

    const pages: PagePlan[] = []
    const sectionPageMap = new Map<string, number>()
    const coverCount = coverSection ? 1 : 0

    let currentEntries: Entry[] = []
    let currentHeight = 0

    const pushPage = () => {
      if (currentEntries.length === 0) return
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
  }, [appendices, contentEntries, coverSection, mockData])

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

  const renderBlock = (
    block: ReportBlock,
    sectionId: string,
    index: number,
    sectionPageMap: Map<string, number>
  ) => {
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
            const title = String(item.title ?? '')
            const noteText = String(item.noteText ?? '').trim()
            const riskText = String(item.riskText ?? '').trim()
            const ftuText = String(item.ftuText ?? '').trim()
            const photoUrls = Array.isArray(item.photoUrls)
              ? item.photoUrls.filter((url) => typeof url === 'string')
              : []

            return (
              <article
                key={`${sectionId}-inspection-${index}-${itemIndex}`}
                className="ob-block border border-gray-200 rounded-lg p-4 mb-6 bg-white"
              >
                <header className="ob-block__header mb-3">
                  <h4 className="ob-block__title text-[15px] font-semibold text-gray-900">
                    {title}
                  </h4>
                </header>

                <section className="ob-section ob-section--note">
                  <div className="ob-section__head flex items-center gap-2">
                    <span className="ob-icon ob-icon--note" aria-hidden="true">
                      🧱
                    </span>
                    <span className="ob-section__label text-xs font-bold tracking-wide uppercase text-gray-900">
                      Notering
                    </span>
                  </div>
                  <p className="ob-section__text text-sm leading-relaxed mt-1 text-gray-900 whitespace-pre-line">
                    {noteText || '--'}
                  </p>
                  {photoUrls.length > 0 && (
                    <div className="mt-2 space-y-2">
                      <div className="flex items-center gap-1.5 text-xs text-gray-700">
                        <span aria-hidden="true">📷</span>
                        <span>Bilder</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {photoUrls.map((url, urlIndex) => (
                          <img
                            key={`${sectionId}-inspection-${index}-${itemIndex}-${urlIndex}`}
                            src={url}
                            alt={`Foto ${urlIndex + 1}`}
                            className="h-auto rounded border border-gray-200"
                            style={{ width: '60mm' }}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </section>

                {riskText.length > 0 && (
                  <>
                    <hr className="ob-divider my-4 border-gray-200" />
                    <section className="ob-section ob-section--risk">
                      <div className="ob-section__head flex items-center gap-2">
                        <span className="ob-icon ob-icon--risk" aria-hidden="true">
                          ⚠️
                        </span>
                        <span className="ob-section__label text-xs font-bold tracking-wide uppercase text-gray-900">
                          Riskanalys
                        </span>
                      </div>
                      <p className="ob-section__text text-sm leading-relaxed mt-1 text-gray-900 whitespace-pre-line">
                        {riskText}
                      </p>
                    </section>
                  </>
                )}

                {ftuText.length > 0 && (
                  <>
                    <hr className="ob-divider my-4 border-gray-200" />
                    <section className="ob-section ob-section--ftu">
                      <div className="ob-section__head flex items-center gap-2">
                        <span className="ob-icon ob-icon--ftu" aria-hidden="true">
                          🔍
                        </span>
                        <span className="ob-section__label text-xs font-bold tracking-wide uppercase text-gray-900">
                          Fortsatt teknisk utredning
                        </span>
                      </div>
                      <p className="ob-section__text text-sm leading-relaxed mt-1 text-gray-900 whitespace-pre-line">
                        {ftuText}
                      </p>
                    </section>
                  </>
                )}
              </article>
            )
          })}
        </div>
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
    <div className="report-root" style={{ backgroundColor: '#f1f5f9', padding: mmToPx(6) }}>
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
