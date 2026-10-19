import { authLoginUrl } from '@/lib/auth/returnPath'
import { authRecoveryReason, currentAuthReturnPath } from '@/lib/auth/serverRecovery'
import DashboardAccessRecovery from '@/components/auth/DashboardAccessRecovery'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { requireModuleAccess } from '@/lib/access/server'
import RenoAppAdminShell from './RenoAppAdminShell'

export default async function RenoAppAdminLayout({ children }: { children: ReactNode }) {
  try {
    await requireModuleAccess({
      productKey: 'hushub_admin',
      moduleKey: 'renoapp_admin',
    })
  } catch (error) {
    const returnTo = await currentAuthReturnPath('/admin/renoapp')
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      redirect(authLoginUrl(returnTo))
    }

    return <DashboardAccessRecovery reason={authRecoveryReason(error)} returnTo={returnTo} productLabel="RenoApp Admin" />
  }

  return <RenoAppAdminShell>{children}</RenoAppAdminShell>
}
