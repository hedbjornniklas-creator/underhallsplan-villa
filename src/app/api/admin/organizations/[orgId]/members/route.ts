import { requireModuleAccess } from '@/lib/access/server'
import { savePlatformOrganizationMember } from '@/lib/organizations/platformAdministration'
import { organizationFailure, organizationJson, readOrganizationJson } from '@/lib/organizations/administrationHttp'

type Context = { params: Promise<{ orgId: string }> }

export async function POST(request: Request, context: Context) {
  try {
    await requireModuleAccess({ productKey: 'hushub_admin', moduleKey: 'access_management', scopeType: 'global' })
    return organizationJson(await savePlatformOrganizationMember((await context.params).orgId, await readOrganizationJson(request)))
  } catch (error) { return organizationFailure(error) }
}
