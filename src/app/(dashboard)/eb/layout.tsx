import { authLoginUrl } from '@/lib/auth/returnPath'
import { authRecoveryReason, currentAuthReturnPath } from '@/lib/auth/serverRecovery'
import DashboardAccessRecovery from '@/components/auth/DashboardAccessRecovery'
import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { requireModuleAccess } from '@/lib/access/server'
import { EbToastProvider } from '@/components/eb/EbToastProvider'

export default async function EbLayout({ children }: { children: ReactNode }) {
  try {
    await requireModuleAccess({ productKey: 'dashboard', moduleKey: 'construction_inspections' })
  } catch (error) {
    const returnTo = await currentAuthReturnPath('/eb')
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      redirect(authLoginUrl(returnTo))
    }

    return <DashboardAccessRecovery reason={authRecoveryReason(error)} returnTo={returnTo} productLabel="Entreprenadbesiktning" />
  }

  return <EbToastProvider>{children}</EbToastProvider>
}
