import { isOrganizationUuid, organizationFailure, ORGANIZATION_RESPONSE_HEADERS } from '@/lib/organizations/administrationHttp'

export function obRequestOrgId(request: Request, required = false): string | undefined {
  const values = new URL(request.url).searchParams.getAll('orgId')
  if (!values.length && !required) return undefined
  if (values.length !== 1 || !isOrganizationUuid(values[0])) throw new Error('ORG_SELECTION_INVALID')
  return values[0].toLowerCase()
}

export function obRequestPropertyId(request: Request): string | undefined {
  const values = new URL(request.url).searchParams.getAll('propertyId')
  if (!values.length) return undefined
  if (values.length !== 1 || !isOrganizationUuid(values[0])) throw new Error('OB_PROPERTY_INVALID')
  return values[0].toLowerCase()
}

const failures: Record<string, [number, string]> = {
  UNAUTHORIZED: [401, 'Logga in för att fortsätta.'],
  ORG_MEMBERSHIP_REQUIRED: [403, 'Du saknar tillgång till organisationen.'],
  MODULE_ACCESS_REQUIRED: [403, 'Du saknar behörighet till ÖB i organisationen.'],
  ORG_SELECTION_INVALID: [400, 'Välj en giltig organisation.'],
  OB_INSPECTION_INVALID: [400, 'Besiktningens identifierare är ogiltig.'],
  OB_ASSIGNMENT_INVALID: [400, 'Uppdragets identifierare är ogiltig.'],
  OB_PROPERTY_INVALID: [400, 'Fastighetens identifierare är ogiltig.'],
  OB_ASSIGNMENT_NOT_FOUND: [404, 'ÖB-uppdraget kunde inte hittas.'],
  OB_ORGANIZATION_FORBIDDEN: [403, 'Du saknar tillgång till besiktningen.'],
  OB_ORGANIZATION_MISMATCH: [409, 'Uppdraget tillhör en annan organisation. Öppna det i rätt organisation.'],
  OB_ORGANIZATION_UNASSIGNED: [409, 'Besiktningens organisation behöver fastställas innan den kan öppnas.'],
  OB_ORGANIZATION_BINDING_IMMUTABLE: [409, 'Besiktningens organisation kan inte ändras.'],
  OB_ORGANIZATION_BINDING_REQUIRED: [409, 'Besiktningen måste skapas i en vald organisation.'],
  OB_BINDING_AUDIT_CONFLICT: [409, 'Besiktningens sparade organisation kunde inte verifieras. Ingen ny besiktning har skapats.'],
  OB_ORGANIZATION_MIGRATION_REQUIRED: [503, 'Databasstödet för ÖB-organisationer behöver installeras.'],
  OB_ORGANIZATION_READ_FAILED: [503, 'Organisationens uppgifter kunde inte verifieras. Försök igen.'],
  OB_FROZEN_IDENTITY_REQUIRED: [409, 'Det låsta utlåtandets sparade företagsuppgifter behöver kontrolleras. Inga nya uppgifter har lagts in.'],
  ORG_ORIGIN_FORBIDDEN: [403, 'Otillåten begäran.'],
  ORG_REQUEST_INVALID: [400, 'Kontrollera uppgifterna och försök igen.'],
  ORG_REQUEST_TOO_LARGE: [413, 'Begäran är för stor.'],
  ORG_CONTENT_TYPE_INVALID: [415, 'Begäran har ett format som inte stöds.'],
}

/** Return null for domain errors so existing report/round error handling stays intact. */
export function obOrganizationFailure(error: unknown): Response | null {
  const code = error instanceof Error ? error.message : ''
  if (code.startsWith('ORG_PROFILE_') || code.startsWith('ORG_COMPANY_')) return organizationFailure(error)
  const failure = Object.hasOwn(failures, code) ? failures[code] : null
  return failure ? Response.json({ code, error: failure[1] }, { status: failure[0], headers: ORGANIZATION_RESPONSE_HEADERS }) : null
}
