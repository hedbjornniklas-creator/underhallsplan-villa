import type { CustomerOfferDraft } from './customerOffers'
import type { CustomerOfferCosting } from './customerOfferCosting'

export function customerOfferSaveChanges(draft: CustomerOfferDraft, saved: CustomerOfferDraft,
  costing: CustomerOfferCosting, savedCosting: CustomerOfferCosting = {}): string[] {
  const changed = (key: keyof CustomerOfferDraft) => JSON.stringify(draft[key]) !== JSON.stringify(saved[key])
  const changes: string[] = []
  if (['title', 'introduction', 'validUntil'].some(key => changed(key as keyof CustomerOfferDraft))) changes.push('Rubrik, inledning eller giltighetsdatum')
  if (changed('items')) changes.push('Arbetsmoment och omfattning')
  if (changed('offerAlternatives')) changes.push('Valbara offertdelar, omfattning och priser exklusive moms')
  if (['baseAmountOre', 'pricingMode', 'contractPricing', 'offerHourEstimate'].some(key => changed(key as keyof CustomerOfferDraft))) changes.push('Pris och prisvillkor')
  if (changed('contractParties')) changes.push('Beställare eller entreprenör')
  if (changed('senderProfile')) changes.push('Avsändarprofil')
  if (changed('contractDetails')) changes.push('Avtalsuppgifter och handlingar')
  if (['contractForm', 'terms', 'attachmentIds', 'termsAttachmentId', 'offerDocuments'].some(key => changed(key as keyof CustomerOfferDraft))) changes.push('Villkor och bilagor')
  if (['paymentPlan', 'paymentConditions', 'paymentTerms'].some(key => changed(key as keyof CustomerOfferDraft))) changes.push('Betalningsplan eller betalningsvillkor')
  if (changed('schedule')) changes.push('Tider')
  if (changed('signingMethod')) changes.push('Signeringssätt')
  if (JSON.stringify(costing) !== JSON.stringify(savedCosting)) changes.push('Intern priskalkyl')
  return changes
}
