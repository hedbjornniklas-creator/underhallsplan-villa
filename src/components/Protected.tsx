'use client'

import type { ReactNode } from 'react'
import SessionAccessGuard from '@/components/auth/SessionAccessGuard'

export default function Protected({ children }: { children: ReactNode }) {
  return <SessionAccessGuard>{children}</SessionAccessGuard>
}
