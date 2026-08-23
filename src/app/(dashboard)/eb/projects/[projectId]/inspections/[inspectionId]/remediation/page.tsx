import { notFound, redirect } from 'next/navigation'
import EbRemediationPortalClient from '@/components/eb/EbRemediationPortalClient'
import { requireModuleAccess } from '@/lib/access/server'
import { requireOrgContext } from '@/lib/assignments/server'
import { getEbRemediationWorkspace } from '@/lib/eb/remediation'

export const dynamic = 'force-dynamic'

export default async function EbInspectionRemediationPage({
  params,
}: {
  params: Promise<{ projectId: string; inspectionId: string }>
}) {
  const { projectId, inspectionId } = await params
  let workspace: Awaited<ReturnType<typeof getEbRemediationWorkspace>>

  try {
    await requireModuleAccess({
      productKey: 'dashboard',
      moduleKey: 'construction_inspections',
    })
    const context = await requireOrgContext()
    workspace = await getEbRemediationWorkspace({
      orgId: context.orgId,
      projectId,
      inspectionId,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'UNAUTHORIZED') redirect('/login')
    if (message === 'EB_PROJECT_NOT_FOUND' || message === 'EB_INSPECTION_NOT_FOUND') notFound()
    throw error
  }

  return (
    <EbRemediationPortalClient
      initialWorkspace={workspace}
      endpoint={`/api/eb/projects/${projectId}/remediation`}
      inspectionId={inspectionId}
      internal
      backHref={`/eb/projects/${projectId}`}
    />
  )
}
