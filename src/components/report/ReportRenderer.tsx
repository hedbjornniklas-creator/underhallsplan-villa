import { loadStandardText } from '@/content/standardtexts/loadStandardText'
import { loadAppendixText } from '@/lib/report/loadAppendixText'
import type { ReportBlock, ReportSection, TextSource } from '@/lib/report/reportSpec'
import AppendixPage from '@/components/report/AppendixPage'
import ReportCoverPage from '@/components/report/ReportCoverPage'
import ReportPage from '@/components/report/ReportPage'
import { ACCENT_COLOR, REPORT_STYLES, mmToPx } from '@/lib/report/reportTokens'

type ReportRendererProps = {
  spec: ReportSection[]
  mockData: Record<string, unknown>
}

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
  if (source.kind === 'standardText') return loadStandardText(source.id)
  return getMockValue(mockData, source.path)
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

export default function ReportRenderer({ spec, mockData }: ReportRendererProps) {
  const pages: ReportSection[][] = []
  let current: ReportSection[] = []

  spec.forEach((section) => {
    if (section.startOnNewPage || current.length === 0) {
      if (current.length) pages.push(current)
      current = [section]
    } else {
      current.push(section)
    }
  })

  if (current.length) pages.push(current)

  const renderPages: Array<
    | { kind: 'sections'; sections: ReportSection[] }
    | { kind: 'appendix'; section: ReportSection; rawText: string; showTitle: boolean }
  > = []

  const appendxBreakHeadings = [
    'Besiktningen omfattar inte',
    'Besiktningsmannens ansvar',
    'Äganderätt och nyttjanderätt till besiktningsutlåtandet',
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

  pages.forEach((sections) => {
    if (sections.length === 1 && sections[0].type === 'appendix') {
      const section = sections[0]
      const rawText = section.appendixId ? loadAppendixText(section.appendixId) : ''
      if (section.appendixId === 'APPENDIX_1_VILLKOR_SELLER_SBR_2024') {
        const segments = splitAppendixText(rawText)
        segments.forEach((segment, index) => {
          renderPages.push({
            kind: 'appendix',
            section,
            rawText: segment,
            showTitle: index === 0,
          })
        })
      } else {
        renderPages.push({
          kind: 'appendix',
          section,
          rawText,
          showTitle: true,
        })
      }
    } else {
      renderPages.push({ kind: 'sections', sections })
    }
  })

  const sectionPageMap = new Map<string, number>()
  renderPages.forEach((page, pageIndex) => {
    if (page.kind === 'sections') {
      page.sections.forEach((section) => {
        if (!sectionPageMap.has(section.id)) {
          sectionPageMap.set(section.id, pageIndex + 1)
        }
      })
    } else if (!sectionPageMap.has(page.section.id)) {
      sectionPageMap.set(page.section.id, pageIndex + 1)
    }
  })

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

  return (
    <div style={{ backgroundColor: '#f1f5f9', padding: mmToPx(6) }}>
      {renderPages.map((page, pageIndex) => {
        const hasCover =
          page.kind === 'sections' &&
          page.sections.some((section) => section.type === 'cover')
        const headerContent = !hasCover ? (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '11pt',
              color: '#000000',
            }}
          >
            <div>{cadastralId ?? 'saknas'}</div>
            <div>{inspectionDate ?? 'saknas'}</div>
          </div>
        ) : undefined
        const pageFooterLeftLines = hasCover ? footerLeftLines : []
        const pageFooterRightLines = hasCover ? footerRightLines : []

        return (
          <ReportPage
            key={`page-${pageIndex}`}
            pageNumber={pageIndex + 1}
            footerLeftLines={pageFooterLeftLines}
            footerRightLines={pageFooterRightLines}
            footerCenterLines={footerCenterLines}
            header={headerContent}
          >
            {page.kind === 'appendix' ? (
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
            ) : hasCover ? (
              <ReportCoverPage
                companyLogoUrl={companyLogoUrl}
                cadastralId={cadastralId}
                address={address}
                inspectionDate={inspectionDate}
                assignmentNumber={assignmentNumber}
                coverIllustrationUrl={coverIllustrationUrl}
              />
            ) : (
              page.sections.map((section) => (
                <section key={section.id} style={{ marginBottom: mmToPx(6) }}>
                  {section.blocks.map((block, index) => {
                    if (block.type === 'heading') {
                      const preset =
                        block.level === 1
                          ? REPORT_STYLES.H1
                            : block.level === 2
                              ? REPORT_STYLES.H2
                              : REPORT_STYLES.H3
                        const fontSize = block.fontSizePt
                          ? `${block.fontSizePt}pt`
                          : preset.fontSize
                        return (
                          <div
                            key={`${section.id}-heading-${index}`}
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
                            key={`${section.id}-toc-${index}`}
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
                                  key={`${section.id}-toc-${entryIndex}`}
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
                            key={`${section.id}-list-${index}`}
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
                              <div key={`${section.id}-list-${index}-${rowIndex}`}>{item}</div>
                            ))}
                          </div>
                        )
                      }

                      if (block.type === 'twoColumn') {
                        const labelWidth = block.labelWidthMm ?? 65
                        const rowGap = block.rowGapMm ?? 2
                        return (
                          <div
                            key={`${section.id}-table-${index}`}
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
                              const values = Array.isArray(row.value)
                                ? row.value
                                : [row.value]
                              return [
                                <div
                                  key={`${section.id}-label-${rowIndex}`}
                                  style={{ fontWeight: 400 }}
                                >
                                  {row.label}
                                </div>,
                                <div key={`${section.id}-value-${rowIndex}`}>
                                  {values.map((valueSource, valueIndex) => (
                                    <div key={`${section.id}-line-${rowIndex}-${valueIndex}`}>
                                      {String(resolveText(valueSource, mockData))
                                        .split(/\r?\n/)
                                        .map((line, lineIndex) => (
                                          <div
                                            key={`${section.id}-line-${rowIndex}-${valueIndex}-${lineIndex}`}
                                          >
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
                          block.source.kind === 'standardText' &&
                          block.source.id === 'STD_VISUAL_INSPECTION_PREFACE'
                        const boldHeadings = new Set([
                          'Särskilda förutsättningar vid besiktningen:',
                          'Muntliga uppgifter:',
                        ])
                        if (isBuildingData) {
                          const rows = parseBuildingDataLines(String(content))
                          return (
                            <div
                              key={`${section.id}-text-${index}`}
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
                                <div
                                  key={`${section.id}-building-label-${rowIndex}`}
                                  style={{ fontWeight: 400 }}
                                >
                                  {row.label}
                                </div>,
                                <div
                                  key={`${section.id}-building-value-${rowIndex}`}
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
                            furnishingLevel && furnishingLevel !== 'saknas'
                              ? furnishingLevel
                              : null
                          const lines = String(content).split(/\r?\n/)
                          return (
                            <div
                              key={`${section.id}-text-${index}`}
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
                                  renderedLine = line.replace(
                                    'fullt möblerad',
                                    furnishingText
                                  )
                                }
                                const trimmed = renderedLine.trim()
                                const isBold = boldHeadings.has(trimmed)
                                return (
                                  <div
                                    key={`${section.id}-text-${index}-${lineIndex}`}
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
                            key={`${section.id}-text-${index}`}
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
                            key={`${section.id}-field-${index}`}
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
                              key={`${section.id}-image-${index}`}
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
                            key={`${section.id}-image-${index}`}
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
                            key={`${section.id}-page-${index}`}
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
                    })}
                </section>
              ))
            )}
          </ReportPage>
        )
      })}
    </div>
  )
}

