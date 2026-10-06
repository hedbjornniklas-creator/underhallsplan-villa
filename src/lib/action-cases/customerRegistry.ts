import type { OrganizationCustomer, OrganizationCustomerInput } from '../customers/domain'
import type { ContractParties } from './customerContractParties'

export type ContractCustomerBinding =
  | { mode: 'existing'; customerId: string; customerVersion: number }
  | { mode: 'create' }

export type ContractCustomerLink = {
  organizationId: string
  available: boolean
  customerId: string | null
  customerNumber: string | null
}

export function parseContractCustomerBinding(value: unknown): ContractCustomerBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('CUSTOMER_OFFER_INVALID')
  const binding = value as Record<string, unknown>
  if (binding.mode === 'create' && Object.keys(binding).length === 1) return { mode: 'create' }
  if (binding.mode !== 'existing' || Object.keys(binding).length !== 3 ||
    typeof binding.customerId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(binding.customerId) ||
    !Number.isSafeInteger(binding.customerVersion) || Number(binding.customerVersion) < 1) throw new Error('CUSTOMER_OFFER_INVALID')
  return { mode: 'existing', customerId: binding.customerId, customerVersion: Number(binding.customerVersion) }
}

export function contractCustomerInput(parties: ContractParties): OrganizationCustomerInput {
  return {
    customerType: 'private', name: parties.customers[0].name,
    identityNumber: parties.customers[0].personalNumber || null,
    email: parties.email || null, phone: parties.mobile || parties.phone || null,
    address: parties.street || null, addressLine2: null, postalCode: parties.postalCode || null,
    city: parties.city || null, countryCode: 'SE', invoiceSameAsCustomer: true,
    invoiceName: null, invoiceEmail: null, invoiceAddress: null, invoiceAddressLine2: null,
    invoicePostalCode: null, invoiceCity: null, invoiceCountryCode: null, invoiceReference: null
  }
}

export function copyRegistryCustomer(parties: ContractParties, customer: OrganizationCustomer): ContractParties {
  if (customer.customerType !== 'private' || !customer.isActive) throw new Error('CUSTOMER_REGISTRY_NOT_FOUND')
  return { ...parties, customers: [{ name: customer.name, personalNumber: customer.identityNumber ?? '' }, ...parties.customers.slice(1)],
    street: [customer.address, customer.addressLine2].filter(Boolean).join(', '),
    postalCode: customer.postalCode ?? '', city: customer.city ?? '', phone: '', mobile: customer.phone ?? '', email: customer.email ?? '' }
}
