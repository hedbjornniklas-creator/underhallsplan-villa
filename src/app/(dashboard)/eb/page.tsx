import { authLoginUrl } from '@/lib/auth/returnPath'
import { currentAuthReturnPath } from '@/lib/auth/serverRecovery'
import { redirect } from 'next/navigation'
import EbDashboardClient from '@/components/eb/EbDashboardClient'
import { requireOrgContext } from '@/lib/assignments/server'
import { listEbProjects, type EbProjectListItem } from '@/lib/eb/server'

export const dynamic = 'force-dynamic'

export default async function EntreprenadbesiktningPage() {
  let projects: EbProjectListItem[] = []
  let initialError: string | null = null

  try {
    const context = await requireOrgContext()
    projects = await listEbProjects(context.orgId)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') {
      redirect(authLoginUrl(await currentAuthReturnPath('/eb')))
    }
    initialError = 'Besiktningarna kunde inte hämtas. Försök uppdatera listan.'
  }

  return <EbDashboardClient initialProjects={projects} initialError={initialError} />
}
