import SessionAccessGuard from '@/components/auth/SessionAccessGuard'
import { authLoginUrl } from '@/lib/auth/returnPath'
import { authRecoveryReason, currentAuthReturnPath } from '@/lib/auth/serverRecovery'
import DashboardAccessRecovery from '@/components/auth/DashboardAccessRecovery'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { requireModuleAccess } from '@/lib/access/server'

export default async function RenoAppAppLayout({ children }: { children: ReactNode }) {
  try {
    await requireModuleAccess({
      productKey: 'renoapp',
      moduleKey: 'board_portal',
    })
  } catch (error) {
    const returnTo = await currentAuthReturnPath('/renoapp/app')
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      redirect(authLoginUrl(returnTo))
    }

    return <DashboardAccessRecovery reason={authRecoveryReason(error)} returnTo={returnTo} productLabel="RenoApp" />
  }

  return (
    <SessionAccessGuard productLabel="RenoApp"><div className="min-h-full">
      <main className="reno-portal-main">{children}</main>
    </div></SessionAccessGuard>
  )
}
