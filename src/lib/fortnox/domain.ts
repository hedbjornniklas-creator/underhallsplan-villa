export const FORTNOX_AUTHORIZATION_ENDPOINT = 'https://apps.fortnox.se/oauth-v1/auth'
export const FORTNOX_TOKEN_ENDPOINT = 'https://apps.fortnox.se/oauth-v1/token'
export const FORTNOX_API_BASE_URL = 'https://api.fortnox.se/3'
export const FORTNOX_CALLBACK_PATH = '/api/integrations/fortnox/callback'
export const FORTNOX_PRODUCTION_REDIRECT_URI = `https://hushub.se${FORTNOX_CALLBACK_PATH}`
export const FORTNOX_CONNECTION_SCOPES = Object.freeze(['companyinformation'] as const)

const ORGANIZATION_NUMBER_PATTERN = /^(\d{6})-?(\d{4})$/
const SCOPE_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/
const OAUTH_STATE_PATTERN = /^[A-Za-z0-9_-]{32,200}$/
const ACCESS_TOKEN_PATTERN = /^\S{1,8192}$/u
const TENANT_ID_PATTERN = /^[1-9][0-9]{0,31}$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/

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

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
