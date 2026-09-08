import { notFound } from 'next/navigation'
import EbRemediationPortalClient from '@/components/eb/EbRemediationPortalClient'
import EbOwnerAccessVerifier from '@/components/eb/EbOwnerAccessVerifier'
import { getEbRemediationWorkspaceByToken } from '@/lib/eb/remediation'

export const dynamic = 'force-dynamic'

export default async function EbPublicRemediationPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const endpoint = `/api/eb/remediation/${encodeURIComponent(token)}`
  let workspace
  try {
    workspace = await getEbRemediationWorkspaceByToken(token)
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'EB_REMEDIATION_OWNER_VERIFICATION_REQUIRED' || message === 'EB_REMEDIATION_OWNER_LINK_EXPIRED') {
      return <EbOwnerAccessVerifier endpoint={endpoint} expired={message === 'EB_REMEDIATION_OWNER_LINK_EXPIRED'} />
    }
    if (message === 'EB_REMEDIATION_ACCESS_REVOKED' || message === 'EB_REMEDIATION_ACTION_FORBIDDEN') notFound()
    throw error
  }
  if (!workspace) notFound()

  return (
    <EbRemediationPortalClient
      initialWorkspace={workspace}
      endpoint={endpoint}
    />
  )
}
