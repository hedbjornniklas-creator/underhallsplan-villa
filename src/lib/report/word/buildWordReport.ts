import {
  AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel, ImageRun,
  Packer, PageNumber, Paragraph, Table, TableCell, TableLayoutType, TableRow,
  TextRun, VerticalAlign, WidthType,
} from 'docx'
import { loadStandardText } from '@/content/standardtexts/loadStandardText'
import { loadAppendixText } from '@/lib/report/loadAppendixText'
import type { ReportBlock, TextSource } from '@/lib/report/reportSpec'
import type { ReportSnapshotPayloadV1 } from '@/lib/report/reportSnapshotPayload'
import { formatFurnishingLevel } from '@/lib/report/furnishingLevel'
import { resolveObObjectType } from '@/lib/ob/objectType'
import { defaultCoverIllustrationSrc, sbrLogoSrc } from '@/lib/report/reportAssets'

export type WordImage = { data: Buffer; width: number; height: number }
export type WordReportOptions = { loadImage: (url: string) => Promise<WordImage>; draft?: boolean }
type Child = Paragraph | Table
type Row = Record<string, unknown>
const mm = (value: number) => Math.round(value * 1440 / 25.4)
const WIDTH = mm(170)
const record = (value: unknown): Row => value && typeof value === 'object' ? value as Row : {}
const valueAt = (value: unknown, path: string): unknown => path.split('.').reduce<unknown>((row, key) =>
  Object.hasOwn(record(row), key) ? record(row)[key] : undefined, value)
const text = (value: unknown, fallback = '--') => value === null || value === undefined || value === '' ? fallback : String(value)
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : value ? [value] : []
const hasText = (value: string) => Boolean(value.trim() && value.trim() !== '--')

function paragraphs(value: string, options: { small?: boolean; bold?: boolean; keepNext?: boolean; compact?: boolean } = {}): Paragraph[] {
  // Separate paragraphs let Word paginate long findings instead of keeping an entire note together.
  return value.replace(/\r\n?/g, '\n').split('\n').map(line => new Paragraph({
    children: [new TextRun({ text: line, bold: options.bold, size: options.small ? 19 : 22 })],
    spacing: { after: options.compact ? line ? 30 : 65 : line ? 85 : 45, line: options.compact ? 240 : 276 },
    keepNext: options.keepNext, widowControl: true,
  }))
}

function appendixParagraphs(value: string, id?: string): Paragraph[] {
  const lines = value.replace(/\r\n?/g, '\n').split('\n')
  if (id === 'APPENDIX_2_LITEN_BYGGORDBOK_SBR') {
    const entries = lines.filter(line => line.trim())
    const result: Paragraph[] = []
    for (let i = 0; i < entries.length; i += 2) result.push(new Paragraph({
      children: [new TextRun({ text: `${entries[i]} `, bold: true, size: 19 }), new TextRun({ text: entries[i + 1] ?? '', size: 19 })],
      spacing: { after: 90, line: 240 }, widowControl: true,
    }))
    return result
  }
  if (id === 'APPENDIX_3_LIFESPAN_TABLE_SBR') return lines.filter(line => !line.trim().startsWith('#')).map(line => {
    const split = line.lastIndexOf('|')
    const isHeading = split < 0 && line.trim().length > 0 && line === line.toLocaleUpperCase('sv-SE')
    return new Paragraph({ children: [new TextRun({ text: split < 0 ? line : `${line.slice(0, split).trim()}\t${line.slice(split + 1).trim()}`, bold: isHeading, size: 19 })],
      tabStops: [{ type: 'right', position: WIDTH }], spacing: { after: line.trim() ? 55 : 90, line: 240 },
      keepNext: isHeading, widowControl: true })
  })
  return paragraphs(value, { small: true, compact: true })
}

function heading(value: string, level: 1 | 2 | 3 = 2, size?: number, align?: 'left' | 'center' | 'right'): Paragraph {
  return new Paragraph({ children: [new TextRun({ text: value, ...(size ? { size: size * 2 } : {}) })],
    heading: level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3, alignment: align,
    keepNext: true, spacing: { before: level === 3 ? 140 : 220, after: 120 } })
}

export async function buildWordReport(snapshot: ReportSnapshotPayloadV1, options: WordReportOptions): Promise<Buffer> {
  if (!snapshot.reportSpec.length) throw Error('WORD_REPORT_SPEC_MISSING')
  const data = snapshot.reportData
  const mock = record(data.mock)
  const isStatus = snapshot.inspectionSide === 'status'
  const images = new Map<string, Promise<WordImage>>()
  const image = async (url: string, maxWidth: number, maxHeight: number, label: string) => {
    if (!images.has(url)) {
      if (images.size >= 250) throw Error('WORD_REPORT_TOO_LARGE')
      images.set(url, options.loadImage(url))
    }
    const source = await images.get(url)!
    const scale = Math.min(maxWidth / source.width, maxHeight / source.height, 1)
    return new ImageRun({ type: 'png', data: source.data,
      transformation: { width: Math.round(source.width * scale), height: Math.round(source.height * scale) },
      altText: { title: label, description: label, name: label } })
  }
  const photoParagraphs = async (urls: unknown, label: string, large = false): Promise<Paragraph[]> => {
    const sources = list(urls).filter((url): url is string => typeof url === 'string' && Boolean(url.trim()))
    const result: Paragraph[] = []
    for (let i = 0; i < sources.length; i += large ? 1 : 2) {
      const runs = await Promise.all(sources.slice(i, i + (large ? 1 : 2)).map(url =>
        image(url, large ? 610 : 295, large ? 365 : 230, label)))
      if (!large) result.push(new Paragraph({ children: [new TextRun({ text: label, size: 18, italics: true })],
        keepNext: true, spacing: { before: 100, after: 40 } }))
      result.push(new Paragraph({ alignment: AlignmentType.CENTER, children: runs.flatMap((run, index) =>
        index ? [new TextRun('  '), run] : [run]), spacing: { before: 80, after: 140 }, keepLines: true }))
    }
    return result
  }
  const resolve = (source: TextSource): string => {
    if (source.kind === 'mock') {
      const value = text(valueAt(data, source.path))
      return source.path.endsWith('.furnishing_level') ? formatFurnishingLevel(value) : value
    }
    if (source.kind === 'static') return source.text
    let value = loadStandardText(source.id)
    const date = text(valueAt(data, 'mock.inspections.assignment_confirmation_date'))
    value = value.replace(/ÅÅÅÅ-MM-DD|\{\{\s*assignment_confirmation_date\s*\}\}/g, date)
    if (source.id === 'STD_VISUAL_INSPECTION_CONDITIONS') {
      const furnishing = text(valueAt(data, 'mock.inspection_conditions.furnishing_level'), '')
      if (hasText(furnishing) && furnishing !== 'saknas') value = value.replace('fullt möblerad', formatFurnishingLevel(furnishing))
    }
    return value
  }
  const fields = (label: string, value: string, small = false): Child[] => [
    new Paragraph({ children: [new TextRun({ text: label, bold: true, size: small ? 19 : 22 })],
      keepNext: true, spacing: { before: 100, after: 40 } }), ...paragraphs(value, { small }),
  ]
  const inspectionBlocks = async (items: unknown, introduction = false): Promise<Child[]> => {
    const result: Child[] = []
    for (const raw of list(items)) {
      const item = record(raw)
      if (!introduction && hasText(text(item.title, ''))) result.push(heading(text(item.title), 3))
      if (hasText(text(item.noteText, ''))) result.push(...paragraphs(text(item.noteText)))
      const extra = isStatus
        ? [['Rekommendation', item.recommendationText], ['Övriga kommentarer', item.commentText]]
        : [['Riskanalys', item.riskText], ['Fortsatt teknisk utredning', item.ftuText]]
      for (const [label, value] of extra) {
        if (hasText(text(value, ''))) result.push(...fields(String(label), text(value)))
      }
      result.push(...await photoParagraphs(item.photoUrls, text(item.title, 'Besiktningsbild'), introduction))
    }
    return result.length ? result : paragraphs('--')
  }
  const renderBlock = async (block: ReportBlock): Promise<Child[]> => {
    switch (block.type) {
      case 'heading': return [heading(block.text, block.level, block.fontSizePt, block.align)]
      case 'text': case 'boxedText': return paragraphs(resolve(block.source), { small: block.small })
      case 'field': return fields(block.label, text(valueAt(data, block.path)))
      case 'image': return [] // Fixed decorative rules have no document content.
      case 'pageBreak': return [new Paragraph({ pageBreakBefore: true })]
      case 'toc': return block.entries.map(entry => new Paragraph({ text: entry.label,
        spacing: { after: 130 }, keepNext: false }))
      case 'list': return list(valueAt(data, block.itemsPath)).length
        ? list(valueAt(data, block.itemsPath)).flatMap(item => paragraphs(text(item)))
        : paragraphs(block.emptyPlaceholder ?? '--')
      case 'buildingIntroduction': return inspectionBlocks(valueAt(data, block.itemsPath), true)
      case 'inspectionBlocks': return inspectionBlocks(valueAt(data, block.itemsPath))
      case 'twoColumn': return block.rows.flatMap(row => {
        const values = (Array.isArray(row.value) ? row.value : [row.value]).map(resolve)
        if (row.hideWhenEmpty && !values.some(hasText)) return []
        return [new Paragraph({ children: [new TextRun({ text: `${row.label} `, bold: true }),
          ...values.flatMap((value, index) => [new TextRun({ text: value, break: index ? 1 : undefined })])],
          spacing: { after: 100 }, widowControl: true }),
        ...(row.note ? paragraphs(row.note.text, { small: true }) : [])]
      })
      case 'handlingarLayout': {
        const documents = list(valueAt(data, 'mock.documents.provided')).map(item => text(item)).join('\n')
        const renovations = list(valueAt(data, 'mock.disclosures.renovations')).map(item => text(item))
        const info = [block.infoDisclaimer, text(valueAt(data, 'mock.disclosures.acquisition_text'), ''),
          ...(renovations.length ? [block.renovationsLabel, ...renovations] : [])].filter(Boolean).join('\n\n')
        const faults = list(valueAt(data, 'mock.disclosures.property_faults')).map(item => text(item)).join('\n')
        return [...fields(block.labels.provided, documents || block.emptyPlaceholder || '--'),
          ...fields(block.labels.info, info), ...fields(block.labels.faults, faults)]
      }
      case 'table': {
        const rows = list(valueAt(data, block.rowsPath)).map(record)
        const configured = block.columns.reduce((sum, column) => sum + (column.widthPercent ?? 0), 0)
        const remaining = block.columns.filter(column => column.widthPercent === undefined).length
        const widths = block.columns.map(column => Math.round(WIDTH * (column.widthPercent ?? ((100 - configured) / (remaining || 1))) / 100))
        const cell = (value: string, index: number, header: boolean) => new TableCell({
          width: { size: widths[index], type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER,
          margins: { top: 90, bottom: 90, left: 100, right: 100 },
          shading: header ? { fill: 'EAF0F7' } : undefined,
          children: value.split('\n').map(line => new Paragraph({
            children: [new TextRun({ text: line, bold: header, size: 19 })], spacing: { after: 30 },
            alignment: block.columns[index].align ?? AlignmentType.LEFT,
          })),
        })
        const border = { style: BorderStyle.SINGLE, size: 4, color: 'D9D9D9' }
        return [new Table({ width: { size: WIDTH, type: WidthType.DXA }, columnWidths: widths,
          layout: TableLayoutType.FIXED,
          borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
          rows: [new TableRow({ tableHeader: true, children: block.columns.map((column, index) => cell(column.header, index, true)) }),
            ...(rows.length ? rows.map(row => new TableRow({ children: block.columns.map((column, index) =>
              cell(text(row[column.key]), index, false)) })) : [new TableRow({ children: [new TableCell({
                columnSpan: block.columns.length, margins: { top: 90, bottom: 90, left: 100, right: 100 },
                children: paragraphs(block.emptyPlaceholder ?? '--', { small: true }),
              })] })])],
        }), new Paragraph({ spacing: { after: 100 } })]
      }
    }
  }

  const property = record(mock.properties)
  const inspection = record(mock.inspections)
  const company = record(mock.company)
  const profile = record(mock.profile)
  const isApartment = resolveObObjectType(snapshot.inspectionSide, snapshot.objectType ?? property.object_type) === 'apartment'
  const reportTitle = isStatus ? 'STATUSBESIKTNING' : isApartment ? 'LÄGENHETSBESIKTNING' : 'ÖVERLÅTELSEBESIKTNING'
  const children: Child[] = []
  for (const section of snapshot.reportSpec) {
    if (isStatus && section.id === 'notes' && !list(record(mock.exterior).blocks).length) continue
    const start = children.length
    if (section.type === 'cover') {
      const logos = [await image(sbrLogoSrc, 200, 85, 'SBR logotyp')]
      if (hasText(text(company.logo_url, ''))) logos.push(await image(text(company.logo_url), 200, 85, 'Företagslogotyp'))
      children.push(new Paragraph({ children: logos.flatMap((logo, index) => index ? [new TextRun('        '), logo] : [logo]), spacing: { after: 240 } }),
        ...(options.draft ? paragraphs('UTKAST', { bold: true }) : []),
        ...paragraphs(`Besiktningsdag: ${text(inspection.date)}\nUppdragsnummer: ${text(inspection.assignment_number)}`),
        new Paragraph({ text: `Utlåtande över ${reportTitle.toLocaleLowerCase('sv-SE')}`, style: 'Title', spacing: { before: 300, after: 220 } }),
        ...fields(isApartment ? 'Lägenhetsnummer' : 'Fastighetsbeteckning', text(isApartment ? property.apartment_number : property.cadastral_id)),
        ...(isApartment && hasText(text(property.brf_name, '')) ? fields('Bostadsrättsförening', text(property.brf_name)) : []),
        ...(isApartment && isStatus && hasText(text(property.apartment_holder_name, '')) ? fields('Lägenhetsinnehavare', text(property.apartment_holder_name)) : []),
        ...fields('Adress', text(property.address)),
        ...await photoParagraphs(property.cover_path || defaultCoverIllustrationSrc, 'Omslagsbild', true))
      if (!isStatus) children.push(...paragraphs(loadStandardText(snapshot.inspectionSide === 'seller'
        ? 'STD_COVER_SELLER_NOTICE' : 'STD_COVER_BUYER_DUTY_NOTICE'), { small: true }))
    } else if (section.type === 'appendix') {
      children.push(heading(section.title ?? '', 1))
      const content = section.appendixTextPath ? text(valueAt(data, section.appendixTextPath), '')
        : section.appendixId ? loadAppendixText(section.appendixId) : ''
      if (!hasText(content)) throw Error('WORD_REPORT_CONTENT_MISSING')
      children.push(...appendixParagraphs(content, section.appendixId))
    } else {
      for (const block of section.blocks) children.push(...await renderBlock(block))
    }
    if (section.startOnNewPage && start > 0 && children.length > start) {
      children.splice(start, 0, new Paragraph({ pageBreakBefore: true, keepNext: true,
        spacing: { after: 0, before: 0, line: 20 }, run: { size: 2 } }))
    }
  }
  if (children.length > 50000) throw Error('WORD_REPORT_TOO_LARGE')
  const contact = [profile.company_name, profile.company_address,
    [profile.company_postal_code, profile.company_city].filter(Boolean).join(' '), profile.company_website]
    .map(value => text(value, '')).filter(hasText).join(' · ')
  const doc = new Document({ creator: text(profile.company_name, 'BesiktApp'), title: `${reportTitle} ${text(property.address, '')}`,
    description: 'Redigerbar kopia av besiktningsutlåtandet',
    styles: { default: { document: { run: { font: 'Arial', size: 22, color: '000000', language: { value: 'sv-SE' } },
      paragraph: { spacing: { line: 276, after: 100 } } } },
      paragraphStyles: [
        { id: 'Title', name: 'Title', basedOn: 'Normal', next: 'Normal', run: { size: 44, bold: true, color: '000000' }, paragraph: { keepNext: true } },
        ...([['Heading1', 32], ['Heading2', 28], ['Heading3', 24]] as const).map(([id, size]) =>
          ({ id, name: id, basedOn: 'Normal', next: 'Normal', run: { size, bold: true, color: '000000' }, paragraph: { keepNext: true } })),
      ],
    },
    sections: [{ properties: { page: { size: { width: mm(210), height: mm(297) }, margin: { top: mm(18), bottom: mm(20), left: mm(20), right: mm(20) } } },
      headers: { default: new Header({ children: [new Paragraph({ children: [new TextRun({
        text: `${text(property.cadastral_id, text(property.address, ''))}    ${text(inspection.date, '')}`, size: 18,
      })], spacing: { after: 120 } })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: contact, size: 16 })], spacing: { after: 60 } }),
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: ['Sida ', PageNumber.CURRENT, ' av ', PageNumber.TOTAL_PAGES], size: 18 })] })] }) },
      children }],
  })
  const bytes = await Packer.toBuffer(doc)
  if (bytes.byteLength > 64 * 1024 * 1024) throw Error('WORD_REPORT_TOO_LARGE')
  return bytes
}
