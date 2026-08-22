import { notFound, redirect } from 'next/navigation'
import EbProjectDetailClient from '@/components/eb/EbProjectDetailClient'
import { requireOrgContext } from '@/lib/assignments/server'
import { listEbAssignmentConfirmationSummaries } from '@/lib/eb/assignmentConfirmationServer'
import type { EbAssignmentConfirmationSummary } from '@/lib/eb/assignmentConfirmationTypes'
import {
  getEbProjectById,
  listEbProjectAttachments,
  type EbProjectAttachment,
  type EbProjectListItem,
} from '@/lib/eb/server'

export const dynamic = 'force-dynamic'

export default async function EbProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  let project: EbProjectListItem | null = null
  let attachments: EbProjectAttachment[] = []
  let assignmentConfirmations: EbAssignmentConfirmationSummary[] = []

  try {
    const context = await requireOrgContext()
    project = await getEbProjectById({
      orgId: context.orgId,
      projectId,
    })
    if (project) {
      ;[attachments, assignmentConfirmations] = await Promise.all([
        listEbProjectAttachments({
          orgId: context.orgId,
          projectId,
        }),
        listEbAssignmentConfirmationSummaries({
          orgId: context.orgId,
          inspectionIds: project.inspections.map((inspection) => inspection.inspectionId),
        }),
      ])
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') {
      redirect('/login')
    }
    throw error
  }

  if (!project) {
    notFound()
  }

  return (
    <EbProjectDetailClient
      project={project}
      attachments={attachments}
      assignmentConfirmations={assignmentConfirmations}
    />
  )
}
