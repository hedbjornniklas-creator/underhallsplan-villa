import { normalizeFortnoxOrganizationNumber } from '@/lib/fortnox/domain'

export const ORGANIZATION_CUSTOMER_TYPES = ['business', 'private'] as const

export type OrganizationCustomerType = (typeof ORGANIZATION_CUSTOMER_TYPES)[number]

export type OrganizationCustomerInput = {
  customerType: OrganizationCustomerType
  name: string
  identityNumber: string | null
  email: string | null
  phone: string | null
  address: string | null
  addressLine2: string | null
  postalCode: string | null
  city: string | null
  countryCode: string
  invoiceSameAsCustomer: boolean
  invoiceName: string | null
  invoiceEmail: string | null
  invoiceAddress: string | null
  invoiceAddressLine2: string | null
  invoicePostalCode: string | null
  invoiceCity: string | null
  invoiceCountryCode: string | null
  invoiceReference: string | null
}

export type OrganizationCustomer = OrganizationCustomerInput & {
  id: string
  customerNumber: string
  fortnoxCustomerNumber: string | null
  isActive: boolean
  version: number
  createdAt: string
  updatedAt: string
}

export type OrganizationCustomerWorkspace = {
  organization: {
    id: string
    name: string | null
    canManage: boolean
  }
  customers: OrganizationCustomer[]
}

const INPUT_KEYS = new Set([
  'customerType',
  'name',
  'identityNumber',
  'email',
  'phone',
  'address',
  'addressLine2',
  'postalCode',
  'city',
  'countryCode',
  'invoiceSameAsCustomer',
  'invoiceName',
  'invoiceEmail',
  'invoiceAddress',
  'invoiceAddressLine2',
  'invoicePostalCode',
  'invoiceCity',
  'invoiceCountryCode',
  'invoiceReference',
])

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredText(value: unknown, maxLength: number, errorCode: string) {
  if (typeof value !== 'string') throw new Error(errorCode)
  const normalized = value.trim()
  if (
    !normalized ||
    normalized.length > maxLength ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    throw new Error(errorCode)
  }
  return normalized
}

function optionalText(value: unknown, maxLength: number, errorCode: string) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw new Error(errorCode)
  const normalized = value.trim()
  if (!normalized) return null
  if (normalized.length > maxLength || CONTROL_CHARACTER_PATTERN.test(normalized)) {
    throw new Error(errorCode)
  }
  return normalized
}

function optionalEmail(value: unknown, errorCode: string) {
  const normalized = optionalText(value, 254, errorCode)?.toLowerCase() ?? null
  if (normalized && !EMAIL_PATTERN.test(normalized)) throw new Error(errorCode)
  return normalized
}

function countryCode(value: unknown, fallback: string | null, errorCode: string) {
  if ((value === undefined || value === null || value === '') && fallback !== null) return fallback
  const normalized = optionalText(value, 2, errorCode)?.toUpperCase() ?? null
  if (!normalized || !/^[A-Z]{2}$/u.test(normalized)) throw new Error(errorCode)
  return normalized
}

/**
 * Accepts the common 10- and 12-digit Swedish forms. Business identities are
 * checksum-validated for Fortnox matching; private identities are only
 * canonicalized here and remain optional in the first customer-register version.
 */
export function normalizeOrganizationCustomerIdentity(
  value: unknown,
  customerType: OrganizationCustomerType = 'business'
): string | null {
  if (typeof value !== 'string') return null
  const compact = value.trim().replace(/[\s-]/gu, '')
  const tenDigits =
    compact.length === 12 &&
    (customerType === 'business'
      ? compact.startsWith('16')
      : compact.startsWith('19') || compact.startsWith('20'))
      ? compact.slice(2)
      : compact
  if (customerType === 'business') return normalizeFortnoxOrganizationNumber(tenDigits)
  if (!/^[0-9]{10}$/u.test(tenDigits)) return null
  return `${tenDigits.slice(0, 6)}-${tenDigits.slice(6)}`
}

export function parseOrganizationCustomerInput(value: unknown): OrganizationCustomerInput {
  if (!isRecord(value) || Object.keys(value).some((key) => !INPUT_KEYS.has(key))) {
    throw new Error('CUSTOMER_REQUEST_INVALID')
  }

  if (!ORGANIZATION_CUSTOMER_TYPES.includes(value.customerType as OrganizationCustomerType)) {
    throw new Error('CUSTOMER_TYPE_INVALID')
  }
  const customerType = value.customerType as OrganizationCustomerType
  const name = requiredText(value.name, 200, 'CUSTOMER_NAME_REQUIRED')

  const rawIdentity = optionalText(value.identityNumber, 32, 'CUSTOMER_IDENTITY_INVALID')
  const identityNumber = rawIdentity
    ? normalizeOrganizationCustomerIdentity(rawIdentity, customerType)
    : null
  if (rawIdentity && !identityNumber) throw new Error('CUSTOMER_IDENTITY_INVALID')
  if (customerType === 'business' && !identityNumber) {
    throw new Error('CUSTOMER_IDENTITY_REQUIRED')
  }

  if (typeof value.invoiceSameAsCustomer !== 'boolean') {
    throw new Error('CUSTOMER_REQUEST_INVALID')
  }
  const invoiceSameAsCustomer = value.invoiceSameAsCustomer
  const invoiceReference = optionalText(
    value.invoiceReference,
    120,
    'CUSTOMER_INVOICE_REFERENCE_INVALID'
  )

  const base = {
    customerType,
    name,
    identityNumber,
    email: optionalEmail(value.email, 'CUSTOMER_EMAIL_INVALID'),
    phone: optionalText(value.phone, 50, 'CUSTOMER_PHONE_INVALID'),
    address: optionalText(value.address, 255, 'CUSTOMER_ADDRESS_INVALID'),
    addressLine2: optionalText(value.addressLine2, 255, 'CUSTOMER_ADDRESS_INVALID'),
    postalCode: optionalText(value.postalCode, 32, 'CUSTOMER_POSTAL_CODE_INVALID'),
    city: optionalText(value.city, 120, 'CUSTOMER_CITY_INVALID'),
    countryCode: countryCode(value.countryCode, 'SE', 'CUSTOMER_COUNTRY_INVALID'),
    invoiceSameAsCustomer,
    invoiceReference,
  }

  if (invoiceSameAsCustomer) {
    return {
      ...base,
      invoiceName: null,
      invoiceEmail: null,
      invoiceAddress: null,
      invoiceAddressLine2: null,
      invoicePostalCode: null,
      invoiceCity: null,
      invoiceCountryCode: null,
    }
  }

  return {
    ...base,
    invoiceName: requiredText(value.invoiceName, 200, 'CUSTOMER_INVOICE_NAME_REQUIRED'),
    invoiceEmail: optionalEmail(value.invoiceEmail, 'CUSTOMER_INVOICE_EMAIL_INVALID'),
    invoiceAddress: optionalText(
      value.invoiceAddress,
      255,
      'CUSTOMER_INVOICE_ADDRESS_INVALID'
    ),
    invoiceAddressLine2: optionalText(
      value.invoiceAddressLine2,
      255,
      'CUSTOMER_INVOICE_ADDRESS_INVALID'
    ),
    invoicePostalCode: optionalText(
      value.invoicePostalCode,
      32,
      'CUSTOMER_INVOICE_POSTAL_CODE_INVALID'
    ),
    invoiceCity: optionalText(value.invoiceCity, 120, 'CUSTOMER_INVOICE_CITY_INVALID'),
    invoiceCountryCode: countryCode(
      value.invoiceCountryCode,
      'SE',
      'CUSTOMER_INVOICE_COUNTRY_INVALID'
    ),
  }
}
