import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID as id } from 'node:crypto'
import { PDFDocument } from 'pdf-lib'
import { renderInvoiceBasisPdf } from '../src/lib/action-cases/invoiceBasisPdf.ts'
import { emptyInvoiceBasis } from '../src/lib/action-cases/projectCompletion.ts'

const output = resolve('tmp/billing-flow-preview')
await mkdir(output, { recursive: true })
const lines = [
  { description: 'ÄTA 01 - Utfört fönstermontage enligt godkänd överenskommelse. 12 timmar à 600 kr exklusive moms.', quantity: 12, unit: 'tim', unitPriceOre: 60000, vatRate: 25 },
  { description: 'ÄTA 01 - Material och underentreprenör enligt granskad kostnadsfördelning.', quantity: 1, unit: 'post', unitPriceOre: 1150000, vatRate: 25 },
  { description: 'Avtalsdel 02 - Plattsättning, färdigställd del enligt betalplan.', quantity: 1, unit: 'post', unitPriceOre: 2000000, vatRate: 25 },
].map(l => ({ ...l, id: id() }))
const record = { id: id(), revision: 1, updatedAt: '2026-11-09', body: { ...emptyInvoiceBasis({ issuer: 'Testbygg Stockholm AB\nFiktivgatan 1\n123 45 Teststad', recipient: 'Fiktiv beställare\nTestgatan 2\n123 45 Teststad' }), date: '2026-11-09', title: 'Fakturaunderlag', lines, note: 'Fiktivt testunderlag. Endast valda delar och belopp ingår. Det verkliga fakturanumret registreras separat efter manuell fakturering i Fortnox.' } }
const before = structuredClone(record), bytes = await renderInvoiceBasisPdf(record, 'Fiktivt faktureringsprojekt', true), pdf = await PDFDocument.load(bytes)
if (JSON.stringify(before) !== JSON.stringify(record) || pdf.getPageCount() !== 1) throw Error('PDF source or pagination changed')
const file = resolve(output, 'fakturaunderlag-test.pdf')
await writeFile(file, bytes)
console.log(file)
