import { NextResponse } from 'next/server'
import { requireObInspectionContext, requireObInspectionReadContext } from '@/lib/ob/organizationBindings'
import { obRequestOrgId, obOrganizationFailure } from '@/lib/ob/organizationHttp'
import { readOrganizationJson } from '@/lib/organizations/administrationHttp'
import { parseObInspectionBillingPatch } from '@/lib/ob/billing'
import { getObInspectionBilling, saveObInspectionBilling } from '@/lib/ob/billingServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string }> }
const headers = { 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' }

function failure(error: unknown) {
  const organizationFailure = obOrganizationFailure(error)
  if (organizationFailure) return organizationFailure
  const code = error instanceof Error ? error.message : ''
  const errors: Record<string, [number, string]> = {
    OB_INSPECTION_NOT_FOUND: [404, 'Besiktningen hittades inte.'],
    OB_BILLING_ACTOR_FORBIDDEN: [403, 'Du saknar behörighet att ändra fakturamarkeringen.'],
    OB_BILLING_INPUT_INVALID: [400, 'Kontrollera fakturastatus, fakturanummer och versionsuppgift. Fakturanumret får vara högst 100 tecken.'],
    OB_BILLING_CONFLICT: [409, 'Fakturamarkeringen har ändrats av någon annan. Hämta aktuell status och försök igen.'],
    OB_BILLING_CONFIGURATION: [503, 'Databasstödet för fakturamarkering behöver installeras.'],
  }
  const [status, message] = errors[code] ?? [503, 'Fakturamarkeringen kunde inte läsas eller sparas. Försök igen.']
  return NextResponse.json({ error: message, code: errors[code] ? code : 'OB_BILLING_UNAVAILABLE' }, { status, headers })
}

export async function GET(request: Request, context: Context) {
  try {
    const { id } = await context.params
    const org = await requireObInspectionReadContext(id, obRequestOrgId(request))
    const billing = await getObInspectionBilling({ orgId: org.orgId, inspectionId: id })
    return NextResponse.json({ billing: org.canEdit ? billing : { status: billing.status }, canEdit: org.canEdit }, { headers })
  } catch (error) { return failure(error) }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { id } = await context.params
    const org = await requireObInspectionContext(id, obRequestOrgId(request))
    const patch = parseObInspectionBillingPatch(await readOrganizationJson(request, { maxBytes: 10000 }))
    const billing = await saveObInspectionBilling({ ...patch, orgId: org.orgId, userId: org.userId, inspectionId: id })
    return NextResponse.json({ billing }, { headers })
  } catch (error) { return failure(error) }
}
