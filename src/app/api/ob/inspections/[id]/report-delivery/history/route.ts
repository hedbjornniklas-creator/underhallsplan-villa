import { requireObInspectionContext } from '@/lib/ob/organizationBindings'
import { obOrganizationFailure, obRequestOrgId } from '@/lib/ob/organizationHttp'
import { ORGANIZATION_RESPONSE_HEADERS } from '@/lib/organizations/administrationHttp'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { readObDeliveryTimeline } from '@/lib/ob/reportDeliveryHistoryServer'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const org = await requireObInspectionContext(id, obRequestOrgId(request))
    const cursor = new URL(request.url).searchParams.get('cursor')
    const timeline = await readObDeliveryTimeline(createSupabaseAdminClient(), org.orgId, id, cursor)
    return Response.json(timeline, { headers: ORGANIZATION_RESPONSE_HEADERS })
  } catch (error) {
    return obOrganizationFailure(error) ?? Response.json({ error: 'Historiken kunde inte hämtas.' }, {
      status: error instanceof Error && error.message === 'OB_HISTORY_CURSOR_INVALID' ? 400 : 503,
      headers: ORGANIZATION_RESPONSE_HEADERS,
    })
  }
}
