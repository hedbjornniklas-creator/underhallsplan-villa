import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { requireModuleAccess } from '@/lib/access/server'
import { getMoistureError } from '@/lib/moisture/domain'
import WorkspaceError from './WorkspaceError'

export default async function MoistureLayout({ children }: { children: ReactNode }) {
  try {
    await requireModuleAccess({ productKey: 'dashboard', moduleKey: 'moisture_safety' })
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') redirect('/login')
    return <WorkspaceError message={getMoistureError(error).message} />
  }
  return <>{children}</>
}
