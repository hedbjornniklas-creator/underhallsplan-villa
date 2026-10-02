import { requireModuleAccess } from '@/lib/access/server'
import { createPlatformOrganization, listPlatformOrganizations } from '@/lib/organizations/platformAdministration'
import { organizationFailure, organizationJson, readOrganizationJson } from '@/lib/organizations/administrationHttp'

export const dynamic = 'force-dynamic'

export async function GET() {
  try { return organizationJson(await listPlatformOrganizations()) }
  catch (error) { return organizationFailure(error) }
}

export async function POST(request: Request) {
  try {
    await requireModuleAccess({ productKey: 'hushub_admin', moduleKey: 'access_management', scopeType: 'global' })
    return organizationJson(await createPlatformOrganization(await readOrganizationJson(request)))
  } catch (error) { return organizationFailure(error) }
}
