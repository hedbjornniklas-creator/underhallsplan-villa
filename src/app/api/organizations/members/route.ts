import { requireOrganizationAdmin } from '@/lib/organizations/administration'
import { listOrganizationMembers, listOrganizationInvitations, updateOrganizationMember } from '@/lib/organizations/invitations'
import { listOrganizationObVisibility } from '@/lib/organizations/obVisibilityAdministration'
import { organizationJson, organizationFailure, organizationOrgId, readOrganizationJson, isOrganizationUuid } from '@/lib/organizations/administrationHttp'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const context = await requireOrganizationAdmin(organizationOrgId(request))
    const [members, invitations, visibility] = await Promise.all([
      listOrganizationMembers(context.organization.id), listOrganizationInvitations(context.organization.id),
      listOrganizationObVisibility(context.organization.id),
    ])
    return organizationJson({ members: members.map(member => ({ ...member,
      obVisibility: visibility.migrationRequired ? undefined : visibility.permissions[member.profileId],
    })), invitations, enabledModules: context.modules, obVisibilityMigrationRequired: visibility.migrationRequired })
  } catch (error) { return organizationFailure(error) }
}

export async function PATCH(request: Request) {
  try {
    const body = await readOrganizationJson(request)
    if (!isOrganizationUuid(body.orgId)) throw new Error('ORG_REQUEST_INVALID')
    return organizationJson(await updateOrganizationMember(body.orgId, body))
  } catch (error) { return organizationFailure(error) }
}
