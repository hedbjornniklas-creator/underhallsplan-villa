import 'server-only'

export const ASSIGNMENT_CUSTOMER_RESPONSE_HEADERS = Object.freeze({
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
  Vary: 'Cookie',
})

export type AssignmentCustomerFailure = {
  code: string
  message: string
  status: number
}

const FAILURES: Readonly<
  Record<string, Omit<AssignmentCustomerFailure, 'code'>>
> = Object.freeze({
  UNAUTHORIZED: { message: 'Logga in för att fortsätta.', status: 401 },
  PRODUCT_ACCESS_REQUIRED: {
    message: 'Du saknar behörighet till BesiktApp.',
    status: 403,
  },
  MODULE_ACCESS_REQUIRED: {
    message: 'Du saknar behörighet till den valda organisationen.',
    status: 403,
  },
  ASSIGNMENT_CUSTOMER_MEMBER_REQUIRED: {
    message: 'Du saknar en aktiv behörighet i den valda organisationen.',
    status: 403,
  },
  ASSIGNMENT_CUSTOMER_ORIGIN_FORBIDDEN: {
    message: 'Otillåten begäran.',
    status: 403,
  },
  ASSIGNMENT_CUSTOMER_REQUEST_INVALID: {
    message: 'Begäran om kundkoppling är ogiltig.',
    status: 400,
  },
  ASSIGNMENT_CUSTOMER_ORGANIZATION_INVALID: {
    message: 'Den valda organisationen är ogiltig.',
    status: 400,
  },
  ASSIGNMENT_CUSTOMER_ASSIGNMENT_INVALID: {
    message: 'Uppdraget är ogiltigt.',
    status: 400,
  },
  ASSIGNMENT_CUSTOMER_BINDING_INVALID: {
    message: 'Välj uttryckligen en befintlig kund eller skapa en ny kund.',
    status: 400,
  },
  ASSIGNMENT_CUSTOMER_ID_INVALID: {
    message: 'Den valda kunden är ogiltig.',
    status: 400,
  },
  ASSIGNMENT_CUSTOMER_VERSION_INVALID: {
    message: 'Kund- eller uppdragsversionen är ogiltig.',
    status: 400,
  },
  ASSIGNMENT_CUSTOMER_ASSIGNMENT_NOT_FOUND: {
    message: 'Uppdraget kunde inte hittas.',
    status: 404,
  },
  ASSIGNMENT_CUSTOMER_NOT_FOUND: {
    message: 'Kunden kunde inte hittas i organisationen.',
    status: 404,
  },
  ASSIGNMENT_CUSTOMER_INACTIVE: {
    message: 'Den valda kunden är inaktiv. Välj en aktiv kund.',
    status: 409,
  },
  ASSIGNMENT_CUSTOMER_ASSIGNMENT_VERSION_CONFLICT: {
    message: 'Uppdraget har ändrats. Ladda om och försök igen.',
    status: 409,
  },
  ASSIGNMENT_CUSTOMER_VERSION_CONFLICT: {
    message: 'Kunden har ändrats. Ladda om kundlistan och försök igen.',
    status: 409,
  },
  ASSIGNMENT_CUSTOMER_LINK_CONFLICT: {
    message: 'Uppdraget är redan kopplat till en annan kund.',
    status: 409,
  },
  ASSIGNMENT_CUSTOMER_IDENTITY_CONFLICT: {
    message: 'Det finns redan en kund med samma organisations- eller personnummer.',
    status: 409,
  },
  ASSIGNMENT_CUSTOMER_EMAIL_REQUIRED: {
    message: 'Kunden behöver en e-postadress innan den kan kopplas till uppdraget.',
    status: 422,
  },
  ASSIGNMENT_CUSTOMER_SNAPSHOT_INCOMPLETE: {
    message: 'Uppdragets kunduppgifter är ofullständiga. Komplettera dem och försök igen.',
    status: 422,
  },
  CUSTOMER_TYPE_INVALID: {
    message: 'Välj om den nya kunden är företag/BRF eller privatperson.',
    status: 400,
  },
  CUSTOMER_NAME_REQUIRED: { message: 'Ange kundens namn.', status: 400 },
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
  ASSIGNMENT_CUSTOMERS_SCHEMA_REQUIRED: {
    message: 'Databasmigrationen för uppdragens kundkoppling behöver köras.',
    status: 503,
  },
})

const UNKNOWN_FAILURE = Object.freeze({
  code: 'ASSIGNMENT_CUSTOMER_REQUEST_FAILED',
  message: 'Kundkopplingen kunde inte hanteras just nu. Försök igen.',
  status: 500,
})

const MAX_BODY_BYTES = 16 * 1024

export function assertAssignmentCustomerSameOrigin(request: Request) {
  const origin = request.headers.get('origin')
  const fetchSite = request.headers.get('sec-fetch-site')
  let requestOrigin: string

  try {
    requestOrigin = new URL(request.url).origin
  } catch {
    throw new Error('ASSIGNMENT_CUSTOMER_ORIGIN_FORBIDDEN')
  }

  if (
    !origin ||
    origin !== requestOrigin ||
    (fetchSite !== null && fetchSite !== 'same-origin' && fetchSite !== 'none')
  ) {
    throw new Error('ASSIGNMENT_CUSTOMER_ORIGIN_FORBIDDEN')
  }
}

export function assignmentCustomerFailure(error: unknown): AssignmentCustomerFailure {
  const code = error instanceof Error ? error.message : ''
  const known = Object.prototype.hasOwnProperty.call(FAILURES, code)
    ? FAILURES[code]
    : undefined
  return known ? { code, ...known } : UNKNOWN_FAILURE
}

export async function readAssignmentCustomerJson(
  request: Request
): Promise<Record<string, unknown>> {
  const mediaType = request.headers
    .get('content-type')
    ?.split(';', 1)[0]
    .trim()
    .toLowerCase()
  const rawLength = request.headers.get('content-length')
  const contentLength = rawLength === null ? null : Number(rawLength)

  if (
    mediaType !== 'application/json' ||
    (contentLength !== null &&
      (!Number.isFinite(contentLength) ||
        contentLength < 0 ||
        contentLength > MAX_BODY_BYTES))
  ) {
    throw new Error('ASSIGNMENT_CUSTOMER_REQUEST_INVALID')
  }

  const raw = await request.text()
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    throw new Error('ASSIGNMENT_CUSTOMER_REQUEST_INVALID')
  }

  let body: unknown
  try {
    body = JSON.parse(raw) as unknown
  } catch {
    throw new Error('ASSIGNMENT_CUSTOMER_REQUEST_INVALID')
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('ASSIGNMENT_CUSTOMER_REQUEST_INVALID')
  }
  return body as Record<string, unknown>
}
