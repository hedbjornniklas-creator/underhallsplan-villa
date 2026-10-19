import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import DashboardLayoutShell from '@/components/DashboardLayoutShell'
import DashboardAccessRecovery from '@/components/auth/DashboardAccessRecovery'
import { requireProductAccess } from '@/lib/access/server'

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  try {
    await requireProductAccess('dashboard')
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      redirect('/login?next=%2Fdashboard-v1')
    }

    return <DashboardAccessRecovery reason={error instanceof Error && error.message === 'PRODUCT_ACCESS_REQUIRED' ? 'forbidden' : 'unavailable'} />
  }

  return <DashboardLayoutShell>{children}</DashboardLayoutShell>
}
