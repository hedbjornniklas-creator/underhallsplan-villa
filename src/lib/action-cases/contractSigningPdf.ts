import React from 'react'
import { Document, Page, StyleSheet, Text, View, type DocumentProps } from '@react-pdf/renderer'
// @ts-expect-error Explicit extensions support the shared Node PDF test runner.
import { renderPdfDocument } from '../pdf/renderDocument.ts'
// @ts-expect-error Explicit extensions support the shared Node PDF test runner.
import { customerOfferBaseAmount, customerPriceLabel, money, type CustomerOfferSnapshot, type CustomerOfferFile } from './customerOffers.ts'
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

export type SigningPdfInput = { id: string; version: number; draftRevision?: number; createdAt: string; snapshot: CustomerOfferSnapshot; files: CustomerOfferFile[] }
export type SigningPdfSection = { title: string; paragraphs: string[]; columns?: string[]; rows?: string[][] }
const section = (title: string, ...paragraphs: string[]): SigningPdfSection => ({ title, paragraphs: paragraphs.filter((v) => v.trim()) })

// Only saved customer-facing fields are projected, never costing or current defaults.
export function contractSigningSections({ snapshot: s, files, draftRevision }: SigningPdfInput): SigningPdfSection[] {
  const result: SigningPdfSection[] = [], d = s.contractDetails, p = s.contractParties
  if (p) {
    result.push(section('Beställare', ...p.customers.map((c, i) => `Beställare ${i + 1}: ${c.name}${c.personalNumber ? `\nPersonnummer: ${c.personalNumber}` : ''}`),
      `${p.street}\n${p.postalCode} ${p.city}`, `Telefon: ${p.phone || '-'}\nMobiltelefon: ${p.mobile || '-'}\nE-post: ${p.email}`))
    const c = p.contractor
    result.push(section('Entreprenör', `${c.companyName}\nOrganisationsnummer: ${c.organizationNumber}`, `${c.street}\n${c.postalCode} ${c.city}`,
      `Kontaktperson: ${c.contactName || '-'}\nTelefon: ${c.phone || '-'}\nMobiltelefon: ${c.mobile || '-'}\nFax: ${c.fax || '-'}\nE-post: ${c.email}\nF-skatt: ${c.fTax === 'yes' ? 'Ja' : c.fTax === 'no' ? 'Nej' : 'Ej angivet'}`))
  } else result.push(section('Parter', `Beställare: ${s.customerName}\n${s.customerEmail}`, `Entreprenör: ${s.issuerName}\n${s.replyEmail}`))
  if (d?.controlParticipants) result.push(section('Övriga medverkande', ...contractParticipantFields.map(({ key, title }) => `${title}\n${d.controlParticipants![key] || 'Ej angivet'}`)))
  if (d?.property) result.push(section('Fastigheten', ...propertyFields.filter(({ key }) => d.property![key]).map(({ key, title }) => `${title}: ${d.property![key]}`)))
  else result.push(section('Fastigheten', s.propertyAddress, d ? contractEntryText(d.fields.property) : ''))
  const assignment = d?.assignment
  result.push(section('Uppdraget', s.introduction, assignment?.additionalScope || ''))
  if (assignment) result.push({ ...section('Handlingar som ingår i uppdraget', assignment.documentNotes), columns: ['Typ av handling', 'Handlingens namn', 'Datum'],
    rows: assignment.documents.map((doc) => [doc.type, doc.name, doc.date]) })
  for (const item of s.items.filter((i) => i.kind === 'included')) result.push(section(item.title, item.scope,
    ...([['scopeConditions', 'Förutsättningar'], ['scopeExclusions', 'Ingår inte'], ['scopeAdvice', 'Avrådan']] as const)
      .flatMap(([key, title]) => item[key]?.trim() ? [`${title}\n${item[key]}`] : [])))
  if (assignment?.exclusions) result.push(section('Entreprenörens åtagande omfattar inte', assignment.exclusions))
  for (const item of s.items.filter((i) => i.kind === 'excluded')) result.push(section(`Ingår inte: ${item.title}`, item.scope, item.scopeConditions || '', item.scopeExclusions || '', item.scopeAdvice || ''))
  if (s.contractForm === 'abs18' && assignment?.standardConditions?.text) result.push(section('Standardtexter för uppdraget', assignment.standardConditions.text))
  if (d) {
    for (const { key, title } of contractFields.filter(({ key }) => key === 'workEnvironment'))
      result.push(section(title, contractEntryText(d.fields[key])))
    if (!d.controlParticipants) result.push(section('Övriga medverkande', contractEntryText(d.fields.controls)))
    if (!assignment) result.push(section('Avtalshandlingar', contractEntryText(d.fields.documents)))
    if (!p) result.push(section('Parternas kompletterande uppgifter', contractEntryText(d.fields.parties)))
    if (d.advice.work || d.advice.reason) result.push(section('Avrådande', `Arbeten som avrådandet gäller\n${d.advice.work}`, `På grund av\n${d.advice.reason}`))
  }
  const price = s.contractPricing
  if (price) {
    const fixed = contractFixedRows(price), running = price.rows.filter((r) => price.mode === 'running' || r.kind === 'running')
    if (price.mode !== 'running') {
      const rows: string[][] = [], columns = price.display === 'unpriced' ? ['Moment'] : price.split === 'combined' ? ['Moment', 'Pris inkl. moms'] : ['Moment', 'Arbete', 'Material', 'Totalt inkl. moms']
      const sum = (key: 'labourOre' | 'materialOre') => fixed.length && fixed.every((r) => r[key] !== null) ? fixed.reduce((t, r) => t + r[key]!, 0) : null
      if (price.display !== 'total') for (const r of fixed) rows.push(price.display === 'unpriced' ? [r.title] : price.split === 'combined' ? [r.title, money(contractRowAmount(price, r))] : [r.title, money(r.labourOre), money(r.materialOre), money(contractRowAmount(price, r))])
      rows.push(price.display === 'unpriced' || price.split === 'combined' ? ['Totalsumma inkl. moms', money(contractFixedAmount(price))] : ['Totalsumma inkl. moms', money(price.basis === 'total' ? price.labourOre : sum('labourOre')), money(price.basis === 'total' ? price.materialOre : sum('materialOre')), money(contractFixedAmount(price))])
      result.push({ ...section(price.mode === 'mixed' ? 'Fast del av priset' : 'Priset - fast pris'), columns: price.display === 'total' ? price.split === 'combined' ? ['Pris', 'Inkl. moms'] : ['Pris', 'Arbete', 'Material', 'Totalt inkl. moms'] : price.display === 'unpriced' ? ['Moment', ''] : columns, rows })
    }
    if (price.mode !== 'fixed') result.push(section('Löpande räkning', ...running.map((r) => r.title),
      `Timpris inklusive arvode och moms: ${money(price.running.hourlyOre)}`, `Arbetsledning: ${money(price.running.managementOre ?? price.running.hourlyOre)}/timme`,
      `Entreprenörarvode på självkostnader exklusive moms: ${price.running.markupPercent ?? '-'} %. Moms tillkommer.`, price.running.approximateOre === null ? '' : `Ungefärligt pris inklusive moms: ${money(price.running.approximateOre)}`))
  } else result.push({ ...section('Priset'), columns: ['Moment', 'Pris inkl. moms'], rows: [...(s.pricingMode === 'itemized' ? s.items.filter((i) => i.kind === 'included').map((i) => [i.title, money(i.amountOre)]) : []), ['Totalsumma', money(customerOfferBaseAmount(s))]] })
  const changes = d?.changesPricing
  if (changes) {
    result.push(section('Ändringar och tilläggsarbeten', changes.standardText, changes.notes))
    if (changes.mode === 'attachment') result.push(section('Prisbilaga för ÄTA', changes.annex ? `${changes.annex.type}: ${changes.annex.name}\nDatum: ${changes.annex.date}\nVersion: ${changes.annexRevision}` : ''))
    else {
      result.push({ ...section('ÄTA - timpriser'), columns: ['Arbete', 'Kr/timme inkl. arvode och moms'], rows: changes.rates.map((r) => [r.title, money(r.hourlyOre)]) })
      result.push({ ...section('ÄTA - påslag på självkostnad exklusive moms'), columns: ['Kostnadsslag', 'Påslag'], rows: changeMarkupFields.map(({ key, title }) => [title, `${changes.markups[key] ?? '-'} %`]) })
    }
  } else if (d) result.push(section('Ändringar och tilläggsarbeten', contractEntryText(d.fields.changes)))
  result.push(section('Tid för betalning', paymentConditionsText(s.paymentConditions, s.paymentTerms)))
  if (s.paymentPlan) result.push({ ...section('Betalningsplan'), columns: ['Moment och faktureringsvillkor', 'Planerat datum', 'Belopp inkl. moms'], rows: [
    ...s.paymentPlan.installments.map((r, i) => [`${i + 1}. ${r.title}\n${r.condition}`, r.plannedDate || 'Ej planerat', money(r.amountOre)]),
    ['Summa', '', money(s.paymentPlan.installments.length && s.paymentPlan.installments.every((r) => r.amountOre !== null) ? s.paymentPlan.installments.reduce((t, r) => t + r.amountOre!, 0) : null)]] })
  result.push(section('Tid för arbetenas påbörjande och avslutande', s.schedule))
  if (d) for (const { key, title } of contractFields.filter(({ key }) => ['delay', 'inspection', 'insurance', 'completionProtection', 'security'].includes(key))) result.push(section(title, contractEntryText(d.fields[key])))
  result.push(section('Övrigt', s.terms, d?.otherAgreements ?? (d ? contractEntryText(d.fields.customerWork) : ''), d?.advice.customerResponse ? `Beställarens tidigare besked om avrådan\n${d.advice.customerResponse}` : ''))
  for (const { key, title } of siteFacilityFields) if (siteFacilityUsed(d?.siteFacilities?.entries[key])) {
    const entry = d!.siteFacilities!.entries[key]!
    result.push(section(`Arbetsplatsens förutsättningar - ${title}`, `Ordnas av: ${siteFacilityPartyLabel(entry.providedBy)}\nBekostas av: ${siteFacilityPartyLabel(entry.paidBy)}`, entry.details))
  }
  if (files.length) result.push({ ...section(draftRevision === undefined ? 'Bilagor - låsta separata dokument' : 'Bilagor - separata dokument', 'Bilagorna nedan ingår enligt handlingsförteckningen och hämtas separat tillsammans med avtals-PDF:en. De är inte inbäddade i denna PDF.'), columns: ['Fil', 'Typ'], rows: files.map((f) => [f.fileName, f.contentType]) })
  return result.filter((r) => r.paragraphs.length || r.rows?.length)
}

const h = React.createElement
const styles = StyleSheet.create({
  page: { paddingTop: 38, paddingBottom: 52, paddingHorizontal: 40, fontFamily: 'Helvetica', fontSize: 10, lineHeight: 1.4, color: '#252A2D' },
  title: { fontSize: 20, fontWeight: 700, marginBottom: 10 }, heading: { fontSize: 12, fontWeight: 700, marginTop: 14, marginBottom: 6 },
  text: { marginBottom: 6 }, header: { fontSize: 8, color: '#596368', marginBottom: 14 }, row: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#D5DCDD' },
  cell: { padding: 5, flexGrow: 1, flexBasis: 0, fontSize: 9 }, band: { backgroundColor: '#EDF1F1', fontWeight: 700 },
  footer: { position: 'absolute', top: 797, left: 40, right: 40, color: '#596368', borderTopWidth: 0.5, borderTopColor: '#206961', paddingTop: 6 },
  signature: { marginTop: 26, borderTopWidth: 0.5, borderTopColor: '#252A2D', paddingTop: 6 },
})
const clean = (v: string) => v.replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').replace(/[\u2011\u2013\u2014]/g, '-')
const hyphenationCallback = (word: string) => word.length > 35 ? word.match(/.{1,30}/gu) || [word] : [word]
const text = (v: string, props = {}) => h(Text, { style: styles.text, orphans: 2, widows: 2, hyphenationCallback, ...props }, clean(v))

export async function renderContractSigningPdf(input: SigningPdfInput): Promise<Buffer> {
  const { snapshot: s, id, version } = input
  const draft = input.draftRevision !== undefined
  const label = draft ? `Avtalsutkast / Revision ${input.draftRevision}` : `Avtalsversion ${version} / ${id}`
  const date = new Date(input.createdAt).toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' })
  const customers = s.contractParties?.customers.length ? s.contractParties.customers : [{ name: s.customerName }]
  const document = h(Document, { title: s.title || 'Avtal', author: s.issuerName, creator: 'HusHub', language: 'sv-SE', creationDate: new Date(input.createdAt), modificationDate: new Date(input.createdAt) },
    h(Page, { size: 'A4', style: styles.page, wrap: true },
      text(`HusHub / Avtal för signering / ${draft ? 'Ej låst' : `Version ${version}`}`, { style: styles.header }),
      text(s.title || 'Avtal', { style: styles.title }), text(`${s.projectTitle}\n${s.propertyAddress}`),
      text(`Avtalsgrund: ${s.contractForm === 'abs18' ? 'ABS 18' : 'Särskilda villkor'}\n${draft ? `Ej låst - framställt ${date}` : `Låst ${date}`}\n${customerPriceLabel(s)}`),
      ...contractSigningSections(input).flatMap((part, index) => [
        text(part.title, { key: `h-${index}`, style: styles.heading, minPresenceAhead: 60 }),
        ...part.paragraphs.map((p, i) => text(p, { key: `p-${index}-${i}` })),
        ...(part.rows?.length ? [
          h(View, { key: `header-${index}`, style: [styles.row, styles.band], wrap: false, minPresenceAhead: 35 }, ...(part.columns || []).map((c, i) => text(c, { key: i, style: styles.cell }))),
          ...part.rows.map((r, i) => h(View, { key: `row-${index}-${i}`, style: styles.row, wrap: r.join('').length > 800 }, ...r.map((c, j) => text(c, { key: j, style: styles.cell }))))] : [])]),
      text('Underskrifter', { style: styles.heading, minPresenceAhead: 120 }),
      text('Ort och datum: ____________________________________________________'),
      ...customers.map((c, i) => h(View, { key: `customer-${i}`, style: styles.signature, wrap: false }, text(`Beställare ${i + 1}: ${c.name || '________________________'}`), text('Underskrift'))),
      h(View, { style: styles.signature, wrap: false }, text(`Entreprenör: ${s.contractParties?.contractor.companyName || s.issuerName}`), text(`Namnförtydligande: ${s.contractParties?.contractor.contactName || '________________________'}`), text('Underskrift')),
      h(View, { fixed: true, style: styles.footer }, h(Text, { style: { fontSize: 8, lineHeight: 1.2 }, render: ({ pageNumber, totalPages }) => `${label} / Sida ${pageNumber} av ${totalPages}` })))) as React.ReactElement<DocumentProps>
  return renderPdfDocument(document)
}
