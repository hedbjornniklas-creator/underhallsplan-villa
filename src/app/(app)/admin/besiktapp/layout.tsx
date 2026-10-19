import { authLoginUrl } from '@/lib/auth/returnPath'
import { authRecoveryReason, currentAuthReturnPath } from '@/lib/auth/serverRecovery'
import DashboardAccessRecovery from '@/components/auth/DashboardAccessRecovery'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { requireModuleAccess } from '@/lib/access/server'

export default async function BesiktAppAdminLayout({ children }: { children: ReactNode }) {
  try {
    await requireModuleAccess({
      productKey: 'hushub_admin',
      moduleKey: 'besiktapp_admin',
    })
  } catch (error) {
    const returnTo = await currentAuthReturnPath('/admin/besiktapp')
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      redirect(authLoginUrl(returnTo))
    }

    return <DashboardAccessRecovery reason={authRecoveryReason(error)} returnTo={returnTo} productLabel="BesiktApp Admin" />
  }

  return <>{children}</>
}
