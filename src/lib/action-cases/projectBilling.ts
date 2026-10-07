import type { OrganizationCustomerInput, OrganizationCustomerWorkspace } from '../customers/domain'
import type { ContractParties } from './customerContractParties'

export type ProjectBillingWorkspace = {
  available: boolean
  revision: number
  customerId: string | null
  registry: OrganizationCustomerWorkspace
}

export function emptyBillingCustomer(): OrganizationCustomerInput {
  return { customerType: 'private', name: '', identityNumber: null, email: null, phone: null,
    address: null, addressLine2: null, postalCode: null, city: null, countryCode: 'SE',
    invoiceSameAsCustomer: true, invoiceName: null, invoiceEmail: null, invoiceAddress: null,
    invoiceAddressLine2: null, invoicePostalCode: null, invoiceCity: null, invoiceCountryCode: null,
    invoiceReference: null }
}

export function billingCustomerFromBuyer(parties: ContractParties): OrganizationCustomerInput {
  return { ...emptyBillingCustomer(), name: parties.customers[0].name, email: parties.email || null,
    phone: parties.mobile || parties.phone || null, address: parties.street || null,
    postalCode: parties.postalCode || null, city: parties.city || null }
}

export function billingCustomerInput(customer: OrganizationCustomerInput): OrganizationCustomerInput {
  const empty = emptyBillingCustomer()
  return Object.fromEntries(Object.keys(empty).map((key) => [key, customer[key as keyof OrganizationCustomerInput]])) as OrganizationCustomerInput
}
