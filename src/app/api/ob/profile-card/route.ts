import { requireObContext } from '@/lib/ob/organizationBindings'
import { obOrganizationFailure, obRequestOrgId } from '@/lib/ob/organizationHttp'
import { getOrganizationProfileWorkspace } from '@/lib/organizations/profileCard'
import { organizationFailure, ORGANIZATION_RESPONSE_HEADERS } from '@/lib/organizations/administrationHttp'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const context = await requireObContext(obRequestOrgId(request, true), true)
    const workspace = await getOrganizationProfileWorkspace({
      orgId: context.orgId, orgName: context.orgName, profileId: context.userId, role: context.role,
    })
    return Response.json({ workspace }, { headers: ORGANIZATION_RESPONSE_HEADERS })
  } catch (error) { return obOrganizationFailure(error) ?? organizationFailure(error) }
}
