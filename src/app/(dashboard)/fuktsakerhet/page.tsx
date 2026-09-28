import { redirect } from 'next/navigation'
import MoistureDashboardClient from '@/components/moisture/MoistureDashboardClient'
import { getMoistureError } from '@/lib/moisture/domain'
import { getMoistureOptions, listMoistureProjects, requireMoistureContext } from '@/lib/moisture/server'
import WorkspaceError from './WorkspaceError'

export const dynamic = 'force-dynamic'

export default async function MoistureDashboardPage({ searchParams }: {
  searchParams: Promise<{ orgId?: string | string[] }>
}) {
  const query = await searchParams
  const result = await (async () => {
    try {
      const context = await requireMoistureContext(query.orgId)
      const [projects, options] = await Promise.all([
        listMoistureProjects(context),
        getMoistureOptions(context),
      ])
      return { context, projects, options } as const
    } catch (error) {
      if (error instanceof Error && error.message === 'UNAUTHORIZED') return { login: true } as const
      return { error: getMoistureError(error).message } as const
    }
  })()
  if ('login' in result) redirect('/login')
  if ('error' in result) return <WorkspaceError message={result.error!} />
  return <MoistureDashboardClient
    key={result.context.orgId}
    orgId={result.context.orgId}
    orgName={result.context.orgName}
    initialProjects={result.projects}
    options={result.options}
  />
}
