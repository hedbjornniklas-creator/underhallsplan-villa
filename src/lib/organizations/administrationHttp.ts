export const ORGANIZATION_RESPONSE_HEADERS = Object.freeze({
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
  Vary: 'Cookie',
})

export function organizationJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: ORGANIZATION_RESPONSE_HEADERS })
}

const failures: Record<string, [number, string]> = {
  UNAUTHORIZED: [401, 'Logga in för att fortsätta.'],
  ORG_MEMBERSHIP_REQUIRED: [403, 'Du saknar tillgång till organisationen.'],
  ORG_ADMIN_REQUIRED: [403, 'Endast en organisationsadministratör kan göra detta.'],
  ORGANIZATION_ADMIN_REQUIRED: [403, 'Endast en organisationsadministratör kan göra detta.'],
  ORGANIZATION_MEMBER_REQUIRED: [403, 'Du saknar tillgång till organisationen.'],
  MODULE_ACCESS_REQUIRED: [403, 'Du saknar behörighet till arbetsområdet.'],
  ORG_ORIGIN_FORBIDDEN: [403, 'Otillåten begäran.'],
  ORG_REQUEST_INVALID: [400, 'Kontrollera uppgifterna och försök igen.'],
  ORG_SELECTION_INVALID: [400, 'Välj en giltig organisation.'],
  ORG_INPUT_INVALID: [400, 'Kontrollera uppgifterna och försök igen.'],
  ORG_CONFLICT: [409, 'Uppgifterna har ändrats. Ladda om sidan och försök igen.'],
  ORG_REQUEST_TOO_LARGE: [413, 'Begäran är för stor.'],
  ORG_CONTENT_TYPE_INVALID: [415, 'Begäran har ett format som inte stöds.'],
  ORG_NOT_FOUND: [404, 'Organisationen kunde inte hittas.'],
  ORG_MEMBER_NOT_FOUND: [404, 'Medlemmen kunde inte hittas i organisationen.'],
  ORG_MEMBER_REQUIRED: [403, 'Du saknar tillgång till organisationen.'],
  ORG_MEMBER_EXISTS: [409, 'Personen är redan medlem. Ändra medlemskapet i medlemslistan.'],
  ORG_LAST_ADMIN: [409, 'Utse en annan aktiv administratör innan den sista administratören ändras.'],
  ORG_MODULE_NOT_ENABLED: [400, 'Arbetsområdet är inte aktiverat för organisationen.'],
  ORG_PROFILE_CONFLICT: [409, 'Uppgifterna har ändrats. Ladda om sidan och försök igen.'],
  ORG_PROFILE_SCHEMA_REQUIRED: [503, 'Databasstödet för organisationsadministration behöver installeras.'],
  ORG_PROFILE_VERSION_CONFLICT: [409, 'Uppgifterna har ändrats. Ladda om sidan och försök igen.'],
  ORG_PROFILE_CARD_CONFLICT: [409, 'Uppgifterna har ändrats. Ladda om sidan och försök igen.'],
  ORG_COMPANY_FIELDS_READ_ONLY: [403, 'Företagsuppgifterna hanteras i organisationens gemensamma profil.'],
  ORG_PROFILE_CARD_MEMBERSHIP_REQUIRED: [403, 'Du saknar tillgång till organisationen.'],
  ORG_PROFILE_CARD_MIGRATION_REQUIRED: [503, 'Databasstödet för organisationsprofiler behöver installeras.'],
  ORG_PROFILE_CARD_ADMIN_REQUIRED: [403, 'Du får bara ändra din egen personliga profil.'],
  ORG_PROFILE_CARD_REQUIRED: [400, 'Fyll i din personliga profil innan du fortsätter.'],
  ORG_PROFILE_CARD_REQUIRED_FIELDS: [400, 'Fyll i profilens obligatoriska uppgifter.'],
  ORG_PROFILE_CARD_INPUT_INVALID: [400, 'Kontrollera profilens uppgifter och försök igen.'],
  ORG_PROFILE_CARD_EMAIL_INVALID: [400, 'Ange en giltig e-postadress.'],
  ORG_PROFILE_CARD_ORGNO_INVALID: [400, 'Ange ett giltigt organisationsnummer.'],
  ORG_PROFILE_CARD_LEGACY_MEDIA_NOT_FOUND: [404, 'Det finns inga tidigare profilbilder att hämta.'],
  ORG_PROFILE_CARD_LEGACY_MEDIA_INVALID: [400, 'Den tidigare bilden kan inte användas. Ladda upp en ny bild.'],
  ORG_PROFILE_CARD_MEDIA_INVALID: [400, 'Välj en giltig PNG-, JPEG- eller WebP-bild.'],
  ORG_PROFILE_CARD_MEDIA_FORBIDDEN: [403, 'Du saknar behörighet att använda bilden.'],
  ORG_PROFILE_CARD_MEDIA_UPLOAD_FAILED: [500, 'Bilden kunde inte laddas upp. Försök igen.'],
  ORG_PROFILE_MEDIA_INVALID: [400, 'Välj en giltig PNG-, JPEG- eller WebP-bild.'],
  ORG_PROFILE_MEDIA_FORBIDDEN: [403, 'Du saknar behörighet att använda bilden.'],
  ORG_PROFILE_MEDIA_UPLOAD_FAILED: [500, 'Bilden kunde inte laddas upp. Försök igen.'],
  ORG_SCHEMA_REQUIRED: [503, 'Databasstödet för organisationsadministration behöver installeras.'],
  ORG_MIGRATION_REQUIRED: [503, 'Databasstödet för organisationsadministration behöver installeras.'],
  ORG_INVITE_INVALID: [400, 'Inbjudan är ogiltig, återkallad eller har gått ut. Be om en ny länk.'],
  ORG_INVITE_EMAIL_MISMATCH: [403, 'Du är inloggad med en annan e-postadress. Byt konto för att fortsätta.'],
  ORG_CATALOG_REQUIRED: [503, 'Arbetsområdena behöver konfigureras innan inbjudningar kan användas.'],
  ORG_FORTNOX_IDENTITY_LOCKED: [409, 'Organisationsnumret måste stämma med det anslutna Fortnox-företaget.'],
  ORG_PERSONAL_PROFILE_REQUIRED: [400, 'Fyll i din personliga profil innan du fortsätter.'],
  ORG_COMPANY_FIELDS_MANAGED: [403, 'Företagsuppgifterna hanteras i organisationens gemensamma profil.'],
  INVITE_INVALID: [400, 'Inbjudan är ogiltig, återkallad eller har gått ut. Be om en ny länk.'],
  INVITE_CONFLICT: [409, 'Inbjudan har ändrats. Ladda om listan och försök igen.'],
  INVITE_ALREADY_MEMBER: [409, 'Personen är redan medlem. Ändra medlemskapet i medlemslistan.'],
  INVITE_EMAIL_MISMATCH: [403, 'Du är inloggad med en annan e-postadress. Byt konto för att fortsätta.'],
  INVITE_EMAIL_UNVERIFIED: [403, 'Bekräfta e-postadressen för ditt konto innan du accepterar.'],
  EXISTING_USER_LOGIN_REQUIRED: [409, 'Logga in med ditt befintliga konto för att acceptera inbjudan.'],
  INVITE_PASSWORD_REQUIRED: [400, 'Välj ett lösenord med 12–128 tecken.'],
  INVITE_ACCOUNT_CREATED: [409, 'Kontot skapades, men medlemskapet kunde inte aktiveras. Logga in med ditt nya lösenord och öppna inbjudan igen.'],
  INVITE_MAIL_CONFIG: [503, 'Mejlavsändaren behöver konfigureras innan inbjudningar kan skickas.'],
  INVITE_RATE_LIMITED: [429, 'För många försök. Vänta en stund och försök igen.'],
  INVITE_CATALOG_REQUIRED: [503, 'Arbetsområdena behöver konfigureras innan inbjudningar kan användas.'],
}

export function organizationFailure(error: unknown) {
  const candidate = error instanceof Error ? error.message : ''
  const known = Object.hasOwn(failures, candidate) ? failures[candidate] : null
  return organizationJson({
    code: known ? candidate : 'ORG_REQUEST_FAILED',
    error: known?.[1] ?? 'Uppgifterna kunde inte hanteras just nu. Försök igen.',
  }, known?.[0] ?? 500)
}

export function isOrganizationUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

export function organizationOrgId(request: Request) {
  const params = new URL(request.url).searchParams
  const id = params.get('orgId')
  if (params.getAll('orgId').length !== 1 || !isOrganizationUuid(id)) throw new Error('ORG_REQUEST_INVALID')
  return id
}

export function assertOrganizationSameOrigin(request: Request) {
  const site = request.headers.get('sec-fetch-site')
  if (request.headers.get('origin') !== new URL(request.url).origin ||
      (site !== null && site !== 'same-origin' && site !== 'none')) throw new Error('ORG_ORIGIN_FORBIDDEN')
}

export async function readOrganizationJson(request: Request, options: { maxBytes?: number } = {}) {
  assertOrganizationSameOrigin(request)
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new Error('ORG_CONTENT_TYPE_INVALID')
  const maxBytes = options.maxBytes ?? 8192
  const declared = request.headers.get('content-length')
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) throw new Error('ORG_REQUEST_TOO_LARGE')
  const reader = request.body?.getReader()
  if (!reader) throw new Error('ORG_REQUEST_INVALID')
  let bytes = 0
  let text = ''
  const decoder = new TextDecoder('utf-8', { fatal: true })
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > maxBytes) {
        await reader.cancel()
        throw new Error('ORG_REQUEST_TOO_LARGE')
      }
      text += decoder.decode(chunk.value, { stream: true })
    }
    text += decoder.decode()
    const value: unknown = JSON.parse(text)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('ORG_REQUEST_INVALID')
    return value as Record<string, unknown>
  } catch (error) {
    if (error instanceof Error && error.message === 'ORG_REQUEST_TOO_LARGE') throw error
    throw new Error('ORG_REQUEST_INVALID')
  } finally {
    reader.releaseLock()
  }
}
