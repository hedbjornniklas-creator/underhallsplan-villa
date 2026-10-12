import React from 'react'
import { join } from 'node:path'
import { Document, Font, Page, StyleSheet, Text, View, type DocumentProps } from '@react-pdf/renderer'
// @ts-expect-error Explicit extensions support the shared Node PDF test runner.
import { renderPdfDocument } from '../pdf/renderDocument.ts'
// @ts-expect-error Explicit extensions support the shared Node PDF test runner.
import { customerOfferBaseAmount, money, type CustomerOfferSnapshot, type CustomerOfferFile } from './customerOffers.ts'
// @ts-expect-error Explicit extensions support the shared Node PDF test runner.
import { contractEntryText, contractFields, contractParticipantFields } from './customerContract.ts'
// @ts-expect-error Explicit extensions support the shared Node PDF test runner.
import { contractFixedAmount, contractFixedRows, contractRowAmount } from './contractPricing.ts'
// @ts-expect-error Explicit extensions support the shared Node PDF test runner.
import { changeMarkupFields } from './contractChanges.ts'
// @ts-expect-error Explicit extensions support the shared Node PDF test runner.
import { paymentConditionsText } from './customerPaymentPlan.ts'
// @ts-expect-error Explicit extensions support the shared Node PDF test runner.
import { siteFacilityFields, siteFacilityPartyLabel, siteFacilityUsed } from './contractSiteFacilities.ts'
// @ts-expect-error Explicit extensions support the shared Node PDF test runner.
import { propertyFields } from '../properties/identity.ts'

export type SigningPdfInput = { id: string; version: number; draftRevision?: number; createdAt: string; snapshot: CustomerOfferSnapshot; files: CustomerOfferFile[]; unavailableAttachments?: string[] }
type SectionGroup = 'parties' | 'controls' | 'property' | 'assignment' | 'workEnvironment' | 'advice' | 'price' | 'changes' | 'payments' | 'schedule' | 'delay' | 'inspection' | 'insurance' | 'completionProtection' | 'security' | 'other' | 'siteFacilities'
type ParagraphBlock = { label?: string; text: string }
export type SigningPdfSection = { group: SectionGroup; title: string; paragraphs: string[]; blocks?: ParagraphBlock[]; columns?: string[]; rows?: string[][]; totalRow?: boolean; numericColumns?: number[]; columnWidths?: number[]; afterTable?: string[] }
const section = (group: SectionGroup, title: string, ...paragraphs: string[]): SigningPdfSection => ({ group, title, paragraphs: paragraphs.filter((v) => v.trim()) })
const labelledSection = (group: SectionGroup, title: string, blocks: ParagraphBlock[], keepEmptyLabels = false): SigningPdfSection => {
  const visible = blocks.filter((b) => b.text.trim() || (keepEmptyLabels && b.label))
  return { group, title, paragraphs: visible.map((b) => b.label ? `${b.label}\n${b.text}` : b.text), blocks: visible }
}
const pdfMoney = (amount: number | null) => amount === null ? '' : money(amount)

// Only saved customer-facing fields are projected, never costing or current defaults.
export function contractSigningSections({ snapshot: s, files }: SigningPdfInput): SigningPdfSection[] {
  const result: SigningPdfSection[] = [], d = s.contractDetails, p = s.contractParties
  if (p) {
    result.push(section('parties', 'Beställare', ...p.customers.map((c, i) => `Beställare ${i + 1}: ${c.name}${c.personalNumber ? `\nPersonnummer: ${c.personalNumber}` : ''}`),
      `${p.street}\n${p.postalCode} ${p.city}`, `Telefon: ${p.phone}\nMobiltelefon: ${p.mobile}\nE-post: ${p.email}`))
    const c = p.contractor
    result.push(section('parties', 'Entreprenör', `${c.companyName}\nOrganisationsnummer: ${c.organizationNumber}`, `${c.street}\n${c.postalCode} ${c.city}`,
      `Kontaktperson: ${c.contactName}\nTelefon: ${c.phone}\nMobiltelefon: ${c.mobile}\nFax: ${c.fax}\nE-post: ${c.email}\nF-skatt: ${c.fTax === 'yes' ? 'Ja' : c.fTax === 'no' ? 'Nej' : ''}`))
  } else result.push(section('parties', 'Parter', `Beställare: ${s.customerName}\n${s.customerEmail}`, `Entreprenör: ${s.issuerName}\n${s.replyEmail}`))
  if (d?.controlParticipants) result.push(section('controls', 'Övriga medverkande', ...contractParticipantFields.map(({ key, title }) => `${title}\n${d.controlParticipants![key]}`)))
  else if (d && contractEntryText(d.fields.controls)) result.push(section('controls', 'Övriga medverkande', contractEntryText(d.fields.controls)))
  if (d?.property) result.push(section('property', 'Fastigheten', ...propertyFields.map(({ key, title }) => `${title}: ${d.property![key]}`)))
  else result.push(section('property', 'Fastigheten', s.propertyAddress, d ? contractEntryText(d.fields.property) : ''))
  const assignment = d?.assignment
  result.push(section('assignment', 'Uppdraget', s.introduction, assignment?.additionalScope || ''))
  const documents = assignment?.documents ?? [], listedFiles = new Set(documents.map((doc) => doc.fileId))
  const documentRows = documents.flatMap((doc) => {
    const file = files.find((f) => f.id === doc.fileId)
    if (![doc.type, doc.name, doc.date].some((value) => value.trim()) && !file) return []
    return [[doc.type, doc.name || file?.fileName || '', doc.date]]
  })
  documentRows.push(...files.filter((f) => !listedFiles.has(f.id)).map((f) => ['Bilaga', f.fileName, '']))
  if (documentRows.length || assignment?.documentNotes) result.push({ ...section('assignment', 'Handlingar som ingår i uppdraget', assignment?.documentNotes || ''),
    columns: ['Typ av handling', 'Handlingens namn', 'Datum'], columnWidths: [0.25, 0.57, 0.18], rows: documentRows })
  if (d && !assignment) result.push(section('assignment', 'Avtalshandlingar', contractEntryText(d.fields.documents)))
  const included = s.items.filter((i) => i.kind === 'included')
  result.push(labelledSection('assignment', 'Arbetets omfattning', included.map((item) => ({ label: item.title, text: item.scope })), true))
  result.push(labelledSection('assignment', 'Förutsättningar för arbetena', included.map((item) => ({ label: item.title, text: item.scopeConditions || '' }))))
  result.push(labelledSection('assignment', 'Entreprenörens åtagande omfattar inte', [
    { text: assignment?.exclusions || '' }, ...included.map((item) => ({ label: item.title, text: item.scopeExclusions || '' })),
    ...s.items.filter((i) => i.kind === 'excluded').map((item) => ({ label: item.title,
      text: [item.scope, item.scopeConditions, item.scopeExclusions, item.scopeAdvice].filter(Boolean).join('\n\n') })),
    ...(s.contractForm === 'abs18' && assignment?.standardConditions?.text ? [{ label: 'Beställarens ansvar och avgifter', text: assignment.standardConditions.text }] : []),
  ]))
  result.push(labelledSection('assignment', 'Avrådan för arbetsdelar', included.map((item) => ({ label: item.title, text: item.scopeAdvice || '' }))))
  if (d) {
    for (const { key, title } of contractFields.filter(({ key }) => key === 'workEnvironment'))
      result.push(section('workEnvironment', title, contractEntryText(d.fields[key])))
    if (!p) result.push(section('parties', 'Parternas kompletterande uppgifter', contractEntryText(d.fields.parties)))
    if (d.advice.work || d.advice.reason) result.push(labelledSection('advice', 'Avrådande', [
      { label: 'Arbeten som avrådandet gäller', text: d.advice.work }, { label: 'På grund av', text: d.advice.reason }]))
  }
  const price = s.contractPricing
  if (price) {
    const fixed = contractFixedRows(price), running = price.rows.filter((r) => price.mode === 'running' || r.kind === 'running')
    if (price.mode !== 'running') {
      const rows: string[][] = [], columns = price.display === 'unpriced' ? ['Moment'] : price.split === 'combined' ? ['Moment', 'Pris inkl. moms'] : ['Moment', 'Arbete', 'Material', 'Totalt inkl. moms']
      const sum = (key: 'labourOre' | 'materialOre') => fixed.length && fixed.every((r) => r[key] !== null) ? fixed.reduce((t, r) => t + r[key]!, 0) : null
      if (price.display !== 'total') for (const r of fixed) rows.push(price.display === 'unpriced' ? [r.title] : price.split === 'combined' ? [r.title, pdfMoney(contractRowAmount(price, r))] : [r.title, pdfMoney(r.labourOre), pdfMoney(r.materialOre), pdfMoney(contractRowAmount(price, r))])
      rows.push(price.display === 'unpriced' || price.split === 'combined' ? ['Totalsumma inkl. moms', pdfMoney(contractFixedAmount(price))] : ['Totalsumma inkl. moms', pdfMoney(price.basis === 'total' ? price.labourOre : sum('labourOre')), pdfMoney(price.basis === 'total' ? price.materialOre : sum('materialOre')), pdfMoney(contractFixedAmount(price))])
      result.push({ ...section('price', price.mode === 'mixed' ? 'Fast del av priset' : 'Priset - fast pris'), columns: price.display === 'total' ? price.split === 'combined' ? ['Pris', 'Inkl. moms'] : ['Pris', 'Arbete', 'Material', 'Totalt inkl. moms'] : price.display === 'unpriced' ? ['Moment', ''] : columns, rows, totalRow: true,
        numericColumns: price.split === 'separate' && price.display !== 'unpriced' ? [1, 2, 3] : [1], columnWidths: price.split === 'separate' && price.display !== 'unpriced' ? [0.4, 0.2, 0.2, 0.2] : [0.68, 0.32] })
    }
    if (price.mode !== 'fixed') result.push(section('price', 'Löpande räkning', ...running.map((r) => r.title),
      `Timpris inklusive arvode och moms: ${pdfMoney(price.running.hourlyOre)}`, `Arbetsledning: ${pdfMoney(price.running.managementOre ?? price.running.hourlyOre)}/timme`,
      `Entreprenörarvode på självkostnader exklusive moms: ${price.running.markupPercent ?? ''} %. Moms tillkommer.`, price.running.approximateOre === null ? '' : `Ungefärligt pris inklusive moms: ${money(price.running.approximateOre)}`))
  } else result.push({ ...section('price', 'Priset'), columns: ['Moment', 'Pris inkl. moms'], numericColumns: [1], columnWidths: [0.68, 0.32], totalRow: true, rows: [...(s.pricingMode === 'itemized' ? s.items.filter((i) => i.kind === 'included').map((i) => [i.title, pdfMoney(i.amountOre)]) : []), ['Totalsumma', pdfMoney(customerOfferBaseAmount(s))]] })
  const changes = d?.changesPricing
  if (changes) {
    result.push(section('changes', 'Ändringar och tilläggsarbeten', changes.standardText, changes.notes))
    if (changes.mode === 'attachment') result.push(section('changes', 'Prisbilaga för ÄTA', changes.annex ? `${changes.annex.type}: ${changes.annex.name}\nDatum: ${changes.annex.date}\nVersion: ${changes.annexRevision}` : ''))
    else {
      result.push({ ...section('changes', 'ÄTA - timpriser'), columns: ['Arbete', 'Kr/timme inkl. arvode och moms'], numericColumns: [1], columnWidths: [0.58, 0.42], rows: changes.rates.map((r) => [r.title, pdfMoney(r.hourlyOre)]) })
      result.push({ ...section('changes', 'ÄTA - påslag på självkostnad exklusive moms'), columns: ['Kostnadsslag', 'Påslag'], numericColumns: [1], columnWidths: [0.75, 0.25], rows: changeMarkupFields.map(({ key, title }) => [title, changes.markups[key] === null ? '' : `${changes.markups[key]} %`]) })
    }
  } else if (d) result.push(section('changes', 'Ändringar och tilläggsarbeten', contractEntryText(d.fields.changes)))
  const paymentText = paymentConditionsText(s.paymentConditions, s.paymentTerms)
  if (s.paymentPlan?.installments.length) result.push({ ...section('payments', 'Tid för betalning'), columns: ['Moment', 'Planerat datum', 'Belopp inkl. moms'], numericColumns: [2], columnWidths: [0.55, 0.2, 0.25], totalRow: true, rows: [
    ...s.paymentPlan.installments.map((r, i) => [`${i + 1}. ${r.title}`, r.plannedDate, pdfMoney(r.amountOre)]),
    ['Summa', '', pdfMoney(s.paymentPlan.installments.every((r) => r.amountOre !== null) ? s.paymentPlan.installments.reduce((t, r) => t + r.amountOre!, 0) : null)]],
    afterTable: s.paymentPlan.installments.flatMap((r, i) => r.condition.trim() ? [r.kind === 'final' ? r.condition : `${i + 1}. ${r.title}: ${r.condition}`] : []) })
  result.push(section('payments', 'Betalningsvillkor', paymentText))
  result.push(section('schedule', 'Tid för arbetenas påbörjande och avslutande', s.schedule))
  if (d) for (const { key, title } of contractFields) if (key === 'delay' || key === 'inspection' || key === 'insurance' || key === 'completionProtection' || key === 'security') result.push(section(key, title, contractEntryText(d.fields[key])))
  result.push(section('other', 'Övrigt', s.terms, d?.otherAgreements ?? (d ? contractEntryText(d.fields.customerWork) : ''), d?.advice.customerResponse ? `Beställarens tidigare besked om avrådan\n${d.advice.customerResponse}` : ''))
  for (const { key, title } of siteFacilityFields) if (siteFacilityUsed(d?.siteFacilities?.entries[key])) {
    const entry = d!.siteFacilities!.entries[key]!
    result.push(section('siteFacilities', `Arbetsplatsens förutsättningar - ${title}`, `Ordnas av: ${siteFacilityPartyLabel(entry.providedBy)}\nBekostas av: ${siteFacilityPartyLabel(entry.paidBy)}`, entry.details))
  }
  return result.filter((r) => r.paragraphs.length || r.rows?.length)
}

const h = React.createElement
const pageWidth = 595.28 - 2 * 48
const contentWidth = pageWidth - 26
const tableFontSize = 10.5
const styles = StyleSheet.create({
  page: { paddingTop: 70, paddingBottom: 54, paddingHorizontal: 48, fontFamily: 'HusHubManrope', fontSize: 11, lineHeight: 1.4, color: '#252A2D' },
  cover: { paddingTop: 70 },
  masthead: { flexDirection: 'row', justifyContent: 'space-between', gap: 14, borderBottomWidth: 1, borderBottomColor: '#252A2D', paddingBottom: 10, marginBottom: 15, marginTop: -38 },
  issuer: { fontSize: 9, fontWeight: 700, flexGrow: 1, flexBasis: 0 },
  accent: { height: 3, width: 42, backgroundColor: '#F2D76A', marginTop: -18, marginBottom: 15 },
  contractType: { fontSize: 23, fontWeight: 700, lineHeight: 1.2, marginBottom: 4 },
  formLabel: { fontSize: 13, fontWeight: 700, lineHeight: 1.2, marginBottom: 10 },
  title: { fontSize: 16, fontWeight: 600, lineHeight: 1.2, marginBottom: 5 },
  sectionFrame: { borderWidth: 1, borderColor: '#AEB8B9', paddingHorizontal: 12, marginTop: 14, marginBottom: 12 },
  coverFrame: { marginTop: 10, marginBottom: 2, paddingBottom: 8 },
  band: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#F8E9AA', borderBottomWidth: 1, borderBottomColor: '#C9B867', padding: '8 12', marginHorizontal: -12, marginBottom: 12 },
  number: { fontSize: 13, fontWeight: 700, color: '#252A2D', width: 26 },
  heading: { fontSize: 13, fontWeight: 700, flexGrow: 1, flexBasis: 0 },
  subheading: { fontSize: 12, fontWeight: 700, marginTop: 16, marginBottom: 12, backgroundColor: '#FCF7E8', borderLeftWidth: 3, borderLeftColor: '#C9B867', borderBottomWidth: 0.8, borderBottomColor: '#AEB8B9', padding: '7 9' },
  blockLabel: { fontSize: 12, fontWeight: 700, marginTop: 12, marginBottom: 5 },
  text: { marginBottom: 10 },
  paragraph: { width: 420 },
  columns: { flexDirection: 'row', gap: 22 },
  column: { flexGrow: 1, flexBasis: 0, minWidth: 0 },
  partyTitle: { fontSize: 11, fontWeight: 700, lineHeight: 1.25, marginBottom: 8 },
  partyName: { fontSize: 12, fontWeight: 600, lineHeight: 1.3, marginBottom: 5 },
  fact: { marginBottom: 5 },
  factLabel: { fontSize: 9.5, fontWeight: 600, lineHeight: 1.25, color: '#596368', marginBottom: 3 },
  factValue: { fontSize: 11, lineHeight: 1.35 },
  blankLine: { height: 22, borderBottomWidth: 0.5, borderBottomColor: '#D5DCDD' },
  taxOptions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  taxOption: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  checkbox: { width: 9, height: 9, borderWidth: 0.8, borderColor: '#596368' },
  facts: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 22 },
  halfFact: { width: (contentWidth - 22) / 2 },
  table: { marginBottom: 8 },
  row: { flexDirection: 'row', borderBottomWidth: 0.8, borderBottomColor: '#AEB8B9', alignItems: 'flex-start' },
  cell: { padding: '7 7', fontSize: tableFontSize, lineHeight: 1.4, minHeight: 29 },
  tableHeader: { backgroundColor: '#EDF1F1', fontWeight: 600, color: '#596368', fontSize: 10 },
  totalRow: { backgroundColor: '#F4F6F6', fontWeight: 700, borderTopWidth: 0.8, borderTopColor: '#596368' },
  runningHeader: { position: 'absolute', top: 25, left: 48, right: 48, height: 31, color: '#596368', borderBottomWidth: 0.5, borderBottomColor: '#D5DCDD' },
  headerText: { fontSize: 9, lineHeight: 1.25 },
  footer: { position: 'absolute', bottom: 24, left: 48, right: 48, height: 18, color: '#596368', borderTopWidth: 0.5, borderTopColor: '#D5DCDD', paddingTop: 6 },
  footerText: { fontSize: 9, lineHeight: 1.2, textAlign: 'right' },
  signingDate: { marginTop: 14, marginBottom: 5, fontSize: 11 },
  signature: { marginTop: 36, borderTopWidth: 0.5, borderTopColor: '#596368', paddingTop: 5, fontSize: 9 },
  signatureCaption: { fontSize: 8, color: '#596368', marginBottom: 4 },
})
const clean = (v: string) => v.replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').replace(/[\u2011\u2013\u2014]/g, '-')
const hyphenationCallback = (word: string) => word.length > 35 ? word.match(/.{1,12}/gu) || [word] : [word]
const text = (v: string, props = {}) => h(Text, { style: styles.text, orphans: 3, widows: 3, hyphenationCallback, ...props }, clean(v))
let fontsRegistered = false
function registerFonts() {
  if (fontsRegistered) return
  Font.register({ family: 'HusHubManrope', fonts: [400, 600, 700].map((fontWeight) => ({
    src: join(process.cwd(), 'public/uppdrag/brand/pdf', `Manrope-${fontWeight}.ttf`), fontWeight,
  })) })
  fontsRegistered = true
}

const groupOrder: SectionGroup[] = ['parties', 'controls', 'property', 'assignment', 'workEnvironment', 'advice', 'price', 'changes', 'payments', 'schedule', 'delay', 'inspection', 'insurance', 'completionProtection', 'security', 'other', 'siteFacilities']
const band = (number: number, title: string) => h(View, { style: styles.band, wrap: false, minPresenceAhead: 85 },
  text(String(number).padStart(2, '0'), { style: styles.number }), text(title, { style: styles.heading, bookmark: `${number}. ${title}` }))
const fact = (label: string, value: string, props = {}) => h(View, { style: styles.fact, ...props },
  text(label, { style: styles.factLabel }), value.trim() ? text(value, { style: styles.factValue }) : h(View, { style: styles.blankLine }))

function paragraphs(value: string) {
  return clean(value).split(/\n\s*\n/).filter((p) => p.trim()).map((p, key) => text(p, {
    key, style: [styles.text, styles.paragraph], wrap: p.length > 650 || p.split('\n').length > 10,
  }))
}

// Font metrics and the same word breaks bound chunk size, including long file names.
function tableChunks(part: SigningPdfSection) {
  const widths = part.columnWidths ?? (part.columns ?? []).map(() => 1 / (part.columns?.length || 1))
  const font = Font.getFont({ fontFamily: 'HusHubManrope', fontWeight: 700 }).data!
  const measured = new Map<string, number>()
  const measure = (value: string) => {
    if (!measured.has(value)) measured.set(value, font.layout(value).positions.reduce((sum: number, p: { xAdvance: number }) => sum + p.xAdvance, 0) * tableFontSize / font.unitsPerEm)
    return measured.get(value)!
  }
  const lines = (value: string, width: number) => clean(value).split('\n').reduce((sum, line) => {
    let count = 1, used = 0
    for (const word of line.split(/\s+/)) for (const [i, piece] of hyphenationCallback(word).entries()) {
      const size = measure(piece + (piece !== word ? '-' : '')), space = used && i === 0 ? measure(' ') : 0
      if (used && used + space + size > width) { count++; used = size } else used += space + size
    }
    return sum + count
  }, 0)
  const chunks: { rows: string[][]; first: number; height: number }[] = []
  let rows: string[][] = [], height = 45, first = 0
  for (const [i, row] of (part.rows ?? []).entries()) {
    const rowHeight = Math.max(1, ...row.map((cell, j) => lines(cell, contentWidth * (widths[j] ?? 0.5) - 14))) * 15 + 14
    if (rows.length && height + rowHeight > 400 && !(part.totalRow && i === part.rows!.length - 1)) {
      chunks.push({ rows, first, height }); rows = []; height = 45; first = i
    }
    rows.push(row); height += rowHeight
  }
  if (rows.length) chunks.push({ rows, first, height })
  return chunks
}

function table(part: SigningPdfSection) {
  const columns = part.columns ?? [], widths = part.columnWidths ?? columns.map(() => 1 / columns.length)
  const cell = (value: string, j: number, header = false) => text(value, {
    key: j, style: [styles.cell, { width: `${widths[j] * 100}%`, textAlign: part.numericColumns?.includes(j) ? 'right' : 'left' }, ...(header ? [styles.tableHeader] : [])],
  })
  return tableChunks(part).map((chunk, i) => h(View, { key: `table-${i}`, style: styles.table, wrap: chunk.height > 500 },
    h(View, { style: [styles.row, styles.tableHeader], wrap: false, minPresenceAhead: 35 }, ...columns.map((c, j) => cell(c, j, true))),
    ...chunk.rows.map((row, k) => h(View, { key: k, style: [styles.row, ...(part.totalRow && chunk.first + k === part.rows!.length - 1 ? [styles.totalRow] : [])], wrap: chunk.height > 500 },
      ...columns.map((_, j) => cell(row[j] ?? '', j))))))
}

function renderSection(part: SigningPdfSection, heading?: string, groupHeading?: React.ReactElement): React.ReactElement[] {
  const blocks = part.blocks ?? part.paragraphs.map((p) => ({ text: p } as ParagraphBlock))
  const headings = [
    ...(groupHeading ? [groupHeading] : []),
    ...(heading ? [text(heading, { style: styles.subheading, minPresenceAhead: 100 })] : []),
  ]
  const tables = part.rows?.length ? table(part) : []
  const content = blocks.flatMap((block, key) => {
      const [first = '', ...rest] = clean(block.text).split(/\n\s*\n/).filter((p) => p.trim())
      const opening = [
        ...(key === 0 ? headings : []),
        ...(block.label ? [h(View, { wrap: false, minPresenceAhead: 75 }, text(block.label, { style: styles.blockLabel }))] : []),
        ...(first ? paragraphs(first) : [h(View, { style: [styles.blankLine, styles.paragraph] })])]
      // Page-level siblings let heading hints keep the start of long paragraphs together.
      return [...(first.length > 650 || first.split('\n').length > 10 ? opening.map((node, i) => React.cloneElement(node, { key: `block-${key}-opening-${i}` }))
        : [h(View, { key: `block-${key}`, wrap: false }, ...opening)]),
      ...paragraphs(rest.join('\n\n')).map((p, i) => React.cloneElement(p, { key: `block-${key}-paragraph-${i}` }))]
    })
  const afterTable = part.afterTable?.flatMap((value, i) => paragraphs(value).map((p, j) => React.cloneElement(p, { key: `after-table-${i}-${j}` }))) ?? []
  if (tables.length && blocks.every((b) => !b.label) && part.paragraphs.join('').length <= 500) return [
    h(View, { wrap: (tableChunks(part)[0]?.height ?? 0) > 500 }, ...(!content.length ? headings : []), ...content, tables[0]), ...tables.slice(1), ...afterTable]
  return [...content, ...tables, ...afterTable]
}

function renderParties(s: CustomerOfferSnapshot, parts: SigningPdfSection[]) {
  const p = s.contractParties
  if (!p) return h(View, {}, h(View, { style: styles.columns },
    h(View, { style: styles.column }, text('Beställare (konsument)', { style: styles.partyTitle }), fact('Namn', s.customerName), fact('E-post', s.customerEmail)),
    h(View, { style: styles.column }, text('Entreprenör (näringsidkare)', { style: styles.partyTitle }), fact('Företag', s.issuerName), fact('E-post', s.replyEmail))),
    ...parts.filter((part) => part.title === 'Parternas kompletterande uppgifter').map((part, i) => h(View, { key: i }, renderSection(part))))
  const c = p.contractor
  return h(View, { style: styles.columns },
    h(View, { style: styles.column }, text('Beställare (konsument)', { style: styles.partyTitle }),
      ...p.customers.map((customer, i) => h(View, { key: i, style: styles.fact, wrap: false }, customer.name.trim() ? text(customer.name, { style: styles.partyName }) : fact('Namn', ''),
        ...(customer.personalNumber ? [fact('Personnummer', customer.personalNumber)] : []))),
      fact('Adress', [p.street, `${p.postalCode} ${p.city}`.trim()].filter(Boolean).join('\n')),
      fact('E-post', p.email), fact('Telefon / mobil', [p.phone, p.mobile].filter(Boolean).join(' / '))),
    h(View, { style: styles.column }, text('Entreprenör (näringsidkare)', { style: styles.partyTitle }), c.companyName.trim() ? text(c.companyName, { style: styles.partyName }) : fact('Företag', ''),
      fact('Organisationsnummer', c.organizationNumber), fact('Adress', [c.street, `${c.postalCode} ${c.city}`.trim()].filter(Boolean).join('\n')),
      fact('Kontaktperson', c.contactName), fact('E-post', c.email), fact('Telefon / mobil', [c.phone, c.mobile].filter(Boolean).join(' / ')),
      ...(c.fax ? [fact('Fax', c.fax)] : []), c.fTax === 'yes' || c.fTax === 'no' ? fact('Godkänd för F-skatt', c.fTax === 'yes' ? 'Ja' : 'Nej')
        : h(View, { style: styles.fact }, text('Godkänd för F-skatt', { style: styles.factLabel }),
          h(View, { style: styles.taxOptions }, ...['Ja', 'Nej'].map((label) => h(View, { key: label, style: styles.taxOption },
            h(View, { style: styles.checkbox }), text(label, { style: styles.factValue })))))))
}

export function contractSigningHeading(s: CustomerOfferSnapshot) {
  return { title: s.contractForm === 'abs18' ? 'ENTREPRENADKONTRAKT' : 'ENTREPRENADAVTAL',
    form: s.contractForm === 'abs18' ? 'ABS 18' : 'Särskilda villkor' }
}

export async function renderContractSigningPdf(input: SigningPdfInput): Promise<Buffer> {
  registerFonts()
  await Font.load({ fontFamily: 'HusHubManrope', fontWeight: 700 })
  const { snapshot: s } = input
  const customers = s.contractParties?.customers.length ? s.contractParties.customers : [{ name: s.customerName }]
  const heading = contractSigningHeading(s), parts = contractSigningSections(input)
  const groups = groupOrder.filter((group) => parts.some((part) => part.group === group))
  const number = (group: SectionGroup) => groups.indexOf(group) + 1
  // Fresh text nodes keep line height stable during dynamic pagination passes.
  const footer = () => h(View, { fixed: true, style: styles.footer,
    render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages?: number }) => h(Text, { style: styles.footerText }, `Sida ${pageNumber} av ${totalPages ?? ''}`) })
  const header = (context: string, hideOnFirst = false) => h(View, { fixed: true, style: [styles.runningHeader, ...(hideOnFirst ? [{ borderBottomWidth: 0 }] : [])],
    render: ({ subPageNumber }) => hideOnFirst && subPageNumber === 1 ? null : h(Text, { style: styles.headerText }, `${heading.title} / ${heading.form}${s.title ? ` / ${clean(s.title)}` : ''}\n${context}${subPageNumber > 1 ? ' - fortsättning' : ''}`) })
  const coverParts = parts.filter((part) => ['parties', 'controls', 'property'].includes(part.group))
  const property = s.contractDetails?.property
  const participants = s.contractDetails?.controlParticipants
  const compactParticipants = participants && contractParticipantFields.every(({ key }) => participants[key].length <= 350 && participants[key].split('\n').length <= 4)
  const bodyGroups = groups.filter((group) => !['parties', 'controls', 'property', 'assignment'].includes(group))
  const assignment = parts.filter((part) => part.group === 'assignment')
  let assignmentNumber = 0
  const body = bodyGroups.map((group) => {
    const members = parts.filter((part) => part.group === group)
    const title = group === 'siteFacilities' ? 'Arbetsplatsens förutsättningar' : group === 'payments' ? 'Tid för betalning' : members[0].title
    return h(View, { key: group, style: styles.sectionFrame }, ...members.map((part, i) => h(React.Fragment, { key: i },
      ...renderSection(part, i > 0 || group === 'siteFacilities' ? part.title : undefined, i === 0 ? band(number(group), title) : undefined))))
  })
  const signature = (name: string, role: string, detail?: string) => h(View, {},
    h(View, { style: styles.signature, wrap: false }, text('Underskrift', { style: styles.signatureCaption }), ...(name.trim() ? [text(name, { style: styles.partyName })] : []),
      text(role, { style: styles.signatureCaption }), ...(detail ? [text(detail, { style: styles.signatureCaption })] : [])))
  const document = h(Document, { title: `${heading.title} - ${heading.form}${s.title ? ` - ${s.title}` : ''}`, author: s.issuerName, creator: 'HusHub', language: 'sv-SE', creationDate: new Date(input.createdAt), modificationDate: new Date(input.createdAt) },
    h(Page, { size: 'A4', style: [styles.page, styles.cover], wrap: true },
      h(View, { style: styles.masthead }, text(s.contractParties?.contractor.companyName || s.issuerName || 'Entreprenör', { style: styles.issuer })),
      h(View, { style: styles.accent }), text(heading.title, { style: styles.contractType }), text(heading.form, { style: styles.formLabel }),
      ...(s.title ? [text(s.title, { style: styles.title })] : []),
      h(View, { style: [styles.sectionFrame, styles.coverFrame] }, band(number('parties'), 'Avtalsparter'), renderParties(s, coverParts)),
      ...(groups.includes('controls') ? [h(View, { style: [styles.sectionFrame, styles.coverFrame], wrap: !compactParticipants },
        ...(compactParticipants ? [band(number('controls'), 'Övriga medverkande'), h(View, { style: styles.columns }, ...contractParticipantFields.map(({ key, title }) => h(View, { key, style: styles.column }, fact(title, participants![key]))))]
          : renderSection(coverParts.find((part) => part.group === 'controls')!, undefined, band(number('controls'), 'Övriga medverkande'))))] : []),
      ...(groups.includes('property') ? [h(View, { style: [styles.sectionFrame, styles.coverFrame], wrap: !property }, band(number('property'), 'Fastigheten'), property
        ? h(View, { style: styles.facts }, ...propertyFields.map(({ key, title }) => fact(title, property[key], { key, style: [styles.fact, styles.halfFact] })))
        : renderSection(coverParts.find((part) => part.group === 'property')!))] : []),
      header('Avtalsparter, medverkande och fastighet', true), footer()),
    h(Page, { size: 'A4', style: styles.page, wrap: true }, header('Uppdrag och avtalsvillkor'),
      ...(assignment.length ? [h(View, { style: styles.sectionFrame },
        ...assignment.map((part, i) => h(React.Fragment, { key: `assignment-${i}` }, ...renderSection(part, part.title === 'Uppdraget' ? undefined : `${number('assignment')}.${++assignmentNumber}. ${part.title}`, i === 0 ? band(number('assignment'), 'Uppdraget') : undefined))))] : []),
      ...body,
      h(View, { style: [styles.sectionFrame, { paddingBottom: 12 }], wrap: false }, band(groups.length + 1, 'Underskrifter'),
        text('Ort och datum: ____________________________________________________', { style: styles.signingDate }),
        h(View, { style: styles.columns }, ...customers.map((c, i) => h(View, { key: i, style: styles.column }, signature(c.name, `Beställare ${i + 1}`)))),
        signature(s.contractParties?.contractor.companyName || s.issuerName, 'Entreprenör', s.contractParties?.contractor.contactName)), footer())) as React.ReactElement<DocumentProps>
  return renderPdfDocument(document)
}
