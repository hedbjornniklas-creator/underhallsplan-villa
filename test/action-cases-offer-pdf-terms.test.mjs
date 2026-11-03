import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PDFDocument, PDFName } from 'pdf-lib'
import { appendPdfDocuments, appendPdfPages } from '../src/lib/pdf/appendPages.ts'
import { appendHf17TermsPdf } from '../src/lib/action-cases/standardContractTermsPdf.ts'

test('offer PDF deployment includes the pinned HF17 original as well as the branded fonts', () => {
  const config = readFileSync(new URL('../next.config.ts', import.meta.url), 'utf8')
  assert.match(config, /'\/api\/action-cases\/\*\/customer-offers\/pdf': \['\.\/public\/uppdrag\/brand\/pdf\/\*\.ttf', '\.\/public\/hf17-2017\.pdf'\]/)
})

test('HF17 adds exactly its general-terms page, retaining the offer metadata and leaving the inputs unchanged', async () => {
  const document = await PDFDocument.create()
  document.setTitle('FIKTIV OFFERT')
  document.setAuthor('FIKTIV AVSÄNDARE')
  document.addPage([595.28, 841.89]).drawText('FIKTIV OFFERT')
  document.addPage([595.28, 841.89]).drawText('FIKTIVT INNEHALL')
  const base = await document.save(), before = Uint8Array.from(base)
  const result = await appendHf17TermsPdf(base)
  const combined = await PDFDocument.load(result, { updateMetadata: false })
  assert.equal(combined.getPageCount(), 3)
  assert.equal(combined.getTitle(), 'FIKTIV OFFERT')
  assert.equal(combined.getAuthor(), 'FIKTIV AVSÄNDARE')
  assert.deepEqual(base, before)
  assert.equal((await PDFDocument.load(base)).getPageCount(), 2)
})

test('shared appendix helper rejects missing, duplicated and out-of-bounds page indices', async () => {
  const document = await PDFDocument.create()
  document.addPage()
  const bytes = await document.save()
  for (const indices of [[], [-1], [1], [0, 0], [0.5]]) await assert.rejects(appendPdfPages(bytes, bytes, indices), /PDF_APPEND_PAGES_INVALID/)
})

test('shared appendix preserves document order and rejects interactive annotations rather than dropping them', async () => {
  const base = await PDFDocument.create(); base.addPage()
  const source = await PDFDocument.create(); source.addPage(); source.addPage()
  assert.equal((await PDFDocument.load(await appendPdfDocuments(await base.save(), [{ bytes: await source.save() }, { bytes: await source.save(), indices: [1] }]))).getPageCount(), 4)
  const note = source.context.obj({ Type: 'Annot', Subtype: 'Text', Contents: 'FIKTIV kommentar' })
  source.getPage(0).node.set(PDFName.of('Annots'), source.context.obj([source.context.register(note)]))
  await assert.rejects(appendPdfDocuments(await base.save(), [{ bytes: await source.save() }]), /PDF_APPEND_INTERACTIVE/)
})
