// Fictional visual regression artifacts. No database or production requests.
import { mkdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { emptyCustomerCharge, emptyProjectCustomerPricing } from '../src/lib/action-cases/projectCustomerPricing.ts'
import { defaultBudgetReviewTerms } from '../src/lib/action-cases/contractPricing.ts'
import { emptyCustomerOffer, normalizeCustomerOffer } from '../src/lib/action-cases/customerOffers.ts'
import { renderContractSigningPdf } from '../src/lib/action-cases/contractSigningPdf.ts'

const rows = [
  { title: 'Byggarbeten', terms: { ...emptyProjectCustomerPricing(), split: 'separate', labour: { ...emptyCustomerCharge(), fixedOre: 25000000 },
    material: { ...emptyCustomerCharge(), mode: 'budget', budgetOre: 10000000, markupPercent: 15 }, assumptions: 'FIKTIVT: Materialval och leveransvillkor bestams senare.', reviewTerms: defaultBudgetReviewTerms } },
  { title: 'Ytskikt och kompletterande arbeten', terms: { ...emptyProjectCustomerPricing(), split: 'separate', labour: { ...emptyCustomerCharge(), mode: 'budget', budgetOre: 8000000, hourlyOre: 75000 },
    material: { ...emptyCustomerCharge(), mode: 'running', markupPercent: 10 }, assumptions: 'FIKTIVT: Underlagets skick behover undersokas.', reviewTerms: defaultBudgetReviewTerms } },
  { title: 'Etablering', terms: { ...emptyProjectCustomerPricing(), combined: { ...emptyCustomerCharge(), fixedOre: 2500000 } } },
].map(row => ({ ...row, id: randomUUID(), sourceItemId: randomUUID() }))
const snapshot = { ...normalizeCustomerOffer({ ...emptyCustomerOffer('FIKTIV OFFERT - ENDAST LAYOUTTEST'), contractForm: 'custom',
  introduction: 'Fiktivt exempel med separata kundprisvillkor per moment. Inga riktiga projektuppgifter.',
  items: rows.map(row => ({ id: row.sourceItemId, sourceItemId: row.sourceItemId, title: row.title, kind: 'included', scope: 'Fiktiv och avgransad arbetsbeskrivning.', amountOre: null })),
  contractPricing: { version: 1, mode: 'mixed', display: 'priced', basis: 'rows', split: 'combined',
    rows: rows.map(row => ({ id: row.id, sourceItemId: row.sourceItemId, title: row.title, kind: 'running', amountOre: null, labourOre: null, materialOre: null, projectPricing: { revision: 1, terms: row.terms } })),
    totalOre: null, labourOre: null, materialOre: null, running: { hourlyOre: null, managementOre: null, markupPercent: null, approximateOre: null } },
  paymentTerms: 'FIKTIVT: Fakturering efter utfort arbete, 30 dagar netto.', schedule: 'FIKTIVT: Enligt senare overenskommelse.' }),
  issuerName: 'Fiktiv Byggare AB', replyEmail: 'byggare@example.test', customerName: 'Fiktiv Bestallare', customerEmail: 'kund@example.test', projectTitle: 'FIKTIVT TEST', propertyAddress: 'Testgatan 1' }
await mkdir('tmp/project-customer-pricing-pdf', { recursive: true })
for (const kind of ['offer', 'contract']) {
  const pdf = await renderContractSigningPdf({ kind, snapshot, files: [], revision: 1, createdAt: '2026-11-03T12:00:00Z' })
  await writeFile(`tmp/project-customer-pricing-pdf/${kind}.pdf`, pdf)
  console.log(`${kind}: ${pdf.length} bytes`)
}
