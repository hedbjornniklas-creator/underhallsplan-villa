import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from '@react-pdf/renderer'
import { loadStandardText } from '@/content/standardtexts/loadStandardText'
import { loadAppendixText } from '@/lib/report/loadAppendixText'
import {
  parseInspectionDocumentReportLine,
  type InspectionDocumentReportLineParts,
} from '@/lib/report/inspectionDocumentReportLine'
import type { ReportBlock, ReportSection, TextSource } from '@/lib/report/reportSpec'
import type { ReportDataV2 } from '@/lib/report/pdfV2/buildReportDataV2'

type InspectionBlock = {
  title: string
  noteText: string
  riskText: string
  ftuText: string
  photoUrls: string[]
  hasDeviations: boolean
}

type ReportPdfDocumentV2Props = {
  spec: ReportSection[]
  data: ReportDataV2
  imageMap?: Record<string, string>
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 56,
    paddingBottom: 56,
    paddingHorizontal: 36,
    fontFamily: 'Helvetica',
    fontSize: 10,
    color: '#0f172a',
    lineHeight: 1.35,
  },
  header: {
    position: 'absolute',
    top: 24,
    left: 36,
    right: 36,
    fontSize: 9,
    color: '#475569',
  },
  footer: {
    position: 'absolute',
    bottom: 22,
    left: 36,
    right: 36,
    fontSize: 9,
    color: '#475569',
  },
  heading1: {
    fontSize: 16,
    fontWeight: 700,
    marginBottom: 8,
  },
  heading2: {
    fontSize: 13,
    fontWeight: 700,
    marginBottom: 6,
  },
  heading3: {
    fontSize: 11,
    fontWeight: 600,
    marginBottom: 4,
  },
  text: {
    marginBottom: 6,
  },
  block: {
    borderWidth: 1,
    borderColor: '#cbd5f5',
    borderRadius: 6,
    padding: 8,
    marginBottom: 8,
  },
  blockTitle: {
    fontSize: 10.5,
    fontWeight: 700,
    marginBottom: 4,
  },
  blockNote: {
    marginBottom: 4,
  },
  blockLabel: {
    fontWeight: 700,
  },
  blockRisk: {
    marginBottom: 4,
  },
  blockFtu: {
    marginBottom: 4,
  },
  boxedText: {
    padding: 8,
  },
  listItem: {
    marginBottom: 2,
  },
  row: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  rowLabel: {
    width: '40%',
    fontWeight: 600,
  },
  rowValue: {
    width: '60%',
  },
  table: {
    marginBottom: 8,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#cbd5e1',
  },
  tableHeaderRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  tableHeaderCell: {
    fontWeight: 700,
    paddingVertical: 3,
    paddingHorizontal: 4,
  },
  tableCell: {
    paddingVertical: 3,
    paddingHorizontal: 4,
  },
  tablePlaceholder: {
    color: '#475569',
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  image: {
    width: 220,
    height: 140,
    objectFit: 'contain',
  },
  imageWrap: {
    marginTop: 6,
  },
})

const repairMojibake = (value: string) =>
  String(value ?? '')
    .replace(/\u00c3\u0192\u00c2\u00a4/g, '\u00e4')
    .replace(/\u00c3\u0192\u00c2\u00a5/g, '\u00e5')
    .replace(/\u00c3\u0192\u00c2\u00b6/g, '\u00f6')
    .replace(/\u00c3\u0192\u00e2\u20ac\u017e/g, '\u00c4')
    .replace(/\u00c3\u0192\u00e2\u20ac\u00a6/g, '\u00c5')
    .replace(/\u00c3\u0192\u00e2\u20ac\u201c/g, '\u00d6')
    .replace(/\u00c3\u0192\u00c2\u00a9/g, '\u00e9')
    .replace(/\u00c3\u0192\u00e2\u20ac\u00b0/g, '\u00c9')
    .replace(/\u00c3\u00a4/g, '\u00e4')
    .replace(/\u00c3\u00a5/g, '\u00e5')
    .replace(/\u00c3\u00b6/g, '\u00f6')
    .replace(/\u00c3\u201e/g, '\u00c4')
    .replace(/\u00c3\u2026/g, '\u00c5')
    .replace(/\u00c3\u2013/g, '\u00d6')
    .replace(/\u00c3\u00a9/g, '\u00e9')
    .replace(/\u00c3\u2030/g, '\u00c9')

const getValueAtPath = (obj: unknown, path: string) =>
  path.split('.').reduce<unknown>((acc, key) => {
    if (!acc || typeof acc !== 'object') return undefined
    return (acc as Record<string, unknown>)[key]
  }, obj)

const getListAtPath = (obj: unknown, path: string): string[] => {
  const value = getValueAtPath(obj, path)
  if (Array.isArray(value)) {
    return value.map((item) => (item == null ? '' : repairMojibake(String(item)))).filter(Boolean)
  }
  if (typeof value === 'string') {
    return value
      .split('\n')
      .map((line) => repairMojibake(line).trim())
      .filter(Boolean)
  }
  return []
}

const isInspectionDocumentReportLineParts = (
  value: unknown
): value is InspectionDocumentReportLineParts => {
  if (!value || typeof value !== 'object') return false
  const row = value as Partial<InspectionDocumentReportLineParts>
  return typeof row.title === 'string' && typeof row.statusText === 'string'
}

const getInspectionDocumentRows = (obj: unknown) => {
  const structuredRows = getValueAtPath(obj, 'mock.documents.provided_rows')
  if (Array.isArray(structuredRows)) {
    const rows = structuredRows
      .filter(isInspectionDocumentReportLineParts)
      .map((row) => ({
        ...row,
        title: repairMojibake(row.title),
        statusText: repairMojibake(row.statusText),
        note: repairMojibake(row.note ?? ''),
        text: repairMojibake(row.text ?? ''),
      }))
    if (rows.length > 0) return rows
  }

  return getListAtPath(obj, 'mock.documents.provided').map((line) =>
    parseInspectionDocumentReportLine(line)
  )
}

const renderDocumentRowsPdf = (rows: InspectionDocumentReportLineParts[]) => {
  const normalizedRows = rows.length > 0 ? rows : [parseInspectionDocumentReportLine('--')]

  return normalizedRows.map((row, index) => {
    const statusText = [row.statusText, row.note ? `. ${row.note}` : '']
      .filter(Boolean)
      .join('')

    if (!row.statusText) {
      return (
        <Text key={`document-row-${index}`} style={{ marginBottom: 2 }}>
          {row.title || '\u00A0'}
        </Text>
      )
    }

    return (
      <View key={`document-row-${index}`} style={{ flexDirection: 'row', marginBottom: 2 }} wrap={false}>
        <Text style={{ width: '48%', paddingRight: 6 }}>{row.title}</Text>
        <Text style={{ width: '4%', textAlign: 'center' }}>-</Text>
        <Text style={{ width: '48%', paddingLeft: 6 }}>{statusText}</Text>
      </View>
    )
  })
}

const HANDLINGAR_PDF_CHUNK_MAX_LINES = 10
const HANDLINGAR_PDF_APPROX_CHARS_PER_LINE = 74

function estimateHandlingarPdfLineCount(text: string) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  return Math.max(
    1,
    lines.reduce((sum, line) => {
      const length = line.trim().length
      return sum + Math.max(1, Math.ceil(length / HANDLINGAR_PDF_APPROX_CHARS_PER_LINE))
    }, 0)
  )
}

function splitHandlingarTextForPdf(text: string) {
  const normalized = repairMojibake(String(text ?? '')).replace(/\r\n/g, '\n').trim()
  if (!normalized) return ['']

  const chunks: string[] = []
  let current: string[] = []
  let currentLines = 0

  const pushCurrent = () => {
    const value = current.join('\n').trim()
    if (value) chunks.push(value)
    current = []
    currentLines = 0
  }

  normalized.split('\n').forEach((rawLine) => {
    const line = rawLine.trimEnd()
    const lineCount = estimateHandlingarPdfLineCount(line)

    if (lineCount > HANDLINGAR_PDF_CHUNK_MAX_LINES) {
      pushCurrent()
      const words = line.split(/(\s+)/)
      let part = ''

      words.forEach((word) => {
        const next = `${part}${word}`
        if (part && estimateHandlingarPdfLineCount(next) > HANDLINGAR_PDF_CHUNK_MAX_LINES) {
          chunks.push(part.trim())
          part = word.trimStart()
          return
        }
        part = next
      })

      if (part.trim()) chunks.push(part.trim())
      currentLines = 0
      return
    }

    if (
      current.length > 0 &&
      currentLines + lineCount > HANDLINGAR_PDF_CHUNK_MAX_LINES
    ) {
      pushCurrent()
    }

    current.push(line)
    currentLines += lineCount
  })

  pushCurrent()
  return chunks.length > 0 ? chunks : [normalized]
}

function getHandlingarDocumentRowText(row: InspectionDocumentReportLineParts) {
  const statusText = [row.statusText, row.note ? `. ${row.note}` : '']
    .filter(Boolean)
    .join('')
  return statusText ? `${row.title} - ${statusText}` : row.title
}

function splitHandlingarDocumentRowsForPdf(rows: InspectionDocumentReportLineParts[]) {
  if (rows.length === 0) return [[]]

  const chunks: InspectionDocumentReportLineParts[][] = []
  let current: InspectionDocumentReportLineParts[] = []
  let currentLines = 0

  const pushCurrent = () => {
    if (current.length > 0) chunks.push(current)
    current = []
    currentLines = 0
  }

  rows.forEach((row) => {
    const lineCount = estimateHandlingarPdfLineCount(getHandlingarDocumentRowText(row))
    if (current.length > 0 && currentLines + lineCount > HANDLINGAR_PDF_CHUNK_MAX_LINES) {
      pushCurrent()
    }
    current.push(row)
    currentLines += lineCount
  })

  pushCurrent()
  return chunks.length > 0 ? chunks : [rows]
}

const interpolateAssignmentDate = (text: string, data: ReportDataV2) => {
  const assignmentDate = String(
    getValueAtPath(data, 'mock.inspections.assignment_confirmation_date') ?? ''
  ).trim()
  if (!assignmentDate) return text
  return text
    .replace(/ÅÅÅÅ-MM-DD/g, assignmentDate)
    .replace(/\{\{\s*assignment_confirmation_date\s*\}\}/g, assignmentDate)
}

const resolveTextSource = (source: TextSource, data: ReportDataV2) => {
  if (source.kind === 'static') return source.text
  if (source.kind === 'standardText') {
    const text = loadStandardText(source.id)
    return interpolateAssignmentDate(text, data)
  }
  if (source.kind === 'mock') {
    const value = getValueAtPath(data, source.path)
    if (Array.isArray(value)) return value.filter(Boolean).map((v) => repairMojibake(String(v))).join('\n')
    return repairMojibake(String(value ?? ''))
  }
  return ''
}

const renderBlock = (
  block: ReportBlock,
  data: ReportDataV2,
  imageMap: Record<string, string>
) => {
  if (block.type === 'heading') {
    const style =
      block.level === 1
        ? styles.heading1
        : block.level === 2
        ? styles.heading2
        : styles.heading3
    return (
      <Text key={`${block.text}-${block.level}`} style={style}>
        {block.text}
      </Text>
    )
  }

  if (block.type === 'text') {
    const text = resolveTextSource(block.source, data)
    if (!text) return null
    return (
      <Text key={`text-${block.marginTopMm}`} style={styles.text}>
        {text}
      </Text>
    )
  }

  if (block.type === 'boxedText') {
    const text = resolveTextSource(block.source, data)
    if (!text) return null
    return (
      <View key={`boxed-text-${block.marginTopMm}`} style={styles.boxedText}>
        <Text style={styles.text}>{text}</Text>
      </View>
    )
  }

  if (block.type === 'field') {
    const value = getValueAtPath(data, block.path)
    return (
      <View key={`${block.label}-${block.path}`} style={styles.row}>
        <Text style={styles.rowLabel}>{block.label}</Text>
        <Text style={styles.rowValue}>{repairMojibake(String(value ?? '--'))}</Text>
      </View>
    )
  }

  if (block.type === 'twoColumn') {
    return block.rows.flatMap((row, index) => {
      const value = Array.isArray(row.value)
        ? row.value.map((entry) => resolveTextSource(entry, data)).filter(Boolean)
        : [resolveTextSource(row.value, data)]
      const hasContent = value.some((entry) => {
        const trimmed = entry.trim()
        return trimmed.length > 0 && trimmed !== '--'
      })
      if (row.hideWhenEmpty && !hasContent) return []

      return (
        <View key={`${row.label}-${index}`} style={styles.row}>
          <Text style={styles.rowLabel}>{row.label}</Text>
          <Text style={styles.rowValue}>{value.filter(Boolean).join('\n')}</Text>
        </View>
      )
    })
  }

  if (block.type === 'handlingarLayout') {
    const provided = getListAtPath(data, 'mock.documents.provided')
    const providedRows = getInspectionDocumentRows(data)
    const renovations = getListAtPath(data, 'mock.disclosures.renovations')
    const faults = getListAtPath(data, 'mock.disclosures.property_faults')
    const acquisitionText = String(
      getValueAtPath(data, 'mock.disclosures.acquisition_text') ?? ''
    )

    const providedText =
      provided.length > 0 ? provided.join('\n') : block.emptyPlaceholder ?? '--'

    const infoParts = [
      block.infoDisclaimer,
      acquisitionText,
      ...(renovations.length > 0 ? [block.renovationsLabel] : []),
      ...renovations,
    ].filter((value) => value && value.length > 0)

    const faultsText = faults.length > 0 ? faults.join('\n') : ''

    const labelStyle = { width: '27%', fontWeight: 600 } as const
    const valueStyle = { width: '73%' } as const

    const providedRowChunks =
      providedRows.length > 0
        ? splitHandlingarDocumentRowsForPdf(providedRows)
        : splitHandlingarTextForPdf(providedText).map((chunk) =>
            chunk
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter(Boolean)
              .map((line) => parseInspectionDocumentReportLine(line))
          )

    return [
      ...providedRowChunks.map((rows, index) => (
        <View key={`handlingar-provided-${index}`} style={styles.row} wrap={false}>
          <Text style={labelStyle}>{index === 0 ? block.labels.provided : '\u00A0'}</Text>
          <View style={valueStyle}>
            {renderDocumentRowsPdf(rows)}
          </View>
        </View>
      )),
      ...splitHandlingarTextForPdf(infoParts.join('\n\n')).map((chunk, index) => (
        <View key={`handlingar-info-${index}`} style={styles.row} wrap={false}>
          <Text style={labelStyle}>{index === 0 ? block.labels.info : '\u00A0'}</Text>
          <Text style={valueStyle}>{chunk || '\u00A0'}</Text>
        </View>
      )),
      ...splitHandlingarTextForPdf(faultsText).map((chunk, index) => (
        <View key={`handlingar-faults-${index}`} style={styles.row} wrap={false}>
          <Text style={labelStyle}>{index === 0 ? block.labels.faults : '\u00A0'}</Text>
          <Text style={valueStyle}>{chunk || '\u00A0'}</Text>
        </View>
      )),
    ]
  }

  if (block.type === 'list') {
    const items = getValueAtPath(data, block.itemsPath) as string[]
    if (!Array.isArray(items) || items.length === 0) {
      return (
        <Text key={`list-${block.itemsPath}`} style={styles.text}>
          {block.emptyPlaceholder ?? '--'}
        </Text>
      )
    }
    return items.map((item, index) => (
      <Text key={`${block.itemsPath}-${index}`} style={styles.listItem}>
        - {item}
      </Text>
    ))
  }

  if (block.type === 'table') {
    const rows = getValueAtPath(data, block.rowsPath)
    const tableRows = Array.isArray(rows) ? rows as Array<Record<string, unknown>> : []
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
      const text = repairMojibake(String(value)).trim()
      return text.length > 0 ? text : '--'
    }

    return (
      <View key={`table-${block.rowsPath}`} style={styles.table}>
        <View style={styles.tableHeaderRow}>
          {block.columns.map((column, columnIndex) => (
            <Text
              key={`table-head-${block.rowsPath}-${columnIndex}`}
              style={[
                styles.tableHeaderCell,
                {
                  width: `${column.widthPercent ?? fallbackWidth}%`,
                  textAlign: column.align ?? 'left',
                },
              ]}
            >
              {column.header}
            </Text>
          ))}
        </View>
        {tableRows.length > 0 ? (
          tableRows.map((row, rowIndex) => (
            <View key={`table-row-${block.rowsPath}-${rowIndex}`} style={styles.tableRow} wrap={false}>
              {block.columns.map((column, columnIndex) => (
                <Text
                  key={`table-cell-${block.rowsPath}-${rowIndex}-${columnIndex}`}
                  style={[
                    styles.tableCell,
                    {
                      width: `${column.widthPercent ?? fallbackWidth}%`,
                      textAlign: column.align ?? 'left',
                    },
                  ]}
                >
                  {formatCellValue(row[column.key])}
                </Text>
              ))}
            </View>
          ))
        ) : (
          <Text style={styles.tablePlaceholder}>{block.emptyPlaceholder ?? '--'}</Text>
        )}
      </View>
    )
  }

  if (block.type === 'toc') {
    return block.entries.map((entry, index) => (
      <Text key={`${entry.label}-${index}`} style={styles.listItem}>
        {entry.label}
      </Text>
    ))
  }

  if (block.type === 'inspectionBlocks') {
    const items = getValueAtPath(data, block.itemsPath) as InspectionBlock[]
    if (!Array.isArray(items) || items.length === 0) return null

    return items.map((item, index) => {
      const noteText = (item.noteText ?? '').trim()
      const riskText = (item.riskText ?? '').trim()
      const ftuText = (item.ftuText ?? '').trim()
      const imageUrl = item.photoUrls?.[0]
      const resolvedImage = imageUrl ? imageMap[imageUrl] ?? imageUrl : null

      return (
        <View key={`${item.title}-${index}`} style={styles.block} wrap>
          <Text style={styles.blockTitle} minPresenceAhead={40}>
            {item.title}
          </Text>
          {noteText && noteText !== '--' && (
            <Text style={styles.blockNote}>{noteText}</Text>
          )}
          {riskText && (
            <Text style={styles.blockRisk}>
              <Text style={styles.blockLabel}>Risk:</Text> {riskText}
            </Text>
          )}
          {ftuText && (
            <Text style={styles.blockFtu}>
              <Text style={styles.blockLabel}>FTU:</Text> {ftuText}
            </Text>
          )}
          {resolvedImage && (
            <View style={styles.imageWrap} wrap={false}>
              <Image src={resolvedImage} style={styles.image} />
            </View>
          )}
        </View>
      )
    })
  }

  if (block.type === 'pageBreak') {
    return <View key={`break-${block.label ?? 'break'}`} break />
  }

  return null
}

export default function ReportPdfDocumentV2({
  spec,
  data,
  imageMap = {},
}: ReportPdfDocumentV2Props) {
  const mock = data.mock as Record<string, unknown>
  const propertyMock =
    mock.properties && typeof mock.properties === 'object'
      ? mock.properties as Record<string, unknown>
      : {}
  const inspectionMock =
    mock.inspections && typeof mock.inspections === 'object'
      ? mock.inspections as Record<string, unknown>
      : {}
  const address =
    propertyMock.address ??
    propertyMock.cadastral_id ??
    'Report'
  const inspectionDate = inspectionMock.date ?? ''
  const rendererLabel = 'Renderer: pdf-v2'

  return (
    <Document>
      {spec.map((section) => {
        const appendixText =
          section.type === 'appendix' && section.appendixId
            ? loadAppendixText(section.appendixId)
            : ''

        return (
          <Page key={section.id} size="A4" style={styles.page}>
            <Text style={styles.header} fixed>
              {`${address}${inspectionDate ? ` - ${inspectionDate}` : ''}`}
            </Text>
            <Text
              style={styles.footer}
              fixed
              render={({ pageNumber, totalPages }) =>
                `${rendererLabel} - Page ${pageNumber} / ${totalPages}`
              }
            />
            <View>
              {section.title ? (
                <Text style={styles.heading2}>{section.title}</Text>
              ) : null}
              {section.blocks.map((block) => renderBlock(block, data, imageMap))}
              {appendixText ? <Text style={styles.text}>{appendixText}</Text> : null}
            </View>
          </Page>
        )
      })}
    </Document>
  )
}
