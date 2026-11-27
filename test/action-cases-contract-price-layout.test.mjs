import test from 'node:test'
import assert from 'node:assert/strict'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { renderContractSigningPdf } from '../src/lib/action-cases/contractSigningPdf.ts'
import { signingSnapshot, signingId } from './fixtures/contract-signing.ts'

async function pricePages(count) {
  const snapshot = signingSnapshot()
  snapshot.contractForm = 'ab04'
  snapshot.contractPricing = { ...snapshot.contractPricing, mode: 'fixed', display: 'priced', basis: 'rows', split: 'combined',
    rows: Array.from({ length: count }, (_, i) => ({ id: signingId(i + 1000), title: `Fiktivt moment M${String(i + 1).padStart(3, '0')}`,
      kind: 'fixed', amountOre: 1000000, labourOre: null, materialOre: null })) }
  snapshot.baseAmountOre = count * 1000000
  const before = JSON.stringify(snapshot)
  const bytes = await renderContractSigningPdf({ id: signingId(500), version: 0, createdAt: '2026-11-27T12:00:00Z', snapshot, files: [] })
  assert.equal(JSON.stringify(snapshot), before)
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true })
  try {
    const pdf = await task.promise, pages = []
    for (let n = 1; n <= pdf.numPages; n++) {
      const items = (await (await pdf.getPage(n)).getTextContent()).items
      pages.push({ text: items.map(item => item.str ?? '').join(' '), headers: items.filter(item => item.str === 'Moment').length })
    }
    return pages
  } finally { await task.destroy() }
}

test('a normal fixed-price table does not repeat its column header midway down the same page', async () => {
  const pages = await pricePages(14)
  const priced = pages.filter(page => /Fiktivt moment M/.test(page.text))
  assert.equal(priced.length, 1)
  assert.equal(priced[0].headers, 1)
  for (let i = 1; i <= 14; i++) assert.ok(priced[0].text.includes(`M${String(i).padStart(3, '0')}`))
  assert.match(priced[0].text, /Totalsumma/)
})

test('long price tables repeat column headers only on new pages and retain all rows and the total', async () => {
  const pages = await pricePages(65)
  const priced = pages.filter(page => /Fiktivt moment M/.test(page.text))
  assert.ok(priced.length >= 3)
  assert.ok(priced.every(page => page.headers === 1))
  const text = pages.map(page => page.text).join(' ')
  for (let i = 1; i <= 65; i++) assert.ok(text.includes(`M${String(i).padStart(3, '0')}`))
  assert.match(text, /Totalsumma/)
})
