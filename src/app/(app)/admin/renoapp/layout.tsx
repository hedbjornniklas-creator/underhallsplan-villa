import type { ReactNode } from 'react'
import RenoAppAdminShell from './RenoAppAdminShell'

export default function RenoAppAdminLayout({ children }: { children: ReactNode }) {
  return <RenoAppAdminShell>{children}</RenoAppAdminShell>
}
