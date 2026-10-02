import { requireOrganizationAdmin } from '@/lib/organizations/administration'
import { listOrganizationMembers, listOrganizationInvitations, updateOrganizationMember } from '@/lib/organizations/invitations'
import { organizationJson, organizationFailure, organizationOrgId, readOrganizationJson, isOrganizationUuid } from '@/lib/organizations/administrationHttp'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const context = await requireOrganizationAdmin(organizationOrgId(request))
    const [members, invitations] = await Promise.all([
      listOrganizationMembers(context.organization.id), listOrganizationInvitations(context.organization.id),
    ])
    return organizationJson({ members, invitations, enabledModules: context.modules })
  } catch (error) { return organizationFailure(error) }
}

export async function PATCH(request: Request) {
  try {
    const body = await readOrganizationJson(request)
    if (!isOrganizationUuid(body.orgId)) throw new Error('ORG_REQUEST_INVALID')
    return organizationJson(await updateOrganizationMember(body.orgId, body))
  } catch (error) { return organizationFailure(error) }
}
