import React from 'react'
import { Document, Page, View, Text, renderToBuffer } from '@react-pdf/renderer'
import { writeFile } from 'node:fs/promises'
const h = React.createElement
const pageStyle = { paddingTop: 30, paddingBottom: 52, paddingHorizontal: 40, fontFamily: 'Helvetica', fontSize: 10, lineHeight: 1.4, color: '#172033' }
const footerStyle = { position: 'absolute', top: 797, height: 24, left: 40, right: 40, borderTopWidth: 0.7, borderTopColor: '#397b5d', paddingTop: 7, fontSize: 7.5, lineHeight: 1.2, color: '#52645d' }
const number = ({ pageNumber, totalPages }) => `Bestallning TEST | ${pageNumber} (${totalPages})`
const variants = [
  ['only-child-auto-height', () => h(View, { fixed: true, style: footerStyle }, h(Text, { style: { fontSize: 7.5, lineHeight: 1.2 }, render: number }))],
  ['only-parent-auto-height', () => h(View, { fixed: true, style: { ...footerStyle, height: undefined } }, h(Text, { style: { height: 12, fontSize: 7.5, lineHeight: 1.2 }, render: number }))],
  ['original', () => h(View, { fixed: true, style: footerStyle }, h(Text, { style: { height: 12, fontSize: 7.5, lineHeight: 1.2 }, render: number }))],
  ['no-height', () => h(View, { fixed: true, style: { ...footerStyle, height: undefined } }, h(Text, { style: { fontSize: 7.5, lineHeight: 1.2 }, render: number }))],
  ['direct-text', () => h(Text, { fixed: true, style: { position: 'absolute', bottom: 25, left: 40, fontSize: 8 }, render: number })],
  ['direct-text-top', () => h(Text, { fixed: true, style: { position: 'absolute', top: 805, left: 40, right: 40, fontSize: 8 }, render: number })],
  ['view-render', () => h(View, { fixed: true, style: footerStyle, render: props => h(Text, { style: { fontSize: 8, lineHeight: 1.2 } }, number(props)) })],
  ['static', () => h(View, { fixed: true, style: footerStyle }, h(Text, { style: { height: 12, fontSize: 7.5, lineHeight: 1.2 } }, 'Bestallning TEST | static'))],
  ['separate-line-text', () => h(React.Fragment, null,
    h(View, { fixed: true, style: { position: 'absolute', top: 797, left: 40, right: 40, height: 1, borderTopWidth: 0.7, borderTopColor: '#397b5d' } }),
    h(Text, { fixed: true, style: { position: 'absolute', top: 805, left: 40, right: 40, fontSize: 7.5, lineHeight: 1.2, color: '#52645d' }, render: number }),
  )],
]
const doc = h(Document, null, ...variants.map(([name, footer]) => h(Page, { key: name, size: 'A4', style: pageStyle, wrap: true },
  h(Text, { fixed: true }, `VARIANT ${name}`), footer(),
  ...Array.from({ length: 70 }, (_, i) => h(Text, { key: i, style: { marginTop: 5 } }, `Body line ${i + 1} : Long test content automatically wraps onto the next page.`)),
)))
await writeFile(new URL('./experiment.pdf', import.meta.url), await renderToBuffer(doc))
