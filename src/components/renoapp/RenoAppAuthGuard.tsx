'use client'

import type { ReactNode } from 'react'
import SessionAccessGuard from '@/components/auth/SessionAccessGuard'

export default function RenoAppAuthGuard({ children }: { children: ReactNode }) {
  return <SessionAccessGuard productLabel="RenoApp">{children}</SessionAccessGuard>
}
