import { getProfileExtrasWorkspace, saveProfileExtra } from '@/lib/organizations/profileExtras'
import { organizationJson, organizationFailure, organizationOrgId, readOrganizationJson } from '@/lib/organizations/administrationHttp'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    return organizationJson({ workspace: await getProfileExtrasWorkspace(organizationOrgId(request)) })
  } catch (error) { return organizationFailure(error) }
}

export async function PUT(request: Request) {
  try {
    return organizationJson(await saveProfileExtra(await readOrganizationJson(request)))
  } catch (error) { return organizationFailure(error) }
}
