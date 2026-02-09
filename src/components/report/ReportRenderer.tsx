import { loadStandardText } from '@/content/standardtexts/loadStandardText'
import { loadAppendixText } from '@/lib/report/loadAppendixText'
import type { ReportBlock, ReportSection, TextSource } from '@/lib/report/reportSpec'
import ReportRendererClient from '@/components/report/ReportRendererClient'

type ReportRendererProps = {
  spec: ReportSection[]
  mockData: Record<string, unknown>
  rootClassName?: string
}

type ResolvedReportSection = ReportSection & { appendixText?: string }

const resolveTextSource = (source: TextSource): TextSource => {
  if (source.kind === 'standardText') {
    return { kind: 'static', text: loadStandardText(source.id) }
  }
  return source
}

const resolveBlock = (block: ReportBlock): ReportBlock => {
  if (block.type === 'text') {
    return { ...block, source: resolveTextSource(block.source) }
  }
  if (block.type === 'twoColumn') {
    return {
      ...block,
      rows: block.rows.map((row) => ({
        ...row,
        value: Array.isArray(row.value)
          ? row.value.map(resolveTextSource)
          : resolveTextSource(row.value),
      })),
    }
  }
  return block
}

export default function ReportRenderer({
  spec,
  mockData,
  rootClassName,
}: ReportRendererProps) {
  const coverNotice = loadStandardText('STD_COVER_BUYER_DUTY_NOTICE')
  const resolvedSpec: ResolvedReportSection[] = spec.map((section) => {
    const resolvedBlocks = section.blocks.map(resolveBlock)
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
