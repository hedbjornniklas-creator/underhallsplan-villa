import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { activeSigningVersion, signingPdfFilename } from '../src/lib/action-cases/contractSigning.ts'
import { contractSigningHeading, contractSigningSections, renderContractSigningPdf } from '../src/lib/action-cases/contractSigningPdf.ts'
import { emptyCustomerOffer, offerPublishIssues } from '../src/lib/action-cases/customerOffers.ts'
import { signingSnapshot, signingId } from './fixtures/contract-signing.ts'

const input = () => ({ id: signingId(500), version: 1, createdAt: '2026-10-11T10:00:00Z', snapshot: signingSnapshot(), files: [] })
test('existing mailbox approval still rejects two buyers and incomplete contracts', () => {
  assert.ok(offerPublishIssues(input().snapshot).some((issue) => issue.includes('två beställare')))
  assert.ok(offerPublishIssues(emptyCustomerOffer()).length > 0)
})
test('PDF projection preserves frozen customer text, price display, payment terms and workplace arrangements only', () => {
  const value = input(), before = JSON.stringify(value)
  const sections = contractSigningSections(value), all = JSON.stringify(sections)
  assert.match(all, /Bo Test|Anna Test/)
  assert.match(all, /Bergschakt ingår inte/)
  assert.match(all, /Byggcentral vid garaget/)
  assert.match(all, /Färdigställd grund/)
  assert.match(all, /30 dagar/)
  assert.equal(JSON.stringify(value), before)
  assert.ok(sections.findIndex((s) => s.title.startsWith('Priset')) < sections.findIndex((s) => s.title === 'Besiktning'))
  value.snapshot.contractPricing.display = 'total'
  const price = contractSigningSections(value).find((s) => s.title.startsWith('Priset'))
  assert.equal(price.rows.length, 1)
  assert.doesNotMatch(JSON.stringify(price), /Mark och grund|Tak/)
  value.snapshot.contractPricing.display = 'unpriced'
  const unpriced = contractSigningSections(value).find((s) => s.title.startsWith('Priset'))
  assert.equal(unpriced.rows[0].length, 1)
  assert.equal(unpriced.rows.at(-1).length, 2)
  assert.doesNotMatch(all, /internalCost|costing|sourceItemId|email_payload/)
})
test('shared PDF renderer produces printable PDF without mutating frozen evidence', async () => {
  const value = input(), before = JSON.stringify(value), bytes = await renderContractSigningPdf(value)
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-')
  assert.ok(bytes.length > 8000)
  assert.equal(JSON.stringify(value), before)
})

test('PDF heading identifies the contract type, independently of the internal project name', () => {
  const value = input().snapshot
  value.projectTitle = 'INTERNAL PROJECT NAME - NEVER PRINT'
  value.contractForm = 'abs18'
  assert.deepEqual(contractSigningHeading(value), { title: 'ENTREPRENADKONTRAKT', form: 'ABS 18' })
  assert.doesNotMatch(JSON.stringify(contractSigningSections({ ...input(), snapshot: value })), /INTERNAL PROJECT NAME/)
  value.contractForm = 'custom'
  assert.deepEqual(contractSigningHeading(value), { title: 'ENTREPRENADAVTAL', form: 'Särskilda villkor' })
  const source = readFileSync(new URL('../src/lib/action-cases/contractSigningPdf.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /s\.projectTitle/)
})

test('one document table preserves saved names, order and dates without duplicate file metadata', () => {
  const value = input()
  value.snapshot.contractDetails.assignment = {
    documents: [
      { id: signingId(10), fileId: signingId(20), type: 'Situationsplan', name: 'Situationsplan A-01', date: '2026-05-11' },
      { id: signingId(11), fileId: signingId(21), type: 'Beskrivning', name: 'Egen sparad text', date: '2026-06-22' },
    ], documentNotes: 'Sparad bilageordning gäller.', additionalScope: 'Kompletterande uppdrag', exclusions: 'Sparad avgränsning',
  }
  value.files = [
    { id: signingId(20), fileName: 'Situationsplan_original.pdf', contentType: 'application/pdf', fileSizeBytes: 100 },
    { id: signingId(22), fileName: 'Extra bilaga.pdf', contentType: 'application/pdf', fileSizeBytes: 200 },
  ]
  const before = JSON.stringify(value), sections = contractSigningSections(value)
  const tables = sections.filter((s) => s.title === 'Handlingar som ingår i uppdraget')
  assert.equal(tables.length, 1)
  assert.deepEqual(tables[0].rows, [
    ['Situationsplan', 'Situationsplan A-01', '2026-05-11'],
    ['Beskrivning', 'Egen sparad text', '2026-06-22'],
    ['Bilaga', 'Extra bilaga.pdf', ''],
  ])
  assert.equal(tables[0].paragraphs.join('\n'), 'Sparad bilageordning gäller.')
  assert.deepEqual(tables[0].columns, ['Typ av handling', 'Handlingens namn', 'Datum'])
  assert.doesNotMatch(JSON.stringify(sections), /Situationsplan_original|application\/pdf|Bilagor - låsta separata dokument/)
  assert.equal(JSON.stringify(value), before)
})

test('PDF groups scope, conditions and exclusions by subject, retaining work-part labels and all text', () => {
  const value = input()
  const before = JSON.stringify(value), parts = contractSigningSections(value).filter((s) => s.group === 'assignment')
  assert.deepEqual(parts.map((s) => s.title), ['Uppdraget', 'Avtalshandlingar', 'Arbetets omfattning', 'Förutsättningar för arbetena', 'Entreprenörens åtagande omfattar inte', 'Avrådan för arbetsdelar'])
  for (const [key, title] of [['scope', 'Arbetets omfattning'], ['scopeConditions', 'Förutsättningar för arbetena'], ['scopeExclusions', 'Entreprenörens åtagande omfattar inte'], ['scopeAdvice', 'Avrådan för arbetsdelar']]) {
    const part = parts.find((s) => s.title === title)
    for (const item of value.snapshot.items) if (item[key]?.trim()) assert.ok(part.blocks.some((block) => block.label === item.title && block.text === item[key]))
  }
  assert.equal(JSON.stringify(value), before)
})

test('PDF price tables use matching numeric columns for all display and split options', () => {
  const value = input()
  for (const display of ['priced', 'unpriced', 'total']) for (const split of ['combined', 'separate']) {
    value.snapshot.contractPricing.display = display
    value.snapshot.contractPricing.split = split
    const price = contractSigningSections(value).find((s) => s.group === 'price')
    assert.equal(price.columnWidths.length, price.columns.length)
    assert.equal(price.columnWidths.reduce((a, b) => a + b, 0), 1)
    assert.ok(price.numericColumns.every((i) => i < price.columns.length))
    assert.equal(price.rows.at(-1).length, price.columns.length)
    assert.equal(price.totalRow, true)
  }
})

test('printable PDF omits system warnings and placeholders while retaining unavailable named references', async () => {
  const value={...input(),draftRevision:5,unavailableAttachments:['Handling 7 (namn saknas)']},before=JSON.stringify(value)
  const sections=contractSigningSections(value)
  assert.doesNotMatch(JSON.stringify(sections), /Bilagor saknas|olåst utkast|Ej angivet|Ej planerat/)
  assert.deepEqual(sections,contractSigningSections({...value,draftRevision:undefined,unavailableAttachments:[]}))
  assert.equal((await renderContractSigningPdf(value)).subarray(0,5).toString(),'%PDF-')
  assert.equal(JSON.stringify(value),before)
  const source=readFileSync(new URL('../src/lib/action-cases/contractSigningPdf.ts',import.meta.url),'utf8')
  assert.doesNotMatch(source,/UTKAST - EJ|LÅST VERSION|Revision \$|Framställt|Ej angivet|Ej planerat|priceSummary|styles\.warning/)
  assert.match(source,/Sida \$\{pageNumber\} av/)
  assert.match(source,/styles\.blankLine/)
})

test('completely blank missing document rows are not printed; known names and source references are preserved', () => {
  const value = input()
  value.snapshot.contractDetails.assignment = { documents: [
    { id: signingId(10), fileId: signingId(20), type: '', name: '', date: '' },
    { id: signingId(11), fileId: signingId(21), type: 'Ritning', name: 'Sparad ritning', date: '' },
    { id: signingId(12), fileId: signingId(22), type: '', name: '', date: '' },
  ], documentNotes: '', additionalScope: '', exclusions: '' }
  value.files = [{ id: signingId(22), fileName: 'Identifierbar bilaga.pdf', contentType: 'application/pdf', fileSizeBytes: 100 }]
  const before = JSON.stringify(value), table = contractSigningSections(value).find((s) => s.title === 'Handlingar som ingår i uppdraget')
  assert.deepEqual(table.rows, [['Ritning', 'Sparad ritning', ''], ['', 'Identifierbar bilaga.pdf', '']])
  assert.equal(JSON.stringify(value), before)
})

test('assignment exclusions, excluded items and saved ABS standard text share one logically named section', () => {
  const value = input()
  value.snapshot.contractForm = 'abs18'
  value.snapshot.contractDetails.assignment = { documents: [], documentNotes: '', additionalScope: '', exclusions: 'Egen generell avgränsning.', standardConditions: { text: 'Beställarens sparade ansvar och avgifter.' } }
  value.snapshot.items.push({ ...value.snapshot.items[0], id: signingId(15), kind: 'excluded', title: 'El', scope: 'Elentreprenad ingår inte.', scopeConditions: 'Separat entreprenör.', scopeExclusions: '', scopeAdvice: '' })
  const before = JSON.stringify(value), parts = contractSigningSections(value)
  const excluded = parts.find((s) => s.title === 'Entreprenörens åtagande omfattar inte')
  assert.equal(excluded.blocks[0].text, 'Egen generell avgränsning.')
  assert.ok(excluded.blocks.some((b) => b.label === 'El' && b.text === 'Elentreprenad ingår inte.\n\nSeparat entreprenör.'))
  assert.ok(excluded.blocks.some((b) => b.label === 'Beställarens ansvar och avgifter' && b.text === 'Beställarens sparade ansvar och avgifter.'))
  assert.equal(parts.some((s) => s.title === 'Standardtexter för uppdraget'), false)
  assert.equal(JSON.stringify(value), before)
})

test('a named work part with empty scope remains printable for handwritten completion', async () => {
  const value = input()
  value.snapshot.items[0].scope = ''
  const before = JSON.stringify(value)
  const scope = contractSigningSections(value).find((s) => s.title === 'Arbetets omfattning')
  assert.deepEqual(scope.blocks[0], { label: value.snapshot.items[0].title, text: '' })
  assert.equal((await renderContractSigningPdf(value)).subarray(0, 5).toString(), '%PDF-')
  assert.equal(JSON.stringify(value), before)
})

test('payment table keeps dates blank, amounts exact and conditions after the sum', () => {
  const value = input(), before = JSON.stringify(value)
  const parts = contractSigningSections(value).filter((s) => s.group === 'payments')
  assert.deepEqual(parts.map((s) => s.title), ['Tid för betalning', 'Betalningsvillkor'])
  assert.equal(parts[0].rows[1][1], '')
  assert.equal(parts[0].rows[1][0], '2. Resterande arbeten')
  assert.equal(parts[0].rows.at(-1)[0], 'Summa')
  assert.ok(parts[0].afterTable[1].includes(value.snapshot.paymentPlan.installments[1].condition))
  assert.match(parts[1].paragraphs.join('\n'), /30 dagar|hålla inne tio procent/)
  assert.equal(JSON.stringify(value), before)
})

test('final payment prints its saved condition without an added number or title; other conditions remain identifiable', () => {
  const value = input(), rows = value.snapshot.paymentPlan.installments
  rows[1].kind = 'final'
  rows[1].title = 'Egen slutbetalning'
  rows[1].condition = 'Efter godkänd slutbesiktning. Egen redigerad avtalstext.'
  const before = JSON.stringify(value)
  const payment = contractSigningSections(value).find((s) => s.title === 'Tid för betalning')
  assert.equal(payment.afterTable[1], rows[1].condition)
  assert.equal(payment.afterTable[0], `1. ${rows[0].title}: ${rows[0].condition}`)
  assert.equal(payment.rows[1][0], '2. Egen slutbetalning')
  assert.equal(JSON.stringify(value), before)
})

test('unknown F-tax status renders printable choices without guessing a value or mutating parties', async () => {
  const value = input()
  value.snapshot.contractParties.contractor.fTax = 'unreviewed'
  const before = JSON.stringify(value)
  assert.equal((await renderContractSigningPdf(value)).subarray(0, 5).toString(), '%PDF-')
  assert.equal(JSON.stringify(value), before)
  const source = readFileSync(new URL('../src/lib/action-cases/contractSigningPdf.ts', import.meta.url), 'utf8')
  assert.match(source, /styles\.taxOptions/)
  assert.match(source, /\['Ja', 'Nej'\]/)
})

test('framed sections can continue across pages for long participant details and opening text without changing evidence', async () => {
  const value = input()
  value.snapshot.contractDetails.controlParticipants.controlOfficer = 'Egen kontaktuppgift med ansvar och telefon. '.repeat(60)
  value.snapshot.introduction = 'Egen inledning med omfattning och viktiga förutsättningar. '.repeat(100)
  const before = JSON.stringify(value)
  assert.equal((await renderContractSigningPdf(value)).subarray(0, 5).toString(), '%PDF-')
  assert.equal(JSON.stringify(value), before)
})

test('draft PDF renders empty and partially filled contracts without completeness checks or invented markups', async () => {
  const value = input()
  value.draftRevision = 12
  value.snapshot = { ...value.snapshot, ...emptyCustomerOffer() }
  delete value.snapshot.contractParties
  delete value.snapshot.contractDetails
  delete value.snapshot.contractPricing
  delete value.snapshot.paymentPlan
  delete value.snapshot.paymentConditions
  const before = JSON.stringify(value)
  assert.equal((await renderContractSigningPdf(value)).subarray(0, 5).toString(), '%PDF-')
  assert.equal(JSON.stringify(value), before)
  const partial = input()
  partial.snapshot.contractPricing.mode = 'running'
  partial.snapshot.contractPricing.running.markupPercent = null
  assert.doesNotMatch(JSON.stringify(contractSigningSections(partial)), /null %|undefined/)
  partial.snapshot.paymentPlan.installments[0].amountOre = null
  assert.equal(contractSigningSections(partial).find((s) => s.title === 'Tid för betalning').rows.at(-1)[2], '')
})
test('released versions do not lock a new draft; filenames never expose names', () => {
  assert.equal(activeSigningVersion([{ id:'old', releasedAt:'2026-10-11' }, { id:'current', releasedAt:null }]).id,'current')
  assert.equal(activeSigningVersion([{ releasedAt:'2026-10-11' }]),undefined)
  assert.equal(signingPdfFilename(input()),'Avtal-v1-00000000.pdf')
})

test('all signature lines stay in one nonbreaking group on printable PDFs', () => {
  const source=readFileSync(new URL('../src/lib/action-cases/contractSigningPdf.ts',import.meta.url),'utf8')
  assert.match(source,/h\(View, \{ style: \[styles\.sectionFrame, \{ paddingBottom: 12 \}\], wrap: false \},\s*band\(groups\.length \+ 1, 'Underskrifter'/)
})
test('signing routes never send, accept or expose anonymous downloads', () => {
  const route = readFileSync(new URL('../src/app/api/action-cases/[caseId]/contract-signing/route.ts',import.meta.url),'utf8')
  const download = readFileSync(new URL('../src/app/api/action-cases/[caseId]/contract-signing/[documentId]/[fileId]/route.ts',import.meta.url),'utf8')
  const draftPdf = readFileSync(new URL('../src/app/api/action-cases/[caseId]/contract-signing/pdf/route.ts',import.meta.url),'utf8')
  assert.match(route,/customerOfferContext/); assert.match(route,/offerRequestBody/)
  assert.match(download,/customerOfferContext/); assert.match(download,/attachment; filename/)
  assert.match(draftPdf,/customerOfferContext/); assert.match(draftPdf,/private, no-store/)
  assert.match(draftPdf,/attachment; filename/)
  assert.doesNotMatch(route + download + draftPdf,/sendAssignmentEmail|acceptCustomerOffer|createSignedUrl/)
})
