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

const getValueAtPath = (obj: any, path: string) =>
  path.split('.').reduce((acc, key) => (acc ? acc[key] : undefined), obj)

const getListAtPath = (obj: any, path: string): string[] => {
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
        <Text style={styles.rowValue}>{value ?? '--'}</Text>
      </View>
    )
  }

  if (block.type === 'twoColumn') {
    return block.rows.map((row, index) => {
      const value = Array.isArray(row.value)
        ? row.value.map((entry) => resolveTextSource(entry, data)).filter(Boolean)
        : [resolveTextSource(row.value, data)]

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

    return [
      <View key={`handlingar-provided`} style={styles.row}>
        <Text style={labelStyle}>{block.labels.provided}</Text>
        <Text style={valueStyle}>{providedText}</Text>
      </View>,
      <View key={`handlingar-info`} style={styles.row}>
        <Text style={labelStyle}>{block.labels.info}</Text>
        <Text style={valueStyle}>{infoParts.join('\n')}</Text>
      </View>,
      <View key={`handlingar-faults`} style={styles.row}>
        <Text style={labelStyle}>{block.labels.faults}</Text>
        <Text style={valueStyle}>{faultsText}</Text>
      </View>,
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
  const address =
    (data.mock as any)?.properties?.address ??
    (data.mock as any)?.properties?.cadastral_id ??
    'Report'
  const inspectionDate = (data.mock as any)?.inspections?.date ?? ''
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
