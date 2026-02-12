import { loadStandardText } from '@/content/standardtexts/loadStandardText'
import { loadAppendixText } from '@/lib/report/loadAppendixText'
import type { ReportBlock, ReportSection, TextSource } from '@/lib/report/reportSpec'
import ReportRendererClient from '@/components/report/ReportRendererClient'

type ReportRendererProps = {
  spec: ReportSection[]
  mockData: Record<string, unknown>
  rootClassName?: string
  inspectionSide?: 'buyer' | 'seller' | null
}

type ResolvedReportSection = ReportSection & { appendixText?: string }

const getMockValue = (mockData: Record<string, unknown>, path: string): string => {
  const value = path.split('.').reduce((acc: any, key) => (acc ? acc[key] : undefined), mockData)
  if (value === null || value === undefined) return '--'
  return String(value)
}

const interpolateStandardText = (text: string, mockData: Record<string, unknown>) => {
  const assignmentDate = getMockValue(
    mockData,
    'mock.inspections.assignment_confirmation_date'
  )
  return text
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
      rootClassName={rootClassName}
    />
  )
}
