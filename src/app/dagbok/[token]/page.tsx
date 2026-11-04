import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import ProjectDiaryPublic from '@/components/tasks/ProjectDiaryPublic'
import { getDiaryPublic } from '@/lib/action-cases/projectDiaryServer'
import '@/components/tasks/uppdrag-theme.css'
import '@/components/tasks/project-diary.css'
export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Projektdagbok | HusHub', referrer: 'no-referrer', robots: { index: false, follow: false, noarchive: true } }
export default async function DiaryPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  let initial
  try { initial = await getDiaryPublic(token) }
  catch (error) { if (error instanceof Error && error.message === 'PROJECT_DIARY_NOT_FOUND') notFound(); throw error }
  return <ProjectDiaryPublic token={token} initial={initial} />
}
