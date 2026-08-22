import { notFound, redirect } from 'next/navigation'
import TaskRecipientClient from '@/components/tasks/TaskRecipientClient'
import { recipientLoginUrl, recipientTaskPath } from '@/lib/tasks/recipientAuthPaths'
import {
  getRecipientPortalTaskWorkspace,
  requireRecipientPortalSession,
} from '@/lib/tasks/recipientPortal'

export const dynamic = 'force-dynamic'

export default async function RecipientPortalTaskPage({
  params,
}: {
  params: Promise<{ taskId: string }>
}) {
  const { taskId } = await params
  let session
  try {
    session = await requireRecipientPortalSession()
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      redirect(recipientLoginUrl(recipientTaskPath(taskId)))
    }
    throw error
  }
  const workspace = await getRecipientPortalTaskWorkspace(session, taskId)
  if (!workspace) notFound()

  return (
    <TaskRecipientClient
      initialWorkspace={workspace}
      endpoint={`/api/mina-uppdrag/uppdrag/${encodeURIComponent(taskId)}`}
      backHref="/mina-uppdrag"
    />
  )
}
