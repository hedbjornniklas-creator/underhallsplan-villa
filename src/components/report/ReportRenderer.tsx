import { loadStandardText } from '@/content/standardtexts/loadStandardText'
import { loadAppendixText } from '@/lib/report/loadAppendixText'
import type { ReportBlock, ReportSection, TextSource } from '@/lib/report/reportSpec'
import ReportRendererClient from '@/components/report/ReportRendererClient'

type ReportRendererProps = {
  spec: ReportSection[]
  mockData: Record<string, unknown>
  rootClassName?: string
  inspectionSide?: 'buyer' | 'seller' | 'apartment' | null
}

type ResolvedReportSection = ReportSection & { appendixText?: string }

const getMockValue = (mockData: Record<string, unknown>, path: string): string => {
  const value = path.split('.').reduce((acc: any, key) => (acc ? acc[key] : undefined), mockData)
  if (value === null || value === undefined) return '--'
  return String(value)
}

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

const interpolateStandardText = (text: string, mockData: Record<string, unknown>) => {
  const assignmentDate = getMockValue(mockData, 'mock.inspections.assignment_confirmation_date')
  return repairMojibake(text)
    .replace(/ÅÅÅÅ-MM-DD/g, assignmentDate)
    .replace(/\{\{\s*assignment_confirmation_date\s*\}\}/g, assignmentDate)
}

const resolveTextSource = (
  source: TextSource,
  mockData: Record<string, unknown>
): TextSource => {
  if (source.kind === 'standardText') {
    const raw = loadStandardText(source.id)
    return { kind: 'static', text: interpolateStandardText(raw, mockData) }
  }
  return source
}

const resolveBlock = (block: ReportBlock, mockData: Record<string, unknown>): ReportBlock => {
  if (block.type === 'text') {
    return { ...block, source: resolveTextSource(block.source, mockData) }
  }
  if (block.type === 'boxedText') {
    return { ...block, source: resolveTextSource(block.source, mockData) }
  }
  if (block.type === 'twoColumn') {
    return {
      ...block,
      rows: block.rows.map((row) => ({
        ...row,
        value: Array.isArray(row.value)
          ? row.value.map((value) => resolveTextSource(value, mockData))
          : resolveTextSource(row.value, mockData),
      })),
    }
  }
  return block
}

export default function ReportRenderer({
  spec,
  mockData,
  rootClassName,
  inspectionSide,
}: ReportRendererProps) {
  const coverNoticeId =
    inspectionSide === 'seller' ? 'STD_COVER_SELLER_NOTICE' : 'STD_COVER_BUYER_DUTY_NOTICE'
  const coverNotice = loadStandardText(coverNoticeId)
  const resolvedSpec: ResolvedReportSection[] = spec.map((section) => {
    const resolvedBlocks = section.blocks.map((block) => resolveBlock(block, mockData))
    const appendixText =
      section.type === 'appendix' && section.appendixId
        ? loadAppendixText(section.appendixId)
        : undefined
    return { ...section, blocks: resolvedBlocks, appendixText }
  })

  return (
    <ReportRendererClient
      spec={resolvedSpec}
      mockData={mockData}
      coverNotice={coverNotice}
      inspectionSide={inspectionSide}
      rootClassName={rootClassName}
    />
  )
}
