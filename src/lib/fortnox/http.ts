import 'server-only'

import { FORTNOX_CALLBACK_PATH } from './domain'

export const FORTNOX_RESPONSE_HEADERS = Object.freeze({
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
  Vary: 'Cookie',
})

export type FortnoxFailure = {
  code: string
  message: string
  status: number
}

export type FortnoxCallbackStatus =
  | 'connected'
  | 'cancelled'
  | 'login_required'
  | 'hushub_access_denied'
  | 'fortnox_access_denied'
  | 'permission_or_license_missing'
  | 'scope_missing'
  | 'state_invalid'
  | 'callback_invalid'
  | 'superseded'
  | 'organization_mismatch'
  | 'tenant_conflict'
  | 'configuration_error'
  | 'provider_unavailable'
  | 'failed'

const CALLBACK_STATUSES = new Set<FortnoxCallbackStatus>([
  'connected',
  'cancelled',
  'login_required',
  'hushub_access_denied',
  'fortnox_access_denied',
  'permission_or_license_missing',
  'scope_missing',
  'state_invalid',
  'callback_invalid',
  'superseded',
  'organization_mismatch',
  'tenant_conflict',
  'configuration_error',
  'provider_unavailable',
  'failed',
])

const FAILURE_DEFINITIONS: Readonly<Record<string, Omit<FortnoxFailure, 'code'>>> =
  Object.freeze({
    UNAUTHORIZED: {
      message: 'Logga in för att fortsätta.',
      status: 401,
    },
    PRODUCT_ACCESS_REQUIRED: {
      message: 'Du saknar behörighet till BesiktApp.',
      status: 403,
    },
    MODULE_ACCESS_REQUIRED: {
      message: 'Du saknar behörighet att hantera organisationens Fortnox-anslutning.',
      status: 403,
    },
    FORTNOX_ORIGIN_FORBIDDEN: {
      message: 'Otillåten begäran.',
      status: 403,
    },
    FORTNOX_ORGANIZATION_INVALID: {
      message: 'Organisationen är ogiltig.',
      status: 400,
    },
    FORTNOX_ORGANIZATION_MEMBER_REQUIRED: {
      message: 'Du saknar tillgång till organisationen.',
      status: 403,
    },
    FORTNOX_ORGANIZATION_ADMIN_REQUIRED: {
      message: 'Endast en organisationsadministratör kan hantera Fortnox-anslutningen.',
      status: 403,
    },
    FORTNOX_ORGANIZATION_NOT_FOUND: {
      message: 'Organisationen kunde inte hittas.',
      status: 404,
    },
    FORTNOX_ORGANIZATION_NUMBER_INVALID: {
      message: 'Ange ett giltigt svenskt organisationsnummer.',
      status: 400,
    },
    FORTNOX_ORGANIZATION_NUMBER_REQUIRED: {
      message: 'Spara organisationens organisationsnummer innan Fortnox ansluts.',
      status: 409,
    },
    FORTNOX_ORGANIZATION_NUMBER_LOCKED: {
      message: 'Organisationsnumret måste stämma med det anslutna Fortnox-företaget.',
      status: 409,
    },
    FORTNOX_STATE_INVALID: {
      message: 'Fortnox-anslutningen har löpt ut eller har redan använts. Starta om anslutningen.',
      status: 400,
    },
    FORTNOX_CALLBACK_INVALID: {
      message: 'Svaret från Fortnox är ogiltigt. Starta om anslutningen.',
      status: 400,
    },
    FORTNOX_AUTHORIZATION_CANCELLED: {
      message: 'Godkännandet i Fortnox avbröts.',
      status: 400,
    },
    FORTNOX_AUTHORIZATION_REJECTED: {
      message: 'Fortnox kunde inte godkänna anslutningen.',
      status: 400,
    },
    FORTNOX_AUTHORIZATION_SUPERSEDED: {
      message: 'Ett nyare Fortnox-försök har redan startats. Fortsätt med det senaste försöket.',
      status: 409,
    },
    FORTNOX_PERMISSION_OR_LICENSE_MISSING: {
      message: 'Fortnox-behörighet eller nödvändig licens saknas.',
      status: 403,
    },
    FORTNOX_REQUIRED_SCOPE_MISSING: {
      message: 'Fortnox gav inte den behörighet som anslutningen behöver. Godkänn anslutningen på nytt.',
      status: 409,
    },
    FORTNOX_ORGANIZATION_MISMATCH: {
      message: 'Det valda Fortnox-företaget har ett annat organisationsnummer.',
      status: 409,
    },
    FORTNOX_TENANT_ALREADY_CONNECTED: {
      message: 'Det valda Fortnox-företaget är redan anslutet till en annan organisation.',
      status: 409,
    },
    FORTNOX_COMPANY_VERIFICATION_FAILED: {
      message: 'Fortnox-företaget kunde inte verifieras säkert.',
      status: 502,
    },
    FORTNOX_CLIENT_CREDENTIALS_REJECTED: {
      message: 'Fortnox avvisade den långsiktiga anslutningen. Godkänn anslutningen på nytt.',
      status: 502,
    },
    FORTNOX_ACCESS_TOKEN_REJECTED: {
      message: 'Fortnox avvisade åtkomsten. Godkänn anslutningen på nytt.',
      status: 502,
    },
    FORTNOX_INVALID_TENANT: {
      message: 'Fortnox returnerade en ogiltig företagsidentifierare.',
      status: 502,
    },
    FORTNOX_INVALID_PROVIDER_RESPONSE: {
      message: 'Fortnox returnerade ett oväntat svar.',
      status: 502,
    },
    FORTNOX_PROVIDER_REQUEST_FAILED: {
      message: 'Anropet till Fortnox misslyckades.',
      status: 502,
    },
    FORTNOX_TEMPORARILY_UNAVAILABLE: {
      message: 'Fortnox kan inte nås just nu. Försök igen om en stund.',
      status: 503,
    },
    FORTNOX_CONFIGURATION_MISSING: {
      message: 'Fortnox-anslutningen är inte konfigurerad på servern.',
      status: 503,
    },
    FORTNOX_CONFIGURATION_INVALID: {
      message: 'Fortnox-anslutningens serverkonfiguration är ogiltig.',
      status: 503,
    },
    FORTNOX_CLIENT_ID_INVALID: {
      message: 'Fortnox-anslutningens serverkonfiguration är ogiltig.',
      status: 503,
    },
    FORTNOX_REDIRECT_URI_INVALID: {
      message: 'Fortnox-anslutningens serverkonfiguration är ogiltig.',
      status: 503,
    },
    FORTNOX_DATABASE_NOT_READY: {
      message: 'Databasstödet för Fortnox behöver installeras innan anslutningen kan användas.',
      status: 503,
    },
    FORTNOX_DATABASE_FAILED: {
      message: 'Fortnox-anslutningen kunde inte läsas eller sparas just nu.',
      status: 500,
    },
    FORTNOX_CONNECTION_NOT_FOUND: {
      message: 'Det finns ingen Fortnox-anslutning att kontrollera för organisationen.',
      status: 404,
    },
    FORTNOX_CONNECTION_NEEDS_REAUTHORIZATION: {
      message: 'Fortnox-anslutningen behöver godkännas på nytt innan kunder kan överföras.',
      status: 409,
    },
    FORTNOX_CUSTOMER_ID_INVALID: {
      message: 'Kunden är ogiltig.',
      status: 400,
    },
    FORTNOX_CUSTOMER_VERSION_INVALID: {
      message: 'Kundversionen är ogiltig.',
      status: 400,
    },
    FORTNOX_CUSTOMER_NOT_FOUND: {
      message: 'Kunden kunde inte hittas i den valda organisationen.',
      status: 404,
    },
    FORTNOX_CUSTOMER_INACTIVE: {
      message: 'Aktivera kunden innan den överförs till Fortnox.',
      status: 409,
    },
    FORTNOX_CUSTOMER_VERSION_CONFLICT: {
      message: 'Kunden har ändrats. Ladda om kundregistret och försök igen.',
      status: 409,
    },
    FORTNOX_CUSTOMER_TENANT_CONFLICT: {
      message: 'Kunden är kopplad till ett annat Fortnox-företag och kan inte flyttas automatiskt.',
      status: 409,
    },
    FORTNOX_CUSTOMER_MATCH_AMBIGUOUS: {
      message: 'Flera Fortnox-kunder har samma organisationsnummer. Kopplingen behöver kontrolleras manuellt.',
      status: 409,
    },
    FORTNOX_CUSTOMER_NUMBER_CONFLICT: {
      message: 'Det planerade kundnumret används redan i Fortnox.',
      status: 409,
    },
    FORTNOX_CUSTOMER_NUMBER_COLLISION: {
      message: 'Det planerade kundnumret används redan av en annan Fortnox-kund. Kopplingen behöver kontrolleras manuellt.',
      status: 409,
    },
    FORTNOX_CUSTOMER_REJECTED: {
      message: 'Fortnox avvisade kunduppgifterna. Kontrollera kundens namn, adress och postnummer.',
      status: 422,
    },
    FORTNOX_CUSTOMER_OUTCOME_UNKNOWN: {
      message: 'Fortnox kunde inte bekräfta överföringen. Ingen ny kund skapas innan samma kundnummer har kontrollerats.',
      status: 503,
    },
    FORTNOX_CUSTOMER_BINDING_SUPERSEDED: {
      message: 'Kunden eller Fortnox-anslutningen ändrades under överföringen. Ladda om kundregistret.',
      status: 409,
    },
    FORTNOX_CUSTOMER_BINDING_SCHEMA_REQUIRED: {
      message: 'Databasstödet för Fortnox-kunder behöver installeras innan överföringen kan användas.',
      status: 503,
    },
    FORTNOX_VERIFICATION_SUPERSEDED: {
      message: 'Anslutningen ändrades medan kontrollen pågick. Statusen har hämtats på nytt.',
      status: 409,
    },
    FORTNOX_REQUEST_INVALID: {
      message: 'Begäran är ogiltig.',
      status: 400,
    },
    FORTNOX_REQUEST_TOO_LARGE: {
      message: 'Begäran är för stor.',
      status: 413,
    },
    FORTNOX_CONTENT_TYPE_INVALID: {
      message: 'Begäran har ett format som inte stöds.',
      status: 415,
    },
  })

const UNKNOWN_FAILURE: FortnoxFailure = Object.freeze({
  code: 'FORTNOX_REQUEST_FAILED',
  message: 'Fortnox-anslutningen kunde inte hanteras just nu. Försök igen.',
  status: 500,
})

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PRODUCTION_ORIGIN = 'https://hushub.se'

export function assertFortnoxSameOrigin(request: Request): void {
  const origin = request.headers.get('origin')
  const fetchSite = request.headers.get('sec-fetch-site')
  let requestOrigin: string

  try {
    requestOrigin = new URL(request.url).origin
  } catch {
    throw new Error('FORTNOX_ORIGIN_FORBIDDEN')
  }

  if (
    !origin ||
    origin !== requestOrigin ||
    (fetchSite !== null && fetchSite !== 'same-origin' && fetchSite !== 'none')
  ) {
    throw new Error('FORTNOX_ORIGIN_FORBIDDEN')
  }
}

export function fortnoxFailure(error: unknown): FortnoxFailure {
  const code = error instanceof Error ? error.message : ''
  const known = Object.prototype.hasOwnProperty.call(FAILURE_DEFINITIONS, code)
    ? FAILURE_DEFINITIONS[code]
    : undefined
  return known ? { code, ...known } : { ...UNKNOWN_FAILURE }
}

export function fortnoxCallbackStatus(error: unknown): FortnoxCallbackStatus {
  const code = fortnoxFailure(error).code

  if (code === 'FORTNOX_AUTHORIZATION_CANCELLED') return 'cancelled'
  if (code === 'UNAUTHORIZED') return 'login_required'
  if (
    code === 'PRODUCT_ACCESS_REQUIRED' ||
    code === 'MODULE_ACCESS_REQUIRED' ||
    code === 'FORTNOX_ORGANIZATION_MEMBER_REQUIRED' ||
    code === 'FORTNOX_ORGANIZATION_ADMIN_REQUIRED' ||
    code === 'FORTNOX_ORGANIZATION_NOT_FOUND'
  ) {
    return 'hushub_access_denied'
  }
  if (code === 'FORTNOX_AUTHORIZATION_REJECTED') return 'fortnox_access_denied'
  if (
    code === 'FORTNOX_CLIENT_CREDENTIALS_REJECTED' ||
    code === 'FORTNOX_ACCESS_TOKEN_REJECTED'
  ) {
    return 'fortnox_access_denied'
  }
  if (code === 'FORTNOX_PERMISSION_OR_LICENSE_MISSING') {
    return 'permission_or_license_missing'
  }
  if (code === 'FORTNOX_REQUIRED_SCOPE_MISSING') return 'scope_missing'
  if (code === 'FORTNOX_STATE_INVALID') return 'state_invalid'
  if (code === 'FORTNOX_CALLBACK_INVALID') return 'callback_invalid'
  if (code === 'FORTNOX_AUTHORIZATION_SUPERSEDED') return 'superseded'
  if (
    code === 'FORTNOX_ORGANIZATION_MISMATCH' ||
    code === 'FORTNOX_COMPANY_VERIFICATION_FAILED'
  ) {
    return 'organization_mismatch'
  }
  if (code === 'FORTNOX_TENANT_ALREADY_CONNECTED') return 'tenant_conflict'
  if (
    code === 'FORTNOX_CONFIGURATION_MISSING' ||
    code === 'FORTNOX_CONFIGURATION_INVALID' ||
    code === 'FORTNOX_CLIENT_ID_INVALID' ||
    code === 'FORTNOX_REDIRECT_URI_INVALID' ||
    code === 'FORTNOX_DATABASE_NOT_READY'
  ) {
    return 'configuration_error'
  }
  if (
    code === 'FORTNOX_TEMPORARILY_UNAVAILABLE' ||
    code === 'FORTNOX_PROVIDER_REQUEST_FAILED' ||
    code === 'FORTNOX_INVALID_PROVIDER_RESPONSE'
  ) {
    return 'provider_unavailable'
  }
  return 'failed'
}

function isLoopbackHostname(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

function configuredApplicationOrigin() {
  const candidate = process.env.APP_BASE_URL?.trim()
  if (!candidate || candidate.length > 2048 || /[\r\n]/.test(candidate)) return null

  try {
    const url = new URL(candidate)
    const localDevelopmentHttp =
      process.env.NODE_ENV === 'development' &&
      url.protocol === 'http:' &&
      isLoopbackHostname(url.hostname)

    if (
      (url.protocol !== 'https:' && !localDevelopmentHttp) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      return null
    }

    return url.origin
  } catch {
    return null
  }
}

function configuredFortnoxRedirectOrigin() {
  const candidate = process.env.FORTNOX_REDIRECT_URI?.trim()
  if (!candidate || candidate.length > 2048 || /[\r\n]/.test(candidate)) return null

  try {
    const url = new URL(candidate)
    const localDevelopmentHttp =
      process.env.NODE_ENV === 'development' &&
      url.protocol === 'http:' &&
      isLoopbackHostname(url.hostname)
    if (
      (url.protocol !== 'https:' && !localDevelopmentHttp) ||
      url.username ||
      url.password ||
      url.pathname !== FORTNOX_CALLBACK_PATH ||
      url.search ||
      url.hash
    ) {
      return null
    }
    return url.origin
  } catch {
    return null
  }
}

function localDevelopmentRequestOrigin(requestUrl: string) {
  if (process.env.NODE_ENV !== 'development') return null

  try {
    const url = new URL(requestUrl)
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      !isLoopbackHostname(url.hostname) ||
      url.username ||
      url.password
    ) {
      return null
    }
    return url.origin
  } catch {
    return null
  }
}

function isCallbackStatus(value: unknown): value is FortnoxCallbackStatus {
  return typeof value === 'string' && CALLBACK_STATUSES.has(value as FortnoxCallbackStatus)
}

export function buildFortnoxSettingsRedirect(
  requestUrl: string,
  status: unknown,
  orgId?: unknown
) {
  const origin =
    configuredFortnoxRedirectOrigin() ??
    configuredApplicationOrigin() ??
    localDevelopmentRequestOrigin(requestUrl) ??
    PRODUCTION_ORIGIN
  const redirect = new URL('/settings', `${origin}/`)
  redirect.searchParams.set('fortnox', isCallbackStatus(status) ? status : 'failed')
  if (typeof orgId === 'string' && UUID_PATTERN.test(orgId)) {
    redirect.searchParams.set('orgId', orgId.toLowerCase())
  }
  return redirect
}
