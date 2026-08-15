import { notFound } from 'next/navigation'
import EbRemediationPortalClient from '@/components/eb/EbRemediationPortalClient'
import { getEbRemediationWorkspaceByToken } from '@/lib/eb/remediation'

export const dynamic = 'force-dynamic'

export default async function EbPublicRemediationPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const workspace = await getEbRemediationWorkspaceByToken(token)
  if (!workspace) notFound()

  return (
    <EbRemediationPortalClient
      initialWorkspace={workspace}
      endpoint={`/api/eb/remediation/${token}`}
    />
  )
}
