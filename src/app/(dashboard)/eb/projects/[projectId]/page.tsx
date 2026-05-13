import { notFound, redirect } from 'next/navigation'
import EbProjectDetailClient from '@/components/eb/EbProjectDetailClient'
import { requireOrgContext } from '@/lib/assignments/server'
import { getEbProjectById, type EbProjectListItem } from '@/lib/eb/server'

export const dynamic = 'force-dynamic'

export default async function EbProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  let project: EbProjectListItem | null = null

  try {
    const context = await requireOrgContext()
    project = await getEbProjectById({
      orgId: context.orgId,
      projectId,
    })
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

  return <EbProjectDetailClient project={project} />
}
