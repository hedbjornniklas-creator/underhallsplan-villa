import 'server-only'

import {
  FORTNOX_API_BASE_URL,
  FORTNOX_CALLBACK_PATH,
  FORTNOX_CUSTOMER_LIST_LIMIT,
  FORTNOX_PRODUCTION_REDIRECT_URI,
  FORTNOX_TOKEN_ENDPOINT,
  hasExactFortnoxScopes,
  normalizeFortnoxClientId,
  normalizeFortnoxCustomerNumber,
  normalizeFortnoxOrganizationNumber,
  parseFortnoxCompanyInformation,
  parseFortnoxCustomerDraft,
  parseFortnoxCustomerListResponse,
  parseFortnoxCustomerResponse,
  parseFortnoxTokenResponse,
  type FortnoxCompanyInformation,
  type FortnoxCustomer,
  type FortnoxCustomerDraft,
  type FortnoxTokenResponse,
} from './domain'

const PROVIDER_TIMEOUT_MS = 15_000
const CUSTOMER_RESPONSE_MAX_BYTES = 64 * 1024
const CUSTOMER_LIST_RESPONSE_MAX_BYTES = 4 * 1024 * 1024
const CUSTOMER_ERROR_MAX_BYTES = 8 * 1024
const CUSTOMER_SEARCH_MAX_PAGES = 20

export type FortnoxConfiguration = {
  clientId: string
  clientSecret: string
  redirectUri: string
}

type FortnoxEnvironment = Record<string, string | undefined> & {
  APP_BASE_URL?: string
  FORTNOX_CLIENT_ID?: string
  FORTNOX_CLIENT_SECRET?: string
  FORTNOX_REDIRECT_URI?: string
}

type FetchImplementation = typeof fetch

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredConfigurationValue(value: string | undefined) {
  const normalized = value?.trim() ?? ''
  if (!normalized || normalized.length > 4096 || /[\r\n]/.test(normalized)) {
    throw new Error('FORTNOX_CONFIGURATION_MISSING')
  }
  return normalized
}

function validatedRedirectUri(value: string | undefined) {
  const candidate = value?.trim() || FORTNOX_PRODUCTION_REDIRECT_URI

  try {
    const parsed = new URL(candidate)
    const localHttp =
      parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' ||
        parsed.hostname === '127.0.0.1' ||
        parsed.hostname === '[::1]')

    if (
      (parsed.protocol !== 'https:' && !localHttp) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      parsed.pathname !== FORTNOX_CALLBACK_PATH
    ) {
      throw new Error('invalid redirect')
    }

    return parsed.toString()
  } catch {
    throw new Error('FORTNOX_CONFIGURATION_INVALID')
  }
}

function validatedApplicationOrigin(value: string) {
  try {
    const parsed = new URL(value.trim())
    const localHttp =
      parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' ||
        parsed.hostname === '127.0.0.1' ||
        parsed.hostname === '[::1]')
    if (
      (parsed.protocol !== 'https:' && !localHttp) ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error('invalid application origin')
    }
    return parsed.origin
  } catch {
    throw new Error('FORTNOX_CONFIGURATION_INVALID')
  }
}

export function getFortnoxConfiguration(
  environment: FortnoxEnvironment = process.env
): FortnoxConfiguration {
  const clientId = requiredConfigurationValue(environment.FORTNOX_CLIENT_ID)
  const normalizedClientId = normalizeFortnoxClientId(clientId)
  if (!normalizedClientId) throw new Error('FORTNOX_CONFIGURATION_INVALID')
  const redirectUri = validatedRedirectUri(environment.FORTNOX_REDIRECT_URI)
  if (
    environment.APP_BASE_URL?.trim() &&
    validatedApplicationOrigin(environment.APP_BASE_URL) !== new URL(redirectUri).origin
  ) {
    throw new Error('FORTNOX_CONFIGURATION_INVALID')
  }

  return {
    clientId: normalizedClientId,
    clientSecret: requiredConfigurationValue(environment.FORTNOX_CLIENT_SECRET),
    redirectUri,
  }
}

export function isFortnoxConfigured(environment: FortnoxEnvironment = process.env) {
  try {
    getFortnoxConfiguration(environment)
    return true
  } catch {
    return false
  }
}

function basicAuthorization(configuration: FortnoxConfiguration) {
  return `Basic ${Buffer.from(
    `${configuration.clientId}:${configuration.clientSecret}`,
    'utf8'
  ).toString('base64')}`
}

async function safeOAuthError(response: Response) {
  const declaredLength = Number(response.headers.get('content-length') ?? 0)
  if (!Number.isFinite(declaredLength) || declaredLength < 0 || declaredLength > 8192) {
    return null
  }

  try {
    const body = await response.text()
    if (new TextEncoder().encode(body).byteLength > 8192) return null
    const payload = JSON.parse(body) as unknown
    if (!isRecord(payload) || typeof payload.error !== 'string') return null
    return /^[a-z][a-z0-9_]{0,63}$/u.test(payload.error) ? payload.error : null
  } catch {
    return null
  }
}

async function providerFailure(
  response: Response,
  phase: 'authorization' | 'client_credentials' | 'company'
) {
  if (response.status === 429 || response.status >= 500) {
    return new Error('FORTNOX_TEMPORARILY_UNAVAILABLE')
  }
  if (phase === 'company' && response.status === 401) {
    return new Error('FORTNOX_ACCESS_TOKEN_REJECTED')
  }
  if (response.status === 403) {
    return new Error('FORTNOX_PERMISSION_OR_LICENSE_MISSING')
  }

  const oauthError = phase === 'company' ? null : await safeOAuthError(response)
  if (oauthError === 'error_missing_license' || oauthError === 'error_missing_app_license') {
    return new Error('FORTNOX_PERMISSION_OR_LICENSE_MISSING')
  }
  if (
    oauthError === 'invalid_client' ||
    oauthError === 'invalid_scope' ||
    oauthError === 'invalid_request' ||
    oauthError === 'unauthorized_client' ||
    oauthError === 'unsupported_grant_type' ||
    (!oauthError && response.status === 401)
  ) {
    return new Error('FORTNOX_CONFIGURATION_INVALID')
  }
  if (phase === 'authorization' && (oauthError === 'invalid_grant' || response.status === 400)) {
    return new Error('FORTNOX_AUTHORIZATION_REJECTED')
  }
  if (
    phase === 'client_credentials' &&
    (oauthError === 'invalid_grant' || oauthError === 'access_denied')
  ) {
    return new Error('FORTNOX_CLIENT_CREDENTIALS_REJECTED')
  }
  return new Error('FORTNOX_PROVIDER_REQUEST_FAILED')
}

async function requestJson(
  url: string,
  init: RequestInit,
  phase: 'authorization' | 'client_credentials' | 'company',
  fetchImplementation: FetchImplementation
) {
  let response: Response

  try {
    response = await fetchImplementation(url, {
      ...init,
      cache: 'no-store',
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    })
  } catch {
    throw new Error('FORTNOX_TEMPORARILY_UNAVAILABLE')
  }

  if (!response.ok) {
    throw await providerFailure(response, phase)
  }

  try {
    return (await response.json()) as unknown
  } catch {
    throw new Error('FORTNOX_INVALID_PROVIDER_RESPONSE')
  }
}

function assertSafeBearerToken(value: string) {
  if (!value || value.length > 8192 || /[\r\n]/.test(value)) {
    throw new Error('FORTNOX_INVALID_PROVIDER_RESPONSE')
  }
}

function parseTokenResponse(payload: unknown, requestedScopes: readonly string[]) {
  const token = parseFortnoxTokenResponse(payload, requestedScopes)
  if (token) return token

  const payloadScopes = isRecord(payload) ? payload.scope : undefined
  const validTokenEnvelope = isRecord(payload)
    ? parseFortnoxTokenResponse(
        { ...payload, scope: [...requestedScopes] },
        requestedScopes
      )
    : null

  if (validTokenEnvelope && !hasExactFortnoxScopes(payloadScopes, requestedScopes)) {
    throw new Error('FORTNOX_REQUIRED_SCOPE_MISSING')
  }

  throw new Error('FORTNOX_INVALID_PROVIDER_RESPONSE')
}

export async function exchangeFortnoxAuthorizationCode(
  input: {
    code: string
    requestedScopes: readonly string[]
    configuration: FortnoxConfiguration
  },
  fetchImplementation: FetchImplementation = fetch
): Promise<FortnoxTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.configuration.redirectUri,
  })
  const payload = await requestJson(
    FORTNOX_TOKEN_ENDPOINT,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: basicAuthorization(input.configuration),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    },
    'authorization',
    fetchImplementation
  )

  return parseTokenResponse(payload, input.requestedScopes)
}

export async function requestFortnoxClientCredentialsToken(
  input: {
    tenantId: string
    requestedScopes: readonly string[]
    configuration: FortnoxConfiguration
  },
  fetchImplementation: FetchImplementation = fetch
): Promise<FortnoxTokenResponse> {
  if (!/^[0-9]{1,32}$/.test(input.tenantId)) {
    throw new Error('FORTNOX_INVALID_TENANT')
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: input.requestedScopes.join(' '),
  })
  const payload = await requestJson(
    FORTNOX_TOKEN_ENDPOINT,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: basicAuthorization(input.configuration),
        'Content-Type': 'application/x-www-form-urlencoded',
        TenantId: input.tenantId,
      },
      body,
    },
    'client_credentials',
    fetchImplementation
  )

  return parseTokenResponse(payload, input.requestedScopes)
}

export async function fetchFortnoxCompanyInformation(
  accessToken: string,
  fetchImplementation: FetchImplementation = fetch
): Promise<FortnoxCompanyInformation> {
  assertSafeBearerToken(accessToken)
  const payload = await requestJson(
    `${FORTNOX_API_BASE_URL}/companyinformation`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    },
    'company',
    fetchImplementation
  )

  const company = parseFortnoxCompanyInformation(payload)
  if (!company) throw new Error('FORTNOX_INVALID_PROVIDER_RESPONSE')
  return company
}

async function boundedJson(response: Response, maxBytes: number): Promise<unknown | undefined> {
  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null) {
    const length = Number(declaredLength)
    if (!Number.isSafeInteger(length) || length < 0 || length > maxBytes) return undefined
  }
  if (!response.body) return undefined

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0

  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      byteLength += chunk.value.byteLength
      if (byteLength > maxBytes) {
        await reader.cancel()
        return undefined
      }
      chunks.push(chunk.value)
    }

    const bytes = new Uint8Array(byteLength)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  } catch {
    return undefined
  } finally {
    reader.releaseLock()
  }
}

async function safeCustomerErrorCode(response: Response): Promise<number | null> {
  const payload = await boundedJson(response, CUSTOMER_ERROR_MAX_BYTES)
  if (!isRecord(payload) || !isRecord(payload.ErrorInformation)) return null
  const code = payload.ErrorInformation.Code
  return typeof code === 'number' && Number.isSafeInteger(code) && code > 0 ? code : null
}

function customerReadFailure(response: Response) {
  if (response.status === 429 || response.status >= 500) {
    return new Error('FORTNOX_TEMPORARILY_UNAVAILABLE')
  }
  if (response.status === 401) return new Error('FORTNOX_ACCESS_TOKEN_REJECTED')
  if (response.status === 403) return new Error('FORTNOX_PERMISSION_OR_LICENSE_MISSING')
  return new Error('FORTNOX_PROVIDER_REQUEST_FAILED')
}

async function customerWriteFailure(response: Response) {
  if (response.status === 429 || response.status === 408 || response.status >= 500) {
    return new Error('FORTNOX_CUSTOMER_OUTCOME_UNKNOWN')
  }
  if (response.status === 401) return new Error('FORTNOX_ACCESS_TOKEN_REJECTED')
  if (response.status === 403) return new Error('FORTNOX_PERMISSION_OR_LICENSE_MISSING')

  const code = await safeCustomerErrorCode(response)
  if (code === 2_000_637) return new Error('FORTNOX_CUSTOMER_NUMBER_CONFLICT')
  if (response.status === 400 || response.status === 422) {
    return new Error('FORTNOX_CUSTOMER_REJECTED')
  }
  return new Error('FORTNOX_PROVIDER_REQUEST_FAILED')
}

function customerRequestHeaders(accessToken: string, includesBody = false) {
  assertSafeBearerToken(accessToken)
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
    ...(includesBody ? { 'Content-Type': 'application/json' } : {}),
  }
}

async function fetchCustomerReadResponse(
  url: string,
  accessToken: string,
  fetchImplementation: FetchImplementation
) {
  const headers = customerRequestHeaders(accessToken)
  try {
    return await fetchImplementation(url, {
      method: 'GET',
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    })
  } catch {
    throw new Error('FORTNOX_TEMPORARILY_UNAVAILABLE')
  }
}

export async function fetchFortnoxCustomer(
  accessToken: string,
  customerNumberValue: string,
  fetchImplementation: FetchImplementation = fetch
): Promise<FortnoxCustomer | null> {
  const customerNumber = normalizeFortnoxCustomerNumber(customerNumberValue)
  if (!customerNumber) throw new Error('FORTNOX_CUSTOMER_NUMBER_INVALID')

  const response = await fetchCustomerReadResponse(
    `${FORTNOX_API_BASE_URL}/customers/${encodeURIComponent(customerNumber)}`,
    accessToken,
    fetchImplementation
  )
  if (response.status === 404) return null
  if (!response.ok) throw customerReadFailure(response)

  const payload = await boundedJson(response, CUSTOMER_RESPONSE_MAX_BYTES)
  const customer = parseFortnoxCustomerResponse(payload)
  if (!customer) throw new Error('FORTNOX_INVALID_PROVIDER_RESPONSE')
  return customer
}

export async function findFortnoxCustomersByOrganizationNumber(
  accessToken: string,
  organizationNumberValue: string,
  fetchImplementation: FetchImplementation = fetch
): Promise<FortnoxCustomer[]> {
  const organizationNumber = normalizeFortnoxOrganizationNumber(organizationNumberValue)
  if (!organizationNumber) {
    throw new Error('FORTNOX_CUSTOMER_ORGANIZATION_NUMBER_INVALID')
  }

  const exactCustomers = new Map<string, FortnoxCustomer>()
  for (let page = 1; page <= CUSTOMER_SEARCH_MAX_PAGES; page += 1) {
    const url = new URL(`${FORTNOX_API_BASE_URL}/customers`)
    url.searchParams.set('organisationnumber', organizationNumber)
    url.searchParams.set('limit', String(FORTNOX_CUSTOMER_LIST_LIMIT))
    url.searchParams.set('page', String(page))

    const response = await fetchCustomerReadResponse(
      url.toString(),
      accessToken,
      fetchImplementation
    )
    if (!response.ok) throw customerReadFailure(response)

    const payload = await boundedJson(response, CUSTOMER_LIST_RESPONSE_MAX_BYTES)
    const list = parseFortnoxCustomerListResponse(payload)
    if (!list || list.meta.currentPage !== page || list.meta.totalPages > CUSTOMER_SEARCH_MAX_PAGES) {
      throw new Error('FORTNOX_INVALID_PROVIDER_RESPONSE')
    }

    for (const customer of list.customers) {
      if (customer.organizationNumber !== organizationNumber) continue
      const existing = exactCustomers.get(customer.customerNumber)
      if (
        existing &&
        (existing.externalReference !== customer.externalReference ||
          existing.organizationNumber !== customer.organizationNumber)
      ) {
        throw new Error('FORTNOX_INVALID_PROVIDER_RESPONSE')
      }
      exactCustomers.set(customer.customerNumber, customer)
    }

    if (list.meta.totalPages === 0 || page >= list.meta.totalPages) {
      return [...exactCustomers.values()]
    }
  }

  throw new Error('FORTNOX_INVALID_PROVIDER_RESPONSE')
}

export async function createFortnoxCustomer(
  accessToken: string,
  draftValue: FortnoxCustomerDraft,
  fetchImplementation: FetchImplementation = fetch
): Promise<FortnoxCustomer> {
  const draft = parseFortnoxCustomerDraft(draftValue)
  if (!draft) throw new Error('FORTNOX_CUSTOMER_PAYLOAD_INVALID')
  const headers = customerRequestHeaders(accessToken, true)

  let response: Response
  try {
    response = await fetchImplementation(`${FORTNOX_API_BASE_URL}/customers`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ Customer: draft }),
      cache: 'no-store',
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    })
  } catch {
    throw new Error('FORTNOX_CUSTOMER_OUTCOME_UNKNOWN')
  }

  if (!response.ok) throw await customerWriteFailure(response)
  if (response.status !== 201) throw new Error('FORTNOX_CUSTOMER_OUTCOME_UNKNOWN')

  const payload = await boundedJson(response, CUSTOMER_RESPONSE_MAX_BYTES)
  const customer = parseFortnoxCustomerResponse(payload)
  if (
    !customer ||
    customer.customerNumber !== draft.CustomerNumber ||
    customer.externalReference !== draft.ExternalReference ||
    customer.organizationNumber !== (draft.OrganisationNumber ?? null)
  ) {
    throw new Error('FORTNOX_CUSTOMER_OUTCOME_UNKNOWN')
  }
  return customer
}
