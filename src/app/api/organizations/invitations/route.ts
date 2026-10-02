import { createOrganizationInvitation, changeOrganizationInvitation, listOrganizationInvitations } from '@/lib/organizations/invitations'
import { organizationJson, organizationFailure, organizationOrgId, readOrganizationJson, isOrganizationUuid } from '@/lib/organizations/administrationHttp'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try { return organizationJson({ invitations: await listOrganizationInvitations(organizationOrgId(request)) }) }
  catch (error) { return organizationFailure(error) }
}

export async function POST(request: Request) {
  try {
    const body = await readOrganizationJson(request)
    if (!isOrganizationUuid(body.orgId)) throw new Error('ORG_REQUEST_INVALID')
    if (body.action === 'create') return organizationJson(await createOrganizationInvitation(body.orgId, body))
    if (body.action === 'resend' || body.action === 'revoke') return organizationJson(await changeOrganizationInvitation(body.orgId, body))
    throw new Error('ORG_REQUEST_INVALID')
  } catch (error) { return organizationFailure(error) }
}
