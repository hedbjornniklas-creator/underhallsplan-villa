import 'server-only'

export const CUSTOMER_RESPONSE_HEADERS = Object.freeze({
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
  Vary: 'Cookie',
})

export type CustomerFailure = {
  code: string
  message: string
  status: number
}

const FAILURES: Readonly<Record<string, Omit<CustomerFailure, 'code'>>> = Object.freeze({
  UNAUTHORIZED: {
    message: 'Logga in för att fortsätta.',
    status: 401,
  },
  PRODUCT_ACCESS_REQUIRED: {
    message: 'Du saknar behörighet till BesiktApp.',
    status: 403,
  },
  MODULE_ACCESS_REQUIRED: {
    message: 'Du saknar administratörsbehörighet för organisationen.',
    status: 403,
  },
  ORG_MEMBERSHIP_REQUIRED: {
    message: 'Du saknar en aktiv organisationstillhörighet.',
    status: 403,
  },
  CUSTOMER_ORGANIZATION_ADMIN_REQUIRED: {
    message: 'Endast en organisationsadministratör kan ändra kundregistret.',
    status: 403,
  },
  CUSTOMER_ORIGIN_FORBIDDEN: {
    message: 'Otillåten begäran.',
    status: 403,
  },
  CUSTOMER_REQUEST_INVALID: {
    message: 'Kunduppgifterna är ogiltiga.',
    status: 400,
  },
  CUSTOMER_ID_INVALID: {
    message: 'Kunden är ogiltig.',
    status: 400,
  },
  CUSTOMER_TYPE_INVALID: {
    message: 'Välj om kunden är företag/BRF eller privatperson.',
    status: 400,
  },
  CUSTOMER_NAME_REQUIRED: {
    message: 'Ange kundens namn.',
    status: 400,
  },
  CUSTOMER_IDENTITY_REQUIRED: {
    message: 'Organisationsnummer krävs för företag och BRF.',
    status: 400,
  },
  CUSTOMER_IDENTITY_INVALID: {
    message: 'Kontrollera organisations- eller personnumret.',
    status: 400,
  },
  CUSTOMER_EMAIL_INVALID: {
    message: 'Kontrollera kundens e-postadress.',
    status: 400,
  },
  CUSTOMER_PHONE_INVALID: {
    message: 'Kontrollera kundens telefonnummer.',
    status: 400,
  },
  CUSTOMER_ADDRESS_INVALID: {
    message: 'Kontrollera kundens adress.',
    status: 400,
  },
  CUSTOMER_POSTAL_CODE_INVALID: {
    message: 'Kontrollera kundens postnummer.',
    status: 400,
  },
  CUSTOMER_CITY_INVALID: {
    message: 'Kontrollera kundens ort.',
    status: 400,
  },
  CUSTOMER_COUNTRY_INVALID: {
    message: 'Kontrollera kundens landskod.',
    status: 400,
  },
  CUSTOMER_INVOICE_NAME_REQUIRED: {
    message: 'Ange fakturamottagarens namn.',
    status: 400,
  },
  CUSTOMER_INVOICE_EMAIL_INVALID: {
    message: 'Kontrollera fakturamottagarens e-postadress.',
    status: 400,
  },
  CUSTOMER_INVOICE_ADDRESS_INVALID: {
    message: 'Kontrollera fakturaadressen.',
    status: 400,
  },
  CUSTOMER_INVOICE_POSTAL_CODE_INVALID: {
    message: 'Kontrollera fakturamottagarens postnummer.',
    status: 400,
  },
  CUSTOMER_INVOICE_CITY_INVALID: {
    message: 'Kontrollera fakturamottagarens ort.',
    status: 400,
  },
  CUSTOMER_INVOICE_COUNTRY_INVALID: {
    message: 'Kontrollera fakturamottagarens landskod.',
    status: 400,
  },
  CUSTOMER_INVOICE_REFERENCE_INVALID: {
    message: 'Kontrollera fakturareferensen.',
    status: 400,
  },
  CUSTOMER_IDENTITY_EXISTS: {
    message: 'Det finns redan en kund med samma organisations- eller personnummer.',
    status: 409,
  },
  CUSTOMER_VERSION_CONFLICT: {
    message: 'Kunden har ändrats av någon annan. Ladda om kundregistret och försök igen.',
    status: 409,
  },
  CUSTOMER_NOT_FOUND: {
    message: 'Kunden kunde inte hittas.',
    status: 404,
  },
  CUSTOMERS_SCHEMA_REQUIRED: {
    message: 'Databasmigrationen för kundregistret behöver köras.',
    status: 503,
  },
})

const UNKNOWN_FAILURE = Object.freeze({
  code: 'CUSTOMER_REQUEST_FAILED',
  message: 'Kundregistret kunde inte hanteras just nu. Försök igen.',
  status: 500,
})

const MAX_BODY_BYTES = 16 * 1024

export function assertCustomerSameOrigin(request: Request) {
  const origin = request.headers.get('origin')
  const fetchSite = request.headers.get('sec-fetch-site')
  let requestOrigin: string

  try {
    requestOrigin = new URL(request.url).origin
  } catch {
    throw new Error('CUSTOMER_ORIGIN_FORBIDDEN')
  }

  if (
    !origin ||
    origin !== requestOrigin ||
    (fetchSite !== null && fetchSite !== 'same-origin' && fetchSite !== 'none')
  ) {
    throw new Error('CUSTOMER_ORIGIN_FORBIDDEN')
  }
}

export function customerFailure(error: unknown): CustomerFailure {
  const code = error instanceof Error ? error.message : ''
  const known = Object.prototype.hasOwnProperty.call(FAILURES, code)
    ? FAILURES[code]
    : undefined
  return known ? { code, ...known } : UNKNOWN_FAILURE
}

export async function readCustomerJson(request: Request): Promise<Record<string, unknown>> {
  const mediaType = request.headers
    .get('content-type')
    ?.split(';', 1)[0]
    .trim()
    .toLowerCase()
  const contentLengthHeader = request.headers.get('content-length')
  const contentLength = contentLengthHeader === null ? null : Number(contentLengthHeader)

  if (
    mediaType !== 'application/json' ||
    (contentLength !== null &&
      (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > MAX_BODY_BYTES))
  ) {
    throw new Error('CUSTOMER_REQUEST_INVALID')
  }

  const raw = await request.text()
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    throw new Error('CUSTOMER_REQUEST_INVALID')
  }

  let body: unknown
  try {
    body = JSON.parse(raw) as unknown
  } catch {
    throw new Error('CUSTOMER_REQUEST_INVALID')
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('CUSTOMER_REQUEST_INVALID')
  }
  return body as Record<string, unknown>
}
