import { authLoginUrl } from '@/lib/auth/returnPath'
import { authRecoveryReason, currentAuthReturnPath } from '@/lib/auth/serverRecovery'
import DashboardAccessRecovery from '@/components/auth/DashboardAccessRecovery'
import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { requireModuleAccess } from '@/lib/access/server'

export default async function MoistureLayout({ children }: { children: ReactNode }) {
  try {
    await requireModuleAccess({ productKey: 'dashboard', moduleKey: 'moisture_safety' })
  } catch (error) {
    const returnTo = await currentAuthReturnPath('/fuktsakerhet')
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      redirect(authLoginUrl(returnTo))
    }

    return <DashboardAccessRecovery reason={authRecoveryReason(error)} returnTo={returnTo} productLabel="Fuktsäkerhet" />
  }
  return <>{children}</>
}
