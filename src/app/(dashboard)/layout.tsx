import { authLoginUrl } from '@/lib/auth/returnPath'
import { authRecoveryReason, currentAuthReturnPath } from '@/lib/auth/serverRecovery'
import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import DashboardLayoutShell from '@/components/DashboardLayoutShell'
import DashboardAccessRecovery from '@/components/auth/DashboardAccessRecovery'
import { requireProductAccess } from '@/lib/access/server'

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  try {
    await requireProductAccess('dashboard')
  } catch (error) {
    const returnTo = await currentAuthReturnPath('/dashboard-v1')
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      redirect(authLoginUrl(returnTo))
    }

    return <DashboardAccessRecovery reason={authRecoveryReason(error)} returnTo={returnTo} productLabel="BesiktApp" />
  }

  return <DashboardLayoutShell>{children}</DashboardLayoutShell>
}
