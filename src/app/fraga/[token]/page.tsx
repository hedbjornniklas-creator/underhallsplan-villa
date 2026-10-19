import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import QuestionDialogue from '@/components/tasks/QuestionDialogue'
import { getPublicQuestionDialogue } from '@/lib/action-cases/questionDialogueServer'
import '@/components/tasks/uppdrag-theme.css'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Projektfråga | HusHub', referrer: 'no-referrer', robots: { index: false, follow: false, noarchive: true } }
export default async function QuestionPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  let data
  try { data = await getPublicQuestionDialogue(token) }
  catch (error) { if (error instanceof Error && error.message === 'PROJECT_QUESTION_NOT_FOUND') notFound(); throw error }
  return <main className="uppdrag-scope gizmo-question-public"><header><p>HusHub · Frågor och beslut</p><h1>{data.snapshot?.title}</h1></header><QuestionDialogue initial={data} endpoint={`/api/mina-uppdrag/fragor/${token}`} fileBase={`/api/mina-uppdrag/fragor/${token}/files`} publicView /></main>
}
