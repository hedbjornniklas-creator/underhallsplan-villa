import { Suspense } from 'react'
import AdminClient from '../AdminClient'
import BesiktAppCatalogueGuard from '@/components/settings/BesiktAppCatalogueGuard'

export default function BesiktAppAdminPage() {
  return (
    <Suspense fallback={<div className="p-6">Laddar admin...</div>}>
      <BesiktAppCatalogueGuard>
        <AdminClient />
      </BesiktAppCatalogueGuard>
    </Suspense>
  )
}
