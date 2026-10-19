import { authLoginUrl } from '@/lib/auth/returnPath'
import { authRecoveryReason, currentAuthReturnPath } from '@/lib/auth/serverRecovery'
import DashboardAccessRecovery from '@/components/auth/DashboardAccessRecovery'
import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { requireModuleAccess } from '@/lib/access/server'
import { requireOrgContext } from '@/lib/assignments/server'

export default async function TasksLayout({ children }: { children: ReactNode }) {
  try {
    const org = await requireOrgContext()
    await requireModuleAccess({
      productKey: 'dashboard',
      moduleKey: 'tasks',
      scopeType: 'organization',
      scopeId: org.orgId,
    })
  } catch (error) {
    const returnTo = await currentAuthReturnPath('/uppdrag')
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      redirect(authLoginUrl(returnTo))
    }

    return <DashboardAccessRecovery reason={authRecoveryReason(error)} returnTo={returnTo} productLabel="Uppdrag" />
  }

  return <>{children}</>
}
