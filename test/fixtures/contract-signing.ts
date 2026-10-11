// @ts-expect-error Node strip-types needs explicit extensions.
import { emptyCustomerOffer, normalizeCustomerOffer, type CustomerOfferSnapshot } from '../../src/lib/action-cases/customerOffers.ts'
// @ts-expect-error Node strip-types needs explicit extensions.
import { emptyContractDetails } from '../../src/lib/action-cases/customerContract.ts'
// @ts-expect-error Node strip-types needs explicit extensions.
import { emptyContractParties } from '../../src/lib/action-cases/customerContractParties.ts'
// @ts-expect-error Node strip-types needs explicit extensions.
import { contractPricingForEditing } from '../../src/lib/action-cases/contractPricing.ts'
// @ts-expect-error Node strip-types needs explicit extensions.
import { abs18PaymentText } from '../../src/lib/action-cases/customerPaymentPlan.ts'
// @ts-expect-error Node strip-types needs explicit extensions.
import { editSiteFacility } from '../../src/lib/action-cases/contractSiteFacilities.ts'
// @ts-expect-error Node strip-types needs explicit extensions.
import { changesForEditing, changesDetails } from '../../src/lib/action-cases/contractChanges.ts'

export const signingId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
export function signingDraft() {
  let details = emptyContractDetails()
  for (const key of Object.keys(details.fields) as Array<keyof typeof details.fields>) details.fields[key] = { status: 'specified', text: `FIKTIV TESTTEXT: ${key}.` }
  details.controlParticipants = { controlOfficer: 'FIKTIV TESTROLL: Kontrollansvarig', customerInspector: 'FIKTIV TESTROLL: Kontrollant' }
  details.advice = { format: 'contract-fields', status: 'given', work: 'FIKTIV avrådan om markarbete.', reason: 'FIKTIV riskbedömning.', communicatedAt: '', customerResponse: '' }
  details.siteFacilities = editSiteFacility(undefined, 'electricity', { providedBy: 'customer', paidBy: 'contractor', details: 'FIKTIV TESTTEXT: Byggcentral vid garaget.' })
  const changes = changesForEditing(details)
  details = changesDetails(details, { ...changes, rates: changes.rates.map((r) => ({ ...r, hourlyOre: 85000 })), markups: { materials: 10, subcontractors: 10, equipment: 10, other: 10 } })
  const parties = emptyContractParties('Anna Test', 'anna@example.test', '0700000000', {
    companyName: 'Fiktiv Entreprenör AB', organizationNumber: '556016-0680', contactName: 'Kim Test', street: 'Testgatan 2', postalCode: '12345', city: 'Teststad', email: 'bygg@example.test', fTax: 'yes' })
  parties.customers.push({ name: 'Bo Test', personalNumber: '' })
  parties.street = 'Testgatan 1'; parties.postalCode = '12345'; parties.city = 'Teststad'
  const draft = normalizeCustomerOffer({ ...emptyCustomerOffer('TESTAVTAL - inte för verklig signering'), contractForm: 'custom',
    introduction: 'Fiktivt test av tillbyggnad.', baseAmountOre: 10000000, validUntil: '2099-01-01', terms: 'Endast fiktiva testuppgifter. Inte ett verkligt erbjudande eller avtal.',
    schedule: 'Planerad start 2027-03-01. Färdigställande 2027-06-30.', contractDetails: details, contractParties: parties,
    paymentConditions: { version: 1, days: 30, standardText: abs18PaymentText },
    paymentPlan: { version: 1, installments: [{ id: signingId(80), title: 'Färdigställd grund', condition: 'Efter utfört och kontrollerat grundarbete.', plannedDate: '2027-04-01', amountOre: 5000000 },
      { id: signingId(81), title: 'Resterande arbeten', condition: 'Efter utfört avtalat arbete och godkänd slutbesiktning.', plannedDate: '', amountOre: 5000000 }] },
    items: [{ id: signingId(10), kind: 'included', title: 'Mark och grund', scope: 'FIKTIV TESTTEXT: Grundarbeten enligt ritning.', scopeConditions: 'Fri åtkomst.', scopeExclusions: 'Bergschakt ingår inte.', scopeAdvice: 'FIKTIV avrådan.', amountOre: 6000000 },
      { id: signingId(11), kind: 'included', title: 'Tak', scope: 'FIKTIV TESTTEXT: Tätt tak enligt ritning.', amountOre: 4000000 }] })
  draft.contractPricing = contractPricingForEditing({ ...draft, pricingMode: 'itemized' })
  draft.pricingMode = 'total'
  return normalizeCustomerOffer(draft)
}
export function signingSnapshot(): CustomerOfferSnapshot {
  const draft = signingDraft(), p = draft.contractParties!
  return { ...draft, projectTitle: 'Fiktivt testprojekt', propertyAddress: 'Testgatan 1', customerName: p.customers[0].name, customerEmail: p.email, issuerName: p.contractor.companyName, replyEmail: p.contractor.email }
}
