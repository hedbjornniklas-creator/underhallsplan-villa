import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import DashboardV1Client from './DashboardV1Client'
import { getDashboardData } from '@/lib/dashboard/server'
import type { DashboardData } from '@/lib/dashboard/model'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Min arbetsdag', robots: { index: false, follow: false } }

export default async function DashboardV1Page({ searchParams }: { searchParams?: Promise<{ orgId?: string | string[] }> }) {
  const params = searchParams ? await searchParams : {}
  let initialData: DashboardData | undefined
  let initialError: string | null = null
  try { initialData = await getDashboardData(params.orgId) } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'UNAUTHORIZED') redirect('/login?next=%2Fdashboard-v1')
    initialError = message === 'ORG_SELECTION_INVALID'
      ? 'Den valda organisationen är ogiltig. Återställ startsidan.'
      : message === 'DASHBOARD_ORGANIZATION_UNSUPPORTED'
        ? 'Startsidan visar din standardorganisation. Öppna respektive arbetsområde för att byta organisation.'
      : ['ORG_MEMBERSHIP_REQUIRED', 'MODULE_ACCESS_REQUIRED', 'PRODUCT_ACCESS_REQUIRED'].includes(message)
        ? 'Du saknar behörighet till den valda organisationen.'
        : 'Översikten kunde inte hämtas. Försök igen.'
  }
  return <DashboardV1Client key={Array.isArray(params.orgId) ? params.orgId.join('|') : params.orgId ?? 'default'} initialData={initialData} initialError={initialError} />
}
