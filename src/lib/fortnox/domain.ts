export const FORTNOX_AUTHORIZATION_ENDPOINT = 'https://apps.fortnox.se/oauth-v1/auth'
export const FORTNOX_TOKEN_ENDPOINT = 'https://apps.fortnox.se/oauth-v1/token'
export const FORTNOX_API_BASE_URL = 'https://api.fortnox.se/3'
export const FORTNOX_CALLBACK_PATH = '/api/integrations/fortnox/callback'
export const FORTNOX_PRODUCTION_REDIRECT_URI = `https://hushub.se${FORTNOX_CALLBACK_PATH}`
export const FORTNOX_CONNECTION_SCOPES = Object.freeze([
  'companyinformation',
  'customer',
  'invoice',
] as const)

const ORGANIZATION_NUMBER_PATTERN = /^(\d{6})-?(\d{4})$/
const SCOPE_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/
const OAUTH_STATE_PATTERN = /^[A-Za-z0-9_-]{32,200}$/
const ACCESS_TOKEN_PATTERN = /^\S{1,8192}$/u
const TENANT_ID_PATTERN = /^[1-9][0-9]{0,31}$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const CUSTOMER_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
const GENERATED_CUSTOMER_IDENTIFIER_PATTERN = /^[A-Z0-9]+$/u
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u

export const FORTNOX_CUSTOMER_NUMBER_MAX_LENGTH = 50
export const FORTNOX_CUSTOMER_EXTERNAL_REFERENCE_MAX_LENGTH = 50
export const FORTNOX_CUSTOMER_LIST_LIMIT = 500

type UnknownRecord = Record<string, unknown>

export type FortnoxTokenResponse = {
  accessToken: string
  scopes: string[]
  expiresIn: number
  tokenType: 'bearer'
}

export type FortnoxCompanyInformation = {
  tenantId: string
  companyName: string
  organizationNumber: string
}

export type FortnoxCustomerIdentity = {
  customerNumber: string
  externalReference: string
  fallbackCustomerNumber: string
}

export type FortnoxCustomerDraftInput = {
  customerType: 'business' | 'private'
  name: string
  customerNumber: string
  externalReference: string
  organizationNumber?: string | null
  email?: string | null
  invoiceEmail?: string | null
  phone?: string | null
  address?: string | null
  addressLine2?: string | null
  postalCode?: string | null
  city?: string | null
  countryCode: string
}

export type FortnoxCustomerDraft = {
  Name: string
  CustomerNumber: string
  ExternalReference: string
  Type: 'COMPANY' | 'PRIVATE'
  Email?: string
  EmailInvoice?: string
  Phone1?: string
  Address1?: string
  Address2?: string
  ZipCode?: string
  City?: string
  CountryCode: string
  OrganisationNumber?: string
}

export type FortnoxCustomer = {
  customerNumber: string
  externalReference: string | null
  organizationNumber: string | null
}

export type FortnoxCustomerList = {
  customers: FortnoxCustomer[]
  meta: {
    currentPage: number
    totalPages: number
    totalResources: number
  }
}

const CUSTOMER_DRAFT_INPUT_KEYS = new Set([
  'customerType',
  'name',
  'customerNumber',
  'externalReference',
  'organizationNumber',
  'email',
  'invoiceEmail',
  'phone',
  'address',
  'addressLine2',
  'postalCode',
  'city',
  'countryCode',
])
const FORTNOX_CUSTOMER_DRAFT_KEYS = new Set([
  'Name',
  'CustomerNumber',
  'ExternalReference',
  'Type',
  'Email',
  'EmailInvoice',
  'Phone1',
  'Address1',
  'Address2',
  'ZipCode',
  'City',
  'CountryCode',
  'OrganisationNumber',
])

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeTrimmedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (
    !normalized ||
    normalized.length > maxLength ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    return null
  }
  return normalized
}

function optionalSafeText(value: unknown, maxLength: number): string | null | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return safeTrimmedText(value, maxLength)
}

function validInt32(value: unknown, minimum: number): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= 2_147_483_647
  )
}

function normalizeLocalCustomerNumber(value: unknown): string | null {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) return null
    value = String(value)
  } else if (typeof value === 'bigint') {
    value = value.toString()
  }
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,18}$/u.test(value)) return null
  return value.length > 4 || (value.length === 4 && value >= '1001') ? value : null
}

function normalizeGeneratedCustomerIdentifier(value: unknown, maxLength: number) {
  const normalized = safeTrimmedText(value, maxLength)
  return normalized && GENERATED_CUSTOMER_IDENTIFIER_PATTERN.test(normalized)
    ? normalized
    : null
}

export function normalizeFortnoxCustomerNumber(value: unknown): string | null {
  return safeTrimmedText(value, FORTNOX_CUSTOMER_NUMBER_MAX_LENGTH)
}

export function normalizeFortnoxClientId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const clientId = value.trim()
  if (
    !clientId ||
    clientId.length > 512 ||
    /\s/u.test(clientId) ||
    CONTROL_CHARACTER_PATTERN.test(clientId)
  ) {
    return null
  }
  return clientId
}

function hasValidLuhnCheckDigit(digits: string) {
  let checksum = 0
  for (let index = 0; index < digits.length; index += 1) {
    let digit = Number(digits[index])
    if (index % 2 === 0) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    checksum += digit
  }
  return checksum % 10 === 0
}

/** Normalizes the two common Swedish organization-number forms to XXXXXX-XXXX. */
export function normalizeFortnoxOrganizationNumber(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = value.trim().match(ORGANIZATION_NUMBER_PATTERN)
  if (!match) return null
  if (!hasValidLuhnCheckDigit(`${match[1]}${match[2]}`)) return null
  return `${match[1]}-${match[2]}`
}

/** Parses Fortnox's case-sensitive, space-delimited OAuth scope value. */
export function normalizeFortnoxScopes(value: unknown): string[] {
  let candidates: string[]

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return []
    candidates = trimmed.split(/\s+/u)
  } else if (Array.isArray(value) && value.every((item): item is string => typeof item === 'string')) {
    candidates = value.map((item) => item.trim())
    if (candidates.some((item) => !item || /\s/u.test(item))) return []
  } else {
    return []
  }

  if (candidates.some((scope) => !SCOPE_PATTERN.test(scope))) return []
  return [...new Set(candidates)]
}

export function hasRequiredFortnoxScopes(
  value: unknown,
  requiredScopes: readonly string[] = FORTNOX_CONNECTION_SCOPES
) {
  const scopes = normalizeFortnoxScopes(value)
  const required = normalizeFortnoxScopes(requiredScopes)
  if (!scopes.length || !required.length) return false
  const granted = new Set(scopes)
  return required.every((scope) => granted.has(scope))
}

export function hasExactFortnoxScopes(
  value: unknown,
  requiredScopes: readonly string[] = FORTNOX_CONNECTION_SCOPES
) {
  const scopes = normalizeFortnoxScopes(value)
  const required = normalizeFortnoxScopes(requiredScopes)
  return (
    scopes.length > 0 &&
    scopes.length === required.length &&
    required.every((scope) => scopes.includes(scope))
  )
}

/** Accepts the original identity-only grant or the current full grant. */
export function hasAllowedFortnoxConnectionScopes(value: unknown) {
  return (
    hasExactFortnoxScopes(value, ['companyinformation']) ||
    hasExactFortnoxScopes(value, FORTNOX_CONNECTION_SCOPES)
  )
}

export function buildFortnoxAuthorizationUrl(input: {
  clientId: string
  state: string
  redirectUri?: string
}) {
  const clientId = normalizeFortnoxClientId(input.clientId)
  if (!clientId) throw new Error('FORTNOX_CLIENT_ID_INVALID')
  if (!OAUTH_STATE_PATTERN.test(input.state)) {
    throw new Error('FORTNOX_STATE_INVALID')
  }

  const redirectUri = new URL(input.redirectUri ?? FORTNOX_PRODUCTION_REDIRECT_URI)
  const isLocalHttp =
    redirectUri.protocol === 'http:' &&
    (redirectUri.hostname === 'localhost' ||
      redirectUri.hostname === '127.0.0.1' ||
      redirectUri.hostname === '[::1]')
  if (
    (redirectUri.protocol !== 'https:' && !isLocalHttp) ||
    redirectUri.username ||
    redirectUri.password ||
    redirectUri.search ||
    redirectUri.hash ||
    redirectUri.pathname !== FORTNOX_CALLBACK_PATH
  ) {
    throw new Error('FORTNOX_REDIRECT_URI_INVALID')
  }

  const url = new URL(FORTNOX_AUTHORIZATION_ENDPOINT)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri.toString())
  url.searchParams.set('scope', FORTNOX_CONNECTION_SCOPES.join(' '))
  url.searchParams.set('state', input.state)
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('account_type', 'service')
  return url.toString()
}

export function parseFortnoxTokenResponse(
  value: unknown,
  requiredScopes: readonly string[] = FORTNOX_CONNECTION_SCOPES
): FortnoxTokenResponse | null {
  if (!isRecord(value)) return null

  const accessToken = value.access_token
  const tokenType = value.token_type
  const expiresIn = value.expires_in
  const scopes = normalizeFortnoxScopes(value.scope)

  if (
    typeof accessToken !== 'string' ||
    !ACCESS_TOKEN_PATTERN.test(accessToken) ||
    typeof tokenType !== 'string' ||
    tokenType.trim().toLowerCase() !== 'bearer' ||
    typeof expiresIn !== 'number' ||
    !Number.isSafeInteger(expiresIn) ||
    expiresIn <= 0 ||
    !hasExactFortnoxScopes(scopes, requiredScopes)
  ) {
    return null
  }

  return {
    accessToken,
    scopes,
    expiresIn,
    tokenType: 'bearer',
  }
}

export function parseFortnoxCompanyInformation(value: unknown): FortnoxCompanyInformation | null {
  if (!isRecord(value) || !isRecord(value.CompanyInformation)) return null

  const company = value.CompanyInformation
  const companyName = typeof company.CompanyName === 'string' ? company.CompanyName.trim() : ''
  const organizationNumber = normalizeFortnoxOrganizationNumber(company.OrganizationNumber)
  const databaseNumber = company.DatabaseNumber
  const tenantId =
    typeof databaseNumber === 'number' && Number.isSafeInteger(databaseNumber) && databaseNumber > 0
      ? String(databaseNumber)
      : typeof databaseNumber === 'string' && TENANT_ID_PATTERN.test(databaseNumber)
        ? databaseNumber
        : null

  if (
    !tenantId ||
    !organizationNumber ||
    !companyName ||
    companyName.length > 255 ||
    CONTROL_CHARACTER_PATTERN.test(companyName)
  ) {
    return null
  }

  return {
    tenantId,
    companyName,
    organizationNumber,
  }
}

/**
 * Creates stable, tenant-local Fortnox identifiers without putting a UUID,
 * punctuation or personal identity number in CustomerNumber.
 */
export function buildFortnoxCustomerIdentity(
  customerId: unknown,
  localNumber: unknown
): FortnoxCustomerIdentity {
  if (typeof customerId !== 'string' || !CUSTOMER_UUID_PATTERN.test(customerId)) {
    throw new Error('FORTNOX_CUSTOMER_IDENTITY_INVALID')
  }
  const normalizedLocalNumber = normalizeLocalCustomerNumber(localNumber)
  if (!normalizedLocalNumber) throw new Error('FORTNOX_CUSTOMER_IDENTITY_INVALID')

  const compactCustomerId = customerId.replaceAll('-', '').toUpperCase()
  return {
    customerNumber: `HH${normalizedLocalNumber}`,
    externalReference: `HH${compactCustomerId}`,
    fallbackCustomerNumber: `HH${normalizedLocalNumber}X${compactCustomerId.slice(0, 12)}`,
  }
}

/** Builds only the explicitly approved Fortnox customer fields. */
export function buildFortnoxCustomerDraft(input: FortnoxCustomerDraftInput): FortnoxCustomerDraft {
  if (
    !isRecord(input) ||
    Object.keys(input).some((key) => !CUSTOMER_DRAFT_INPUT_KEYS.has(key)) ||
    (input.customerType !== 'business' && input.customerType !== 'private')
  ) {
    throw new Error('FORTNOX_CUSTOMER_PAYLOAD_INVALID')
  }

  const name = safeTrimmedText(input.name, 200)
  const customerNumber = normalizeGeneratedCustomerIdentifier(
    input.customerNumber,
    FORTNOX_CUSTOMER_NUMBER_MAX_LENGTH
  )
  const externalReference = normalizeGeneratedCustomerIdentifier(
    input.externalReference,
    FORTNOX_CUSTOMER_EXTERNAL_REFERENCE_MAX_LENGTH
  )
  const countryCode = safeTrimmedText(input.countryCode, 2)?.toUpperCase() ?? null
  const email = optionalSafeText(input.email, 254)
  const invoiceEmail = optionalSafeText(input.invoiceEmail, 254)
  const phone = optionalSafeText(input.phone, 50)
  const address = optionalSafeText(input.address, 255)
  const addressLine2 = optionalSafeText(input.addressLine2, 255)
  const postalCode = optionalSafeText(input.postalCode, 10)
  const city = optionalSafeText(input.city, 120)

  if (
    !name ||
    !customerNumber ||
    !externalReference ||
    !countryCode ||
    !/^[A-Z]{2}$/u.test(countryCode) ||
    email === null ||
    invoiceEmail === null ||
    phone === null ||
    address === null ||
    addressLine2 === null ||
    postalCode === null ||
    city === null ||
    (email !== undefined && !EMAIL_PATTERN.test(email)) ||
    (invoiceEmail !== undefined && !EMAIL_PATTERN.test(invoiceEmail))
  ) {
    throw new Error('FORTNOX_CUSTOMER_PAYLOAD_INVALID')
  }

  const organizationNumber = normalizeFortnoxOrganizationNumber(input.organizationNumber)
  if (
    (input.customerType === 'business' && !organizationNumber) ||
    (input.customerType === 'private' && input.organizationNumber != null)
  ) {
    throw new Error('FORTNOX_CUSTOMER_PAYLOAD_INVALID')
  }

  return {
    Name: name,
    CustomerNumber: customerNumber,
    ExternalReference: externalReference,
    Type: input.customerType === 'business' ? 'COMPANY' : 'PRIVATE',
    ...(email === undefined ? {} : { Email: email }),
    ...(invoiceEmail === undefined ? {} : { EmailInvoice: invoiceEmail }),
    ...(phone === undefined ? {} : { Phone1: phone }),
    ...(address === undefined ? {} : { Address1: address }),
    ...(addressLine2 === undefined ? {} : { Address2: addressLine2 }),
    ...(postalCode === undefined ? {} : { ZipCode: postalCode }),
    ...(city === undefined ? {} : { City: city }),
    CountryCode: countryCode,
    ...(organizationNumber ? { OrganisationNumber: organizationNumber } : {}),
  }
}

/** Revalidates a draft at the provider boundary so cast values cannot add fields. */
export function parseFortnoxCustomerDraft(value: unknown): FortnoxCustomerDraft | null {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !FORTNOX_CUSTOMER_DRAFT_KEYS.has(key)) ||
    (value.Type !== 'COMPANY' && value.Type !== 'PRIVATE')
  ) {
    return null
  }

  try {
    return buildFortnoxCustomerDraft({
      customerType: value.Type === 'COMPANY' ? 'business' : 'private',
      name: value.Name as string,
      customerNumber: value.CustomerNumber as string,
      externalReference: value.ExternalReference as string,
      organizationNumber: value.OrganisationNumber as string | null | undefined,
      email: value.Email as string | null | undefined,
      invoiceEmail: value.EmailInvoice as string | null | undefined,
      phone: value.Phone1 as string | null | undefined,
      address: value.Address1 as string | null | undefined,
      addressLine2: value.Address2 as string | null | undefined,
      postalCode: value.ZipCode as string | null | undefined,
      city: value.City as string | null | undefined,
      countryCode: value.CountryCode as string,
    })
  } catch {
    return null
  }
}

function parseFortnoxCustomer(value: unknown): FortnoxCustomer | null {
  if (!isRecord(value)) return null

  const customerNumber = normalizeFortnoxCustomerNumber(value.CustomerNumber)
  const externalReference = optionalSafeText(
    value.ExternalReference,
    FORTNOX_CUSTOMER_EXTERNAL_REFERENCE_MAX_LENGTH
  )
  const organizationNumberValue = optionalSafeText(value.OrganisationNumber, 32)

  if (
    !customerNumber ||
    externalReference === null ||
    organizationNumberValue === null
  ) {
    return null
  }

  const organizationNumber = organizationNumberValue
    ? normalizeFortnoxOrganizationNumber(organizationNumberValue)
    : null
  if (organizationNumberValue && !organizationNumber) return null

  return {
    customerNumber,
    externalReference: externalReference ?? null,
    organizationNumber,
  }
}

export function parseFortnoxCustomerResponse(value: unknown): FortnoxCustomer | null {
  if (!isRecord(value)) return null
  return parseFortnoxCustomer(value.Customer)
}

export function parseFortnoxCustomerListResponse(value: unknown): FortnoxCustomerList | null {
  if (
    !isRecord(value) ||
    !Array.isArray(value.Customers) ||
    value.Customers.length > FORTNOX_CUSTOMER_LIST_LIMIT ||
    !isRecord(value.MetaInformation)
  ) {
    return null
  }

  const currentPage = value.MetaInformation['@CurrentPage']
  const totalPages = value.MetaInformation['@TotalPages']
  const totalResources = value.MetaInformation['@TotalResources']
  if (
    !validInt32(currentPage, 1) ||
    !validInt32(totalPages, 0) ||
    !validInt32(totalResources, 0) ||
    (totalPages === 0 && value.Customers.length > 0) ||
    (totalPages > 0 && currentPage > totalPages) ||
    totalResources < value.Customers.length
  ) {
    return null
  }

  const customers = value.Customers.map(parseFortnoxCustomer)
  if (customers.some((customer) => customer === null)) return null

  return {
    customers: customers as FortnoxCustomer[],
    meta: {
      currentPage,
      totalPages,
      totalResources,
    },
  }
}
