import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, Download, FileText } from 'lucide-react'
import SessionAccessGuard from '@/components/auth/SessionAccessGuard'
import UppdragBrand from '@/components/tasks/UppdragBrand'
import '@/components/tasks/uppdrag-theme.css'
import { requireRecipientPortalSession } from '@/lib/tasks/recipientPortal'
import { getRecipientTaskParticipation } from '@/lib/tasks/recipientParticipation'
import { recipientLoginUrl } from '@/lib/tasks/recipientAuthPaths'
import { formatTaskDateTime } from '@/lib/tasks/dateTime'
import '@/components/tasks/project-questions.css'

export const dynamic = 'force-dynamic'
export default async function RecipientParticipationPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params
  let session
  try { session = await requireRecipientPortalSession() } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') redirect(recipientLoginUrl(`/mina-uppdrag/delade-uppdrag/${encodeURIComponent(taskId)}`))
    throw error
  }
  let item
  try { item = await getRecipientTaskParticipation(session, taskId) } catch (error) {
    if (error instanceof Error && error.message === 'TASK_NOT_FOUND') notFound()
    throw error
  }
  return <SessionAccessGuard productLabel="Gizmo"><main className="uppdrag-scope min-h-dvh bg-white">
    <header className="border-b border-stone-200 px-4 py-4"><div className="mx-auto flex max-w-4xl items-center justify-between gap-4"><UppdragBrand /><Link className="inline-flex items-center gap-2 text-sm" href="/mina-uppdrag"><ArrowLeft size={17} />Mina uppdrag</Link></div></header>
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6"><div><p className="text-sm text-stone-600">Deltagare · Tidigare ansvarig</p><h1 className="mt-2 text-2xl font-semibold">{item.title}</h1>{item.contextLabel && <p className="mt-2 text-stone-600">{item.contextLabel}</p>}</div>
      {item.description && <p className="whitespace-pre-wrap">{item.description}</p>}
      <p className="border-l-4 border-[#5c756f] bg-stone-50 p-3 text-sm">Här visas det som delades med dig före ansvarigbytet. Uppgiftens aktuella ansvariga hanterar status och färdigdatum.</p>
      {item.files.length > 0 && <section><h2 className="mb-3 text-lg font-semibold">Delade filer</h2><ul className="divide-y divide-stone-200">{item.files.map(file => <li key={file.id}><a className="flex min-h-12 items-center gap-3 py-3 hover:bg-stone-50" href={`/api/mina-uppdrag/delade-uppdrag/${taskId}/files/${file.id}`} target="_blank" rel="noreferrer"><FileText size={19} className="shrink-0" /><span className="min-w-0 flex-1 break-words">{file.name}</span><Download size={17} className="shrink-0" /></a></li>)}</ul></section>}
      <section><h2 className="mb-3 text-lg font-semibold">Tidigare kommunikation</h2>{item.events.length ? <ol className="divide-y divide-stone-200">{item.events.map(event => <li key={event.id} className="py-3"><p className="text-sm font-semibold">{event.actorName}<span className="ml-2 font-normal text-stone-500">{formatTaskDateTime(event.createdAt, 'Europe/Stockholm', 'compact')}</span></p>{event.message && <p className="mt-2 whitespace-pre-wrap">{event.message}</p>}</li>)}</ol> : <p className="text-sm text-stone-600">Inga tidigare meddelanden.</p>}</section>
    </div>
  </main></SessionAccessGuard>
}
