'use client'

import type { ReactNode } from 'react'
import { useComponentCatalogueAccess } from '@/hooks/useComponentCatalogueAccess'
import DashboardAccessRecovery from '@/components/auth/DashboardAccessRecovery'

export default function BesiktAppCatalogueGuard({ children }: { children: ReactNode }) {
  // All BesiktApp catalogues share the existing database admin predicate.
  const { canEdit, loading, failed } = useComponentCatalogueAccess()
  if (canEdit) return <>{children}</>
  if (!loading) return <DashboardAccessRecovery reason={failed ? 'unavailable' : 'forbidden'} productLabel="BesiktApp · Gemensamma förval" embedded />

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-8" aria-busy={loading}>
      <p role="status" className="text-sm text-gray-700">
        Kontrollerar behörighet...
      </p>
    </main>
  )
}
