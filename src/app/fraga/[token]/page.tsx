import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import QuestionDialogue from '@/components/tasks/QuestionDialogue'
import UppdragBrand from '@/components/tasks/UppdragBrand'
import { getPublicQuestionDialogue } from '@/lib/action-cases/questionDialogueServer'
import '@/components/tasks/uppdrag-theme.css'
import '@/components/tasks/gizmo-recipient-layout.css'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Projektfråga | Gizmo', referrer: 'no-referrer', robots: { index: false, follow: false, noarchive: true } }
export default async function QuestionPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  let data
  try { data = await getPublicQuestionDialogue(token) }
  catch (error) { if (error instanceof Error && error.message === 'PROJECT_QUESTION_NOT_FOUND') notFound(); throw error }
  return <main className="uppdrag-scope gizmo-question-public"><header><UppdragBrand /><p>Frågor och beslut</p></header><QuestionDialogue initial={data} endpoint={`/api/mina-uppdrag/fragor/${token}`} fileBase={`/api/mina-uppdrag/fragor/${token}/files`} publicView /></main>
}
