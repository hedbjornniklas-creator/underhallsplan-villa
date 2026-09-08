import { NextResponse } from 'next/server'
import { requireModuleAccess } from '@/lib/access/server'
import { requireOrgContext } from '@/lib/assignments/server'
import { confirmEbFollowUpCustomer, getEbFollowUpCustomerSettings } from '@/lib/eb/followUpCustomer'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
type RouteContext = { params: Promise<{ projectId: string; inspectionId: string }> }

async function authenticatedScope(context: RouteContext) {
  await requireModuleAccess({ productKey: 'dashboard', moduleKey: 'construction_inspections' })
  const org = await requireOrgContext()
  const { projectId, inspectionId } = await context.params
  return { admin: createSupabaseAdminClient(), orgId: org.orgId, userId: org.userId, projectId, inspectionId }
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  const errors: Record<string, [number, string]> = {
    UNAUTHORIZED: [401, 'Inte inloggad.'],
    ORG_MEMBERSHIP_REQUIRED: [403, 'Ingen organisationskoppling hittades.'],
    MODULE_ACCESS_REQUIRED: [403, 'EB kräver egen modulbehörighet.'],
    EB_INSPECTION_NOT_FOUND: [404, 'Besiktningen hittades inte.'],
    EB_FOLLOW_UP_EMAIL_INVALID: [400, 'Ange en giltig e-postadress.'],
    EB_FOLLOW_UP_CUSTOMER_FROZEN: [409, 'Tjänsten är redan beställd. Den ursprungliga beställaren behåller åtkomsten och kan inte bytas här.'],
    EB_FOLLOW_UP_CONFIGURATION: [503, 'Beställarkontakten kan inte sparas förrän databasuppdateringen för funktionen är installerad.'],
  }
  const [status, text] = errors[message] ?? [503, 'Kunde inte läsa eller spara beställarkontakten. Försök igen.']
  return NextResponse.json({ error: text }, { status })
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const settings = await getEbFollowUpCustomerSettings(await authenticatedScope(context))
    return NextResponse.json({ settings }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) { return failure(error) }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const scope = await authenticatedScope(context)
    const body = await request.json().catch(() => null) as { email?: unknown; confirmed?: unknown } | null
    if (body?.confirmed !== true) {
      return NextResponse.json({ error: 'Bekräfta uttryckligen vem som är beställarkontakt för denna besiktning.' }, { status: 400 })
    }
    const settings = await confirmEbFollowUpCustomer({ ...scope, email: body.email })
    return NextResponse.json({ settings }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) { return failure(error) }
}
