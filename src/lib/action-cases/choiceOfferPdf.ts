import { createElement as h } from 'react'
import { join } from 'node:path'
import { Document, Font, Page, StyleSheet, Text, View, type DocumentProps } from '@react-pdf/renderer'
// @ts-expect-error Shared with the Node strip-types test runner.
import { renderPdfDocument } from '../pdf/renderDocument.ts'
// @ts-expect-error Shared with the Node strip-types test runner.
import { choiceOfferSections } from './choiceOfferDocument.ts'
import type { CustomerPlannedItem } from './customerPlanning'

export type ChoicePdfInput = { item: CustomerPlannedItem; category: string; specification: string; propertyAddress: string; issuer: string; reference: string; date: string; files: string[] }
let fonts = false
function registerFonts() {
  if (fonts) return
  Font.register({ family: 'ChoiceManrope', fonts: [400, 600, 700].map(fontWeight => ({ src: join(process.cwd(), 'public/uppdrag/brand/pdf', `Manrope-${fontWeight}.ttf`), fontWeight })) })
  fonts = true
}
const s = StyleSheet.create({
  page: { paddingTop: 44, paddingHorizontal: 44, paddingBottom: 52, fontFamily: 'ChoiceManrope', fontSize: 10, lineHeight: 1.45, color: '#252A2D' },
  top: { borderTopWidth: 5, borderTopColor: '#F2D76A', paddingTop: 12, marginBottom: 16 },
  kind: { fontSize: 11, fontWeight: 600, color: '#206961', marginBottom: 5 },
  title: { fontSize: 21, fontWeight: 700, lineHeight: 1.2, marginBottom: 8 },
  meta: { fontSize: 9, color: '#596368', marginBottom: 3 },
  heading: { fontSize: 12, fontWeight: 700, padding: '6 8', backgroundColor: '#FCF7E8', borderLeftWidth: 3, borderLeftColor: '#C9B867', marginTop: 14, marginBottom: 7 },
  paragraph: { marginBottom: 7, textAlign: 'left' },
  row: { flexDirection: 'row', borderBottomWidth: 0.7, borderBottomColor: '#AEB8B9' },
  cell: { padding: '6 7', flexGrow: 1, flexBasis: 0, fontSize: 9.5 },
  first: { flexGrow: 2 },
  header: { backgroundColor: '#EDF1F1', fontWeight: 600 },
  note: { marginTop: 14, paddingTop: 9, borderTopWidth: 0.7, borderTopColor: '#AEB8B9', fontSize: 9, color: '#596368' },
  footer: { position: 'absolute', left: 44, right: 44, bottom: 24, height: 16, fontSize: 8, color: '#596368', textAlign: 'right' },
  runningHeader: { position: 'absolute', left: 44, right: 44, top: 18, height: 14, fontSize: 8, color: '#596368' },
})
export async function renderChoiceOfferPdf(input: ChoicePdfInput): Promise<Buffer> {
  registerFonts()
  const kind = input.item.offer?.kind === 'selection' ? 'VAL' : input.item.offer?.kind === 'change' ? 'ÄNDRINGS- OCH TILLÄGGSARBETE' : 'TILLVAL'
  const sections = [
    ...(input.specification ? [{ title: 'Gemensam specifikation', paragraphs: [input.specification] }] : []),
    { title: 'Omfattning', paragraphs: [input.item.scope || 'Omfattningen är inte fastställd.'] },
    ...choiceOfferSections(input.item),
    ...(input.files.length ? [{ title: 'Bilageförteckning', paragraphs: [...input.files.map((name, i) => `${i + 1}. ${name}`), 'Bilagorna bifogas separat. De är inte inbäddade i denna PDF.'] }] : []),
  ]
  const document = h(Document, { title: `${kind}: ${input.item.title}`, author: input.issuer, language: 'sv-SE' } as DocumentProps,
    h(Page, { size: 'A4', style: s.page },
      h(Text, { style: s.runningHeader, fixed: true }, `${input.item.title} / ${input.reference}`),
      h(View, { style: s.top }, h(Text, { style: s.kind }, kind), h(Text, { style: s.title }, input.item.title || 'Nytt alternativ'),
        ...[input.category, input.propertyAddress, input.issuer, `${input.date} · Underlag ${input.reference}`].filter(Boolean).map((text, i) => h(Text, { style: s.meta, key: i }, text))),
      ...sections.map((section, index) => h(View, { key: index },
        h(Text, { style: s.heading, minPresenceAhead: 48 }, section.title),
        ...('rows' in section && section.rows ? Array.from({ length: Math.ceil(section.rows.length / 10) }, (_, chunk) => h(View, { key: `table-${chunk}` },
          h(View, { style: [s.row, s.header], wrap: false, minPresenceAhead: 28 }, ...section.headers!.map((title, i) => h(Text, { style: i === 0 ? [s.cell, s.first] : s.cell, key: i }, title))),
          ...section.rows!.slice(chunk * 10, chunk * 10 + 10).map((row, r) => h(View, { style: s.row, key: r, wrap: false }, ...row.map((cell, c) => h(Text, { style: c === 0 ? [s.cell, s.first] : s.cell, key: c }, cell || ' ')))))) : []),
        ...(section.paragraphs ?? []).map((text, i) => h(Text, { style: s.paragraph, key: `p-${i}`, orphans: 2, widows: 2 }, text)))),
      h(Text, { style: s.note }, 'Underlag för separat överenskommelse. Ett val i kundvyn är inte en beställning. Denna PDF innebär inte att något har godkänts och ändrar inte grundavtalet. Vid godkännande per mejl: hänvisa till underlagsreferensen och bifoga samma PDF och bilagor.'),
      h(Text, { style: s.footer, fixed: true }, `Underlag ${input.reference}`)))
  return renderPdfDocument(document)
}
