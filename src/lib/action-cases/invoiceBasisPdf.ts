import { createElement as h } from 'react'
import { join } from 'node:path'
import { Document, Font, Page, StyleSheet, Text, View, type DocumentProps } from '@react-pdf/renderer'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
// @ts-expect-error Shared with Node strip-types PDF tests.
import { renderPdfDocument } from '../pdf/renderDocument.ts'
// @ts-expect-error Shared with Node strip-types PDF tests.
import { invoiceBasisTotals } from './projectCompletion.ts'
import type { InvoiceBasisRecord } from './projectCompletion'

let registered = false
const money = (ore: number) => `${(ore / 100).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`
const s = StyleSheet.create({
  page: { paddingTop: 54, paddingHorizontal: 40, paddingBottom: 52, fontFamily: 'InvoiceManrope', fontSize: 9.5, lineHeight: 1.4, color: '#252A2D' },
  top: { borderTopWidth: 5, borderTopColor: '#F2D76A', paddingTop: 12, marginBottom: 16 },
  title: { fontSize: 21, lineHeight: 1.25, fontWeight: 700, marginBottom: 6 }, meta: { fontSize: 9, color: '#596368', marginTop: 5 },
  parties: { flexDirection: 'row', marginBottom: 18 }, party: { width: '50%', paddingRight: 16 },
  label: { fontWeight: 700, marginBottom: 5 }, row: { flexDirection: 'row', borderBottomWidth: 0.7, borderBottomColor: '#AEB8B9' },
  header: { backgroundColor: '#EDF1F1', fontWeight: 600 }, cell: { padding: '6 4', fontSize: 8.5 },
  summary: { marginTop: 14, padding: 10, backgroundColor: '#FCF7E8' },
  total: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  note: { marginTop: 16 }, footer: { position: 'absolute', bottom: 23, left: 40, right: 40, height: 14, fontSize: 7, lineHeight: 1.2, color: '#596368' },
  continuation: { position: 'absolute', top: 22, left: 40, right: 40, height: 16, fontSize: 8, lineHeight: 1.2, color: '#596368' },
})
export async function renderInvoiceBasisPdf(record: InvoiceBasisRecord, projectTitle: string): Promise<Buffer> {
  if (!registered) {
    Font.register({ family: 'InvoiceManrope', fonts: [400, 600, 700].map(fontWeight => ({ src: join(process.cwd(), 'public/uppdrag/brand/pdf', `Manrope-${fontWeight}.ttf`), fontWeight })) })
    registered = true
  }
  const b = record.body, totals = invoiceBasisTotals(b)
  if (!totals.complete) throw new Error('PROJECT_ADMIN_PDF_INCOMPLETE')
  const widths = ['39%', '10%', '9%', '17%', '7%', '18%']
  const row = (cells: string[], key: string, header = false) => h(View, { key, style: header ? [s.row, s.header] : s.row, wrap: false, ...(header ? { minPresenceAhead: 32 } : {}) }, ...cells.map((value, i) => h(Text, { key: i, style: [s.cell, { width: widths[i], textAlign: i > 0 ? 'right' : 'left' }] }, value)))
  const document = h(Document, { title: b.title, author: b.issuer.split('\n')[0], language: 'sv-SE' } as DocumentProps,
    h(Page, { size: 'A4', style: s.page },
      h(Text, { style: s.continuation, fixed: true }, `${b.title} / ${b.date}`),
      h(View, { style: s.top }, h(Text, { style: s.title }, b.title), h(Text, { style: s.meta }, 'FAKTURAUNDERLAG - inte en faktura'), h(Text, { style: s.meta }, `${projectTitle} / ${b.date}`), b.period ? h(Text, { style: s.meta }, `Period: ${b.period}`) : null),
      h(View, { style: s.parties }, h(View, { style: s.party }, h(Text, { style: s.label }, 'Avsändare'), h(Text, {}, b.issuer)), h(View, { style: s.party }, h(Text, { style: s.label }, 'Fakturakund'), h(Text, {}, b.recipient))),
      row(['Beskrivning', 'Antal', 'Enhet', 'À-pris exkl.', 'Moms', 'Exkl. moms'], 'head', true),
      ...totals.lines.map(l => row([l.description, l.quantity!.toLocaleString('sv-SE'), l.unit, money(l.unitPriceOre!), `${l.vatRate} %`, money(l.netOre!)], l.id)),
      h(View, { style: s.summary, wrap: false }, ...[['Summa exklusive moms', totals.netOre], ['Moms', totals.vatOre], ['Summa inklusive moms', totals.grossOre]].map(([label, amount]) =>
        h(View, { style: s.total, key: String(label) }, h(Text, {}, String(label)), h(Text, { style: s.label }, money(Number(amount)))))),
      b.note ? h(Text, { style: s.note }, b.note) : null,
      h(Text, { style: s.note }, 'Bilaga till faktura som skapas separat i ekonomisystemet. Detta underlag är ingen faktura eller betalningsbegäran.'),
      h(Text, { style: s.footer, fixed: true }, `Underlag ${record.id} / version ${record.revision}`)))
  const pdf = await PDFDocument.load(await renderPdfDocument(document))
  const font = await pdf.embedFont(StandardFonts.Helvetica), pages = pdf.getPages()
  pages.forEach((page, i) => page.drawText(`Sida ${i + 1} av ${pages.length}`, { x: page.getWidth() - 94, y: 26, size: 8, font, color: rgb(0.35, 0.39, 0.41) }))
  return Buffer.from(await pdf.save())
}
