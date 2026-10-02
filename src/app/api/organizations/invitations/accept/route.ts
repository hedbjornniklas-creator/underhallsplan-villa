import { createHash } from 'node:crypto'
import { previewOrganizationInvitation, acceptOrganizationInvitation, isOrganizationInviteToken } from '@/lib/organizations/invitations'
import { organizationJson, organizationFailure, readOrganizationJson } from '@/lib/organizations/administrationHttp'
import { createInvitationRateLimit } from '@/lib/besiktapp/invitationRateLimit'

export const dynamic = 'force-dynamic'
const permit = createInvitationRateLimit()

export async function POST(request: Request) {
  try {
    const body = await readOrganizationJson(request, { maxBytes: 4096 })
    if (!isOrganizationInviteToken(body.token) || !['preview', 'accept'].includes(String(body.action)) ||
      (body.password !== undefined && (typeof body.password !== 'string' || body.password.length > 128))) throw new Error('INVITE_INVALID')
    // A bounded, instance-local brake; neither raw bearer tokens nor IP addresses are retained.
    if (!permit(createHash('sha256').update(body.token).digest('hex'))) throw new Error('INVITE_RATE_LIMITED')
    if (body.action === 'preview') return organizationJson(await previewOrganizationInvitation(body.token))
    return organizationJson(await acceptOrganizationInvitation(body.token, body.password as string | undefined))
  } catch (error) { return organizationFailure(error) }
}
