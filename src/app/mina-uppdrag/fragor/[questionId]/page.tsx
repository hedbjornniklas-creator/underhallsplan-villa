import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { ArrowLeft, ClipboardList } from 'lucide-react'
import SessionAccessGuard from '@/components/auth/SessionAccessGuard'
import QuestionDialogue from '@/components/tasks/QuestionDialogue'
import UppdragBrand from '@/components/tasks/UppdragBrand'
import { recipientQuestionTaskLinks } from '@/lib/tasks/recipientParticipation'
import '@/components/tasks/uppdrag-theme.css'
import { getRecipientQuestionDialogue } from '@/lib/action-cases/questionDialogueServer'
import { requireRecipientPortalSession } from '@/lib/tasks/recipientPortal'
import { recipientLoginUrl } from '@/lib/tasks/recipientAuthPaths'

export const dynamic = 'force-dynamic'
export default async function RecipientQuestionPage({ params }: { params: Promise<{ questionId: string }> }) {
  const { questionId } = await params
  let session
  try { session = await requireRecipientPortalSession() } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') redirect(recipientLoginUrl(`/mina-uppdrag/fragor/${encodeURIComponent(questionId)}`))
    throw error
  }
  let dialogue, taskLinks
  try {
    dialogue = await getRecipientQuestionDialogue(session.authUserId, questionId)
    taskLinks = await recipientQuestionTaskLinks(session, questionId)
  } catch (error) {
    if (error instanceof Error && error.message === 'PROJECT_QUESTION_NOT_FOUND') notFound()
    throw error
  }
  return <SessionAccessGuard productLabel="Gizmo"><main className="uppdrag-scope gizmo-dialog-scope gizmo-recipient-scope min-h-dvh bg-white">
    <header className="border-b border-stone-200 px-4 py-4 sm:px-6"><div className="mx-auto flex max-w-4xl items-center justify-between gap-4"><UppdragBrand /><Link className="inline-flex items-center gap-2 text-sm" href="/mina-uppdrag"><ArrowLeft size={17} />Mina uppdrag</Link></div></header>
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6"><p className="mb-2 flex items-center gap-2 text-sm text-stone-600"><ClipboardList size={17} />Delad projektfråga</p>
      {taskLinks.length > 0 && <nav className="mb-5 flex flex-wrap gap-3" aria-label="Mina enskilda uppdrag i frågan">{taskLinks.map(link => <Link key={link.id} className="gizmo-button inline-flex items-center gap-2" href={link.href}><ClipboardList size={17} />{link.label}</Link>)}</nav>}
      <QuestionDialogue publicView initial={dialogue} endpoint={`/api/mina-uppdrag/projektfragor/${questionId}`} fileBase={`/api/mina-uppdrag/projektfragor/${questionId}/files`} />
    </div>
  </main></SessionAccessGuard>
}
