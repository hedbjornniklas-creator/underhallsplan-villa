import { notFound } from 'next/navigation'
import TaskRecipientClient from '@/components/tasks/TaskRecipientClient'
import { getExternalTaskWorkspace } from '@/lib/tasks/external'

export const dynamic = 'force-dynamic'

export default async function SigneTaskPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const workspace = await getExternalTaskWorkspace(token)
  if (!workspace) notFound()

  return <TaskRecipientClient initialWorkspace={workspace} endpoint={`/api/signe/${token}`} />
}
