import { getOrganizationSenderWorkspace, saveOrganizationSenderProfile } from '@/lib/organizations/senderProfiles'
import { organizationJson, organizationFailure, organizationOrgId, readOrganizationJson } from '@/lib/organizations/administrationHttp'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try { return organizationJson({ workspace: await getOrganizationSenderWorkspace(organizationOrgId(request)) }) }
  catch (error) { return organizationFailure(error) }
}

export async function PUT(request: Request) {
  try {
    const orgId = organizationOrgId(request)
    const body = await readOrganizationJson(request)
    return organizationJson(await saveOrganizationSenderProfile(orgId, body))
  } catch (error) { return organizationFailure(error) }
}
