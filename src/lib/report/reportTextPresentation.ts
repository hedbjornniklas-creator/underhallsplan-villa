import type { StandardTextId } from '@/content/standardtexts/registry'
import type { AppendixTextId } from './loadAppendixText'
import type { ReportSnapshotPayloadV1 } from './reportSnapshotPayload'
import type { ReportBlock, TextSource } from './reportSpec'
import { formatFurnishingLevel } from './furnishingLevel'

function valueAt(data: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) =>
    value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined, data)
}

export function interpolateReportStandardText(id: StandardTextId, text: string, data: Record<string, unknown>) {
  const date = String(valueAt(data, 'mock.inspections.assignment_confirmation_date') ?? '--')
  let result = text.replace(/ÅÅÅÅ-MM-DD|\{\{\s*assignment_confirmation_date\s*\}\}/g, date)
  if (id === 'STD_VISUAL_INSPECTION_CONDITIONS') {
    const furnishing = String(valueAt(data, 'mock.inspection_conditions.furnishing_level') ?? '').trim()
    if (furnishing && furnishing !== '--' && furnishing !== 'saknas') {
      result = result.replace('fullt möblerad', formatFurnishingLevel(furnishing))
    }
  }
  return result
}

type TextLoaders = {
  standard: (id: StandardTextId) => string
  appendix: (id: AppendixTextId) => string
}

/** Reads only the published payload. No current inspection or catalogue rows are consulted. */
export function snapshotReportTexts(snapshot: ReportSnapshotPayloadV1, loaders: TextLoaders) {
  const data = snapshot.reportData as unknown as Record<string, unknown>
  const sections = snapshot.reportSpec
  const blocks = (id: string) => sections.find(section => section.id === id)?.blocks ?? []
  const resolve = (source: TextSource): string => {
    if (source.kind === 'static') return source.text
    if (source.kind === 'standardText') return interpolateReportStandardText(source.id, loaders.standard(source.id), data)
    const value = String(valueAt(data, source.path) ?? '--')
    return source.path.endsWith('.furnishing_level') ? formatFurnishingLevel(value) : value
  }
  const standard = (id: StandardTextId) => resolve({ kind: 'standardText', id })
  const rowText = (prefix: string, fallback: StandardTextId) => {
    for (const block of blocks('okular')) {
      if (block.type !== 'twoColumn') continue
      for (const row of block.rows) {
        const sources = Array.isArray(row.value) ? row.value : [row.value]
        if (row.label.toLocaleLowerCase('sv-SE').startsWith(prefix) ||
          sources.some(source => source.kind === 'standardText' && source.id === fallback)) {
          return sources.map(resolve).join('\n')
        }
      }
    }
    return standard(fallback)
  }
  const assignment = blocks('assignment')
  const profileIndex = assignment.findIndex(block => block.type === 'twoColumn' && block.rows.some(row =>
    (Array.isArray(row.value) ? row.value : [row.value]).some(source =>
      source.kind === 'mock' && source.path === 'mock.profile.full_name')))
  const membership = profileIndex < 0 ? undefined : assignment[profileIndex + 1]
  const membershipBlock = membership?.type === 'text' ? membership : undefined
  const notice = assignment.filter((block): block is Extract<ReportBlock, { type: 'text' }> =>
    block.type === 'text' && block !== membershipBlock).at(-1)
  const handlingar = blocks('handlingar').find(block => block.type === 'handlingarLayout')
  const appendix = (number: number, fallback: AppendixTextId) => {
    const section = sections.find(section => section.id === `appendix-${number}`)
    // An explicitly empty frozen field stays empty; it is not replaced with a newer template.
    if (section?.appendixTextPath) return String(valueAt(data, section.appendixTextPath) ?? '--')
    return loaders.appendix(section?.appendixId ?? fallback)
  }
  const blockNotice = (itemsPath: string) => {
    const section = sections.find(section => section.blocks.some(block =>
      block.type === 'inspectionBlocks' && block.itemsPath === itemsPath))
    return (section?.blocks ?? []).filter((block): block is Extract<ReportBlock, { type: 'boxedText' }> =>
      block.type === 'boxedText').map(block => resolve(block.source)).join('\n\n')
  }
  const seller = snapshot.inspectionSide === 'seller'
  const apartment = snapshot.inspectionSide === 'apartment'
  const buildings = valueAt(data, 'mock.appendices.buildings')
  return {
    assignmentNotice: notice ? resolve(notice.source) : standard(seller ? 'STD_ASSIGNMENT_SELLER_NOTICE' :
      apartment ? 'STD_ASSIGNMENT_APARTMENT_NOTICE' : 'STD_ASSIGNMENT_BUYER_NOTICE'),
    visualConditions: rowText('särskilda', 'STD_VISUAL_INSPECTION_CONDITIONS'),
    oralInformation: rowText('muntliga', 'STD_VISUAL_INSPECTION_ORAL'),
    membership: membershipBlock ? resolve(membershipBlock.source) : sections.length ? '' :
      'Besiktningsmannen är medlem i Svenska Byggingenjörers Riksförbund (SBR) och är registrerad i SBR:s förteckning över besiktningsmän med därtill hörande förpliktelser.',
    ownerInformation: handlingar?.type === 'handlingarLayout' ? handlingar.infoDisclaimer :
      'Under denna rubrik är samtliga uppgifter lämnade av fastighetsägare eller dess ombud. Uppgifterna är inte kontrollerade av besiktningsmannen.',
    renovationsLabel: handlingar?.type === 'handlingarLayout' ? handlingar.renovationsLabel :
      'Följande renoveringar och underhåll är utförda:',
    appendix1: appendix(1, seller ? 'APPENDIX_1_VILLKOR_SELLER_SBR' : apartment ?
      'APPENDIX_1_VILLKOR_APARTMENT_SBR' : 'APPENDIX_1_VILLKOR_BUYER_SBR'),
    appendix2: snapshot.inspectionSide === 'status' ? '' : appendix(2, 'APPENDIX_2_LITEN_BYGGORDBOK_SBR'),
    appendix3: snapshot.inspectionSide === 'status' ? '' : appendix(3, 'APPENDIX_3_LIFESPAN_TABLE_SBR'),
    mainNotice: blockNotice('mock.interior.blocks'),
    buildingNotices: Array.isArray(buildings) ? buildings.map((_, index) =>
      blockNotice(`mock.appendices.buildings.${index}.interior.blocks`)) : [],
  }
}
