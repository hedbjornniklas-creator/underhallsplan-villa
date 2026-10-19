import { authLoginUrl } from '@/lib/auth/returnPath'
import { authRecoveryReason, currentAuthReturnPath } from '@/lib/auth/serverRecovery'
import DashboardAccessRecovery from '@/components/auth/DashboardAccessRecovery'
import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { requireProductAccess } from '@/lib/access/server'

export default async function AdminLayout({ children }: { children: ReactNode }) {
  try {
    await requireProductAccess('hushub_admin')
  } catch (error) {
    const returnTo = await currentAuthReturnPath('/admin')
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      redirect(authLoginUrl(returnTo))
    }

    return <DashboardAccessRecovery reason={authRecoveryReason(error)} returnTo={returnTo} productLabel="HusHub Admin" />
  }

  return <>{children}</>
}
