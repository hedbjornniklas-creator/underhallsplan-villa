import { requireModuleAccess } from '@/lib/access/server'
import { getPlatformOrganization, savePlatformOrganizationModules } from '@/lib/organizations/platformAdministration'
import { organizationFailure, organizationJson, readOrganizationJson } from '@/lib/organizations/administrationHttp'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ orgId: string }> }

export async function GET(_request: Request, context: Context) {
  try { return organizationJson(await getPlatformOrganization((await context.params).orgId)) }
  catch (error) { return organizationFailure(error) }
}

export async function PATCH(request: Request, context: Context) {
  try {
    await requireModuleAccess({ productKey: 'hushub_admin', moduleKey: 'access_management', scopeType: 'global' })
    return organizationJson(await savePlatformOrganizationModules((await context.params).orgId, await readOrganizationJson(request)))
  } catch (error) { return organizationFailure(error) }
}
