import { NextResponse } from 'next/server'
import { requireModuleAccess } from '@/lib/access/server'
import { requireOrgContext } from '@/lib/assignments/server'
import { parseEbInspectionBillingPatch } from '@/lib/eb/billing'
import { getEbInspectionBilling, saveEbInspectionBilling } from '@/lib/eb/billingServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ projectId: string; inspectionId: string }> }
const headers = { 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' }

async function scope(context: Context) {
  await requireModuleAccess({ productKey: 'dashboard', moduleKey: 'construction_inspections' })
  const org = await requireOrgContext()
  const { projectId, inspectionId } = await context.params
  return { orgId: org.orgId, userId: org.userId, projectId, inspectionId }
}

function failure(error: unknown) {
  const code = error instanceof Error ? error.message : ''
  const failures: Record<string, [number, string]> = {
    UNAUTHORIZED: [401, 'Inte inloggad.'],
    ORG_MEMBERSHIP_REQUIRED: [403, 'Ingen organisationskoppling hittades.'],
    MODULE_ACCESS_REQUIRED: [403, 'EB kräver egen modulbehörighet.'],
    EB_BILLING_ACTOR_FORBIDDEN: [403, 'Du saknar behörighet att ändra fakturamarkeringen.'],
    EB_INSPECTION_NOT_FOUND: [404, 'Besiktningen hittades inte.'],
    EB_BILLING_INPUT_INVALID: [400, 'Kontrollera fakturastatus, fakturanummer och versionsuppgift. Fakturanumret får vara högst 100 tecken.'],
    EB_BILLING_CONFLICT: [409, 'Fakturamarkeringen har ändrats av någon annan. Hämta den aktuella uppgiften och försök igen.'],
    EB_BILLING_CONFIGURATION: [503, 'Fakturamarkeringen är inte tillgänglig förrän databasuppdateringen är installerad.'],
  }
  const [status, message] = failures[code] ?? [503, 'Fakturamarkeringen kunde inte läsas eller sparas. Försök igen.']
  return NextResponse.json({ error: message, code: failures[code] ? code : 'EB_BILLING_UNAVAILABLE' }, { status, headers })
}

export async function GET(_request: Request, context: Context) {
  try { return NextResponse.json({ billing: await getEbInspectionBilling(await scope(context)) }, { headers }) }
  catch (error) { return failure(error) }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const authorizedScope = await scope(context)
    const patch = parseEbInspectionBillingPatch(await request.json().catch(() => null))
    return NextResponse.json({ billing: await saveEbInspectionBilling({ ...authorizedScope, ...patch }) }, { headers })
  } catch (error) { return failure(error) }
}
