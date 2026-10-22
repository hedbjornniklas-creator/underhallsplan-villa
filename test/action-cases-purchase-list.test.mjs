import test from 'node:test'
import assert from 'node:assert/strict'
import { createPurchaseListDraft, purchaseListNumber, purchaseListPrintHtml, purchaseListValidation, printPurchaseList } from '../src/lib/action-cases/purchaseListPrint.ts'

const material = (patch = {}) => ({ id: 'material', category: 'material', description: 'Isolering', quantity: 24, unit: 'm2', unitCost: 89, markupPercent: 25, notes: 'Intern hemlig anteckning', sourceUrl: 'https://internal.test/secret', ...patch })
const draft = (patch = {}) => ({ ...createPurchaseListDraft([material()], { projectTitle: 'Fiktivt projekt', workTitle: 'Grund' }), ...patch })

test('purchase list copies only selected material, without private pricing or notes', () => {
  const sources = [material(), material({ id: 'work', category: 'own_labor' }), material({ id: 'other', category: 'other' })]
  const before = structuredClone(sources)
  const list = createPurchaseListDraft(sources, { workTitle: 'Grund', deliveryAddress: 'Testgatan 1' })
  assert.equal(list.includePrices, false)
  assert.equal(list.lines.length, 1)
  assert.deepEqual(Object.keys(list.lines[0]).sort(), ['sourceId', 'description', 'articleNumber', 'quantity', 'unit', 'unitCost', 'note'].sort())
  assert.equal(list.lines[0].note, '')
  assert.equal(list.deliveryAddress, 'Testgatan 1')
  list.lines[0].quantity = '100'; list.lines[0].unit = 'paket'; list.lines.splice(0, 1)
  assert.deepEqual(sources, before)
})

test('unknown and quote-covered unit costs are not guessed, while zero is retained', () => {
  const list = createPurchaseListDraft([material({ unitCost: 0, quantity: 0 }), material({ id: 'unknown', unitCost: null, quantity: null }), material({ id: 'covered', coveredByQuoteId: 'quote' })], { workTitle: 'Grund' })
  assert.equal(list.lines[0].unitCost, '0')
  assert.equal(list.lines[0].quantity, '0')
  assert.equal(list.lines[1].unitCost, '')
  assert.equal(list.lines[1].quantity, '')
  assert.equal(list.lines[2].unitCost, '')
})

test('price-free HTML contains no amounts, markups, source links or internal notes', () => {
  const html = purchaseListPrintHtml(draft(), 'https://example.test')
  assert.match(html, /Beställningslista/)
  assert.match(html, /Isolering/)
  assert.doesNotMatch(html, /89|111[,.]25|Intern hemlig|internal\.test|Prispåslag|Kundpris|Inköpspris\/enhet/)
  assert.doesNotMatch(html, /<script|onload=|localStorage|fetch\(/)
})

test('optional prices show purchasing cost ex VAT, including known zero', () => {
  const list = draft({ includePrices: true })
  list.lines.push({ ...list.lines[0], sourceId: 'free', unitCost: '0' })
  const html = purchaseListPrintHtml(list, 'https://example.test')
  assert.match(html, /Inköpspris\/enhet exkl\. moms/)
  assert.match(html, /89,00/)
  assert.match(html, /0,00/)
  assert.doesNotMatch(html, /111,25|Kundpris|Prispåslag/)
})

test('empty values warn but print blank; invalid values cannot print', () => {
  const list = draft({ includePrices: true })
  list.lines[0].quantity = ''; list.lines[0].unitCost = ''
  assert.deepEqual(purchaseListValidation(list), { errors: [], missingQuantity: 1, missingPrice: 1 })
  const html = purchaseListPrintHtml(list, 'https://example.test')
  assert.match(html, /<td class="number"><\/td>/)
  assert.doesNotMatch(html, /Ej angivet|Ej komplett|null|undefined|0,00/)
  list.lines[0].quantity = '-2'
  assert.equal(purchaseListValidation(list).errors.length, 1)
  assert.throws(() => purchaseListPrintHtml(list, 'https://example.test'))
})

test('required list fields and empty selection are validated', () => {
  assert.equal(purchaseListValidation(draft({ lines: [] })).errors.length, 1)
  const list = draft(); list.lines[0].description = ' '; list.lines[0].unit = ''
  assert.equal(purchaseListValidation(list).errors.length, 2)
  list.lines[0].unitCost = 'invalid'
  assert.equal(purchaseListValidation(list).errors.length, 2, 'hidden prices do not block a price-free list')
  list.includePrices = true
  assert.equal(purchaseListValidation(list).errors.length, 3)
})

test('decimal input accepts Swedish commas, never treats blank or invalid as zero', () => {
  for (const [input, expected] of [['0', 0], ['1,25', 1.25], [' 2.5 ', 2.5], [',5', .5], ['12.', 12]]) assert.equal(purchaseListNumber(input), expected)
  for (const input of ['', ' ', '-1', '1,2,3', 'Infinity', 'NaN', '1e3', '<script>', '1 000']) assert.equal(purchaseListNumber(input), null)
})

test('all user content is escaped and metadata is omitted when blank', () => {
  const payload = '<img src=x onerror="alert(1)"> & </style><script>bad()</script>'
  const list = draft({ projectTitle: payload, workTitle: payload, supplier: payload, deliveryAddress: payload, reference: payload, message: payload })
  Object.assign(list.lines[0], { description: payload, articleNumber: payload, note: payload })
  const html = purchaseListPrintHtml(list, 'https://example.test')
  assert.doesNotMatch(html, /<script>|<img src=x|<\/style><script>/)
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/)
  assert.match(html, /&amp;/)
  const clean = purchaseListPrintHtml(draft(), 'https://example.test')
  assert.doesNotMatch(clean, /<dt>Leverantör|<dt>Önskad leverans|Art\.nr/)
  assert.throws(() => purchaseListPrintHtml(draft(), 'javascript:alert(1)'))
})

test('print layout uses repeating table headers and avoids splitting product rows', () => {
  const html = purchaseListPrintHtml(draft(), 'https://example.test')
  assert.match(html, /lang="sv"/)
  assert.match(html, /@page\{size:A4/)
  assert.match(html, /thead\{display:table-header-group\}/)
  assert.match(html, /tr\{break-inside:avoid\}/)
  assert.match(html, /https:\/\/example\.test\/uppdrag\/brand\/logo\.svg/)
})

function printBrowser({ unavailable = false, disconnected = false, fail = false } = {}) {
  const calls = [], handlers = {}, preview = { document: {
    open: () => calls.push('open-document'), write: html => calls.push(html), close: () => calls.push('close-document'),
    fonts: { load: async font => { calls.push(font) } }, images: [{ decode: async () => { calls.push('decode-image') } }],
  }, addEventListener: (event, callback) => { handlers[event] = callback }, focus: () => calls.push('focus'), print: () => { if (fail) throw new Error('print failed'); calls.push('print') } }
  const frame = { contentWindow: unavailable ? null : preview, dataset: {}, style: {}, isConnected: !disconnected, setAttribute: () => {}, remove: () => calls.push('remove-frame') }
  const document = { querySelectorAll: () => [{ remove: () => calls.push('remove-old-frame') }], createElement: name => { calls.push(name); return frame }, body: { appendChild: () => calls.push('append-frame') } }
  return { calls, frame, handlers, browser: { location: { origin: 'https://example.test' }, document } }
}

test('print uses an isolated frame, waits for assets and cleans up after printing without writes', async () => {
  const mock = printBrowser(), list = draft(), before = structuredClone(list)
  const pending = printPurchaseList(list, mock.browser)
  assert.equal(mock.calls[0], 'remove-old-frame')
  assert.ok(mock.calls.includes('append-frame'))
  assert.equal(mock.frame.dataset.gizmoPurchasePrint, 'true')
  assert.ok(!mock.calls.includes('print'))
  await pending
  assert.ok(mock.calls.indexOf('decode-image') < mock.calls.indexOf('print'))
  assert.ok(mock.calls.indexOf('400 14px Manrope') < mock.calls.indexOf('print'))
  assert.ok(!mock.calls.includes('remove-frame'), 'Keep the document alive while the print dialog is open')
  mock.handlers.afterprint()
  assert.ok(mock.calls.includes('remove-frame'))
  assert.deepEqual(list, before)
})

test('unavailable frames, early removal and print failure retain list data', async () => {
  await assert.rejects(printPurchaseList(draft(), printBrowser({ unavailable: true }).browser), /finns kvar/)
  const closed = printBrowser({ disconnected: true }); await printPurchaseList(draft(), closed.browser)
  assert.ok(!closed.calls.includes('print'))
  const failed = printBrowser({ fail: true }), list = draft(), before = structuredClone(list)
  await assert.rejects(printPurchaseList(list, failed.browser), /finns kvar/)
  assert.ok(failed.calls.includes('remove-frame'))
  assert.deepEqual(list, before)
})
