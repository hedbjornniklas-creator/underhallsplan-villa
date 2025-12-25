import { Suspense } from 'react'
import AdminClient from './AdminClient'

export default function AdminPage() {
  return (
    <Suspense fallback={<div className="p-6">Laddar admin...</div>}>
      <AdminClient />
    </Suspense>
  )
}
