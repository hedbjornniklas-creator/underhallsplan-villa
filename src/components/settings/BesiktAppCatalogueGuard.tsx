'use client'

import type { ReactNode } from 'react'
import { useComponentCatalogueAccess } from '@/hooks/useComponentCatalogueAccess'

export default function BesiktAppCatalogueGuard({ children }: { children: ReactNode }) {
  // All BesiktApp catalogues share the existing database admin predicate.
  const { canEdit, loading, failed } = useComponentCatalogueAccess()
  if (canEdit) return <>{children}</>

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-8" aria-busy={loading}>
      <p role="status" className="text-sm text-gray-700">
        {loading
          ? 'Kontrollerar behörighet...'
          : failed
            ? 'Behörigheten kunde inte kontrolleras. Försök igen genom att ladda om sidan.'
            : 'Åtkomst nekad. BesiktApp-admin krävs för att ändra gemensamma förval.'}
      </p>
    </main>
  )
}
