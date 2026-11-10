import { NextResponse } from 'next/server'
import { requireTuRequestContext } from '@/lib/tu/server'
import { readOrganizationJson } from '@/lib/organizations/administrationHttp'
import { parseTuInvestigationBillingPatch } from '@/lib/tu/billing'
import { getTuInvestigationBilling, saveTuInvestigationBilling } from '@/lib/tu/billingServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ inspectionId: string }> }
const headers = { 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff', Vary: 'Cookie' }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function failure(error: unknown) {
  const code = error instanceof Error ? error.message : ''
  const errors: Record<string, [number, string]> = {
    UNAUTHORIZED: [401, 'Logga in för att fortsätta.'],
    ORG_SELECTION_INVALID: [400, 'Välj en giltig arbetsorganisation.'],
    ORG_MEMBERSHIP_REQUIRED: [403, 'Du saknar tillgång till organisationen.'],
    MODULE_ACCESS_REQUIRED: [403, 'Du saknar behörighet till tekniska utredningar i organisationen.'],
    TU_INVESTIGATION_NOT_FOUND: [404, 'TU-utredningen hittades inte.'],
    TU_BILLING_ACTOR_FORBIDDEN: [403, 'Du saknar behörighet att ändra fakturamarkeringen.'],
    TU_BILLING_INPUT_INVALID: [400, 'Kontrollera fakturastatus, fakturanummer och versionsuppgift. Fakturanumret får vara högst 100 tecken.'],
    TU_BILLING_CONFLICT: [409, 'Fakturamarkeringen har ändrats av någon annan. Hämta aktuell status och försök igen.'],
    TU_BILLING_CONFIGURATION: [503, 'Databasstödet för fakturamarkering behöver installeras.'],
    ORG_ORIGIN_FORBIDDEN: [403, 'Otillåten begäran.'],
    ORG_CONTENT_TYPE_INVALID: [415, 'Begäran har ett format som inte stöds.'],
    ORG_REQUEST_TOO_LARGE: [413, 'Begäran är för stor.'],
    ORG_REQUEST_INVALID: [400, 'Kontrollera uppgifterna och försök igen.'],
  }
  const [status, message] = errors[code] ?? [503, 'Fakturamarkeringen kunde inte läsas eller sparas. Försök igen.']
  return NextResponse.json({ error: message, code: errors[code] ? code : 'TU_BILLING_UNAVAILABLE' }, { status, headers })
}

export async function GET(request: Request, context: Context) {
  try {
    const org = await requireTuRequestContext(request)
    const { inspectionId } = await context.params
    if (!uuid.test(inspectionId)) throw new Error('TU_BILLING_INPUT_INVALID')
    const billing = await getTuInvestigationBilling({ orgId: org.orgId, inspectionId })
    return NextResponse.json({ billing, canEdit: true }, { headers })
  } catch (error) { return failure(error) }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const org = await requireTuRequestContext(request)
    const { inspectionId } = await context.params
    if (!uuid.test(inspectionId)) throw new Error('TU_BILLING_INPUT_INVALID')
    const patch = parseTuInvestigationBillingPatch(await readOrganizationJson(request, { maxBytes: 10000 }))
    const billing = await saveTuInvestigationBilling({ ...patch, orgId: org.orgId, userId: org.userId, inspectionId })
    return NextResponse.json({ billing, canEdit: true }, { headers })
  } catch (error) { return failure(error) }
}
