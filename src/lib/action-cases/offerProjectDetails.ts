import type { CustomerOfferDraft } from './customerOffers'
import type { ContractParties } from './customerContractParties'
// @ts-expect-error Node strip-types tests require the explicit extension.
import { editContractProperty, emptyContractDetails } from './customerContract.ts'
import type { PropertyDetails, RegisteredProperty } from '../properties/identity'

export type OfferProjectDetails = {
  revision: number
  customer?: Pick<ContractParties, 'customers' | 'business' | 'street' | 'postalCode' | 'city' | 'phone' | 'mobile' | 'email'>
  property?: PropertyDetails & { sourcePropertyId?: string }
}

export function offerProjectDetails(source: CustomerOfferDraft, revision: number, registered?: RegisteredProperty | null): OfferProjectDetails {
  const parties = source.contractParties
  return {
    revision,
    ...(parties ? { customer: {
      customers: parties.customers.map(customer => ({ name: customer.name, personalNumber: '' })),
      ...(parties.business === undefined ? {} : { business: parties.business ? { ...parties.business } : null }),
      street: parties.street, postalCode: parties.postalCode, city: parties.city,
      phone: parties.phone, mobile: parties.mobile, email: parties.email,
    } } : {}),
    ...(source.contractDetails?.property ? { property: { ...source.contractDetails.property } }
      : registered ? { property: { municipality: registered.municipality, cadastralDesignation: registered.cadastralDesignation,
        street: registered.street, postalCode: registered.postalCode, city: registered.city, sourcePropertyId: registered.id } } : {}),
  }
}

const key = (value: string) => value.trim().toLocaleLowerCase('sv-SE').replace(/\s+/gu, ' ')
const same = (a: string, b: string) => key(a) === key(b)
const compatible = (a: string, b: string) => !a.trim() || !b.trim() || same(a, b)

// Complete missing draft facts only. Never infer a new customer or mix two addresses.
export function withOfferProjectDetails(draft: CustomerOfferDraft, source?: OfferProjectDetails, fallbackParties?: ContractParties): CustomerOfferDraft {
  if (!source) return draft
  let next = draft
  const customer = source.customer, parties = draft.contractParties ?? fallbackParties
  if (customer && parties && Boolean(parties.business) === Boolean(customer.business) &&
    parties.customers.length === customer.customers.length &&
    parties.customers.every((person, index) => same(person.name, customer.customers[index].name)) &&
    compatible(parties.email, customer.email) &&
    (!parties.business || same(parties.business.organizationNumber, customer.business?.organizationNumber ?? ''))) {
    const current = parties
    const result = { ...current }
    if (compatible(current.street, customer.street) && compatible(current.postalCode, customer.postalCode) && compatible(current.city, customer.city)) {
      for (const field of ['street', 'postalCode', 'city'] as const) if (!result[field].trim()) result[field] = customer[field]
    }
    for (const field of ['phone', 'mobile', 'email'] as const) if (!result[field].trim()) result[field] = customer[field]
    if (JSON.stringify(result) !== JSON.stringify(draft.contractParties)) next = { ...next, contractParties: result }
  }
  const property = source.property, current = draft.contractDetails?.property
  if (property && (!draft.contractDetails?.fields.property.text.trim() || current) &&
    (!current || ['municipality', 'cadastralDesignation', 'street', 'postalCode', 'city'].every(field =>
      compatible(current[field as keyof PropertyDetails], property[field as keyof PropertyDetails])))) {
    const result = { ...property, ...current }
    for (const field of ['municipality', 'cadastralDesignation', 'street', 'postalCode', 'city'] as const)
      if (!result[field].trim()) result[field] = property[field]
    if (JSON.stringify(result) !== JSON.stringify(current)) {
      const details = editContractProperty(draft.contractDetails ?? emptyContractDetails(), result)
      if (result.sourcePropertyId) details.property!.sourcePropertyId = result.sourcePropertyId
      next = { ...next, contractDetails: details }
    }
  }
  return next
}
