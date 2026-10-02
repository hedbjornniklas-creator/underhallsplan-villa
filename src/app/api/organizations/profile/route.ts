import { getOrganizationWorkspace, saveOrganizationProfile } from '@/lib/organizations/administration'
import { organizationJson, organizationFailure, readOrganizationJson, organizationOrgId } from '@/lib/organizations/administrationHttp'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try { return organizationJson({ workspace: await getOrganizationWorkspace(organizationOrgId(request)) }) }
  catch (error) { return organizationFailure(error) }
}

export async function PUT(request: Request) {
  try {
    const body = await readOrganizationJson(request)
    if (Object.keys(body).length !== 3 || !Object.hasOwn(body, 'orgId') || !Object.hasOwn(body, 'expectedVersion') || !Object.hasOwn(body, 'profile')) throw new Error('ORG_INPUT_INVALID')
    return organizationJson({ workspace: await saveOrganizationProfile(body.orgId, body.expectedVersion, body.profile) })
  } catch (error) { return organizationFailure(error) }
}
