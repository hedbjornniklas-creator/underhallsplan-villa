import { setOrganizationObVisibility } from '@/lib/organizations/obVisibilityAdministration'
import { organizationJson, organizationFailure, readOrganizationJson } from '@/lib/organizations/administrationHttp'

export const dynamic = 'force-dynamic'

export async function PATCH(request: Request) {
  try {
    return organizationJson(await setOrganizationObVisibility(await readOrganizationJson(request)))
  } catch (error) { return organizationFailure(error) }
}
