import { notFound, redirect } from 'next/navigation'
import MoistureProjectClient from '@/components/moisture/MoistureProjectClient'
import { getMoistureError } from '@/lib/moisture/domain'
import { getMoistureOptions, getMoistureProject, requireMoistureContext } from '@/lib/moisture/server'
import WorkspaceError from '../../WorkspaceError'

export const dynamic = 'force-dynamic'

export default async function MoistureProjectPage({ params, searchParams }: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ orgId?: string | string[] }>
}) {
  const [{ id }, query] = await Promise.all([params, searchParams])
  const result = await (async () => {
    try {
      const context = await requireMoistureContext(query.orgId)
      const project = await getMoistureProject(context, id)
      if (!project) return { missing: true } as const
      const options = await getMoistureOptions(context)
      return { context, project, options } as const
    } catch (error) {
      if (error instanceof Error && error.message === 'UNAUTHORIZED') return { login: true } as const
      const failure = getMoistureError(error)
      if (failure.status === 404) return { missing: true } as const
      return { error: failure.message } as const
    }
  })()
  if ('login' in result) redirect('/login')
  if ('missing' in result) notFound()
  if ('error' in result) return <WorkspaceError message={result.error!} />
  return <MoistureProjectClient
    key={`${result.context.orgId}:${result.project.id}`}
    orgId={result.context.orgId}
    orgName={result.context.orgName}
    initialProject={result.project}
    options={result.options}
  />
}
