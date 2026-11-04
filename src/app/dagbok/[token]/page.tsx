import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import ProjectDiaryPublic from '@/components/tasks/ProjectDiaryPublic'
import { getDiaryPublic } from '@/lib/action-cases/projectDiaryServer'
import { diaryCookie } from '@/lib/action-cases/projectDiaryLinks'
import '@/components/tasks/uppdrag-theme.css'
import '@/components/tasks/project-diary.css'
export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Projektdagbok | HusHub', referrer: 'no-referrer', robots: { index: false, follow: false, noarchive: true } }
export default async function DiaryPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  try { const jar = await cookies(); return <ProjectDiaryPublic token={token} initial={await getDiaryPublic(token, jar.get(diaryCookie(token, 'session'))?.value)} /> }
  catch (error) { if (error instanceof Error && error.message === 'PROJECT_DIARY_NOT_FOUND') notFound(); throw error }
}
