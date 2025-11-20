'use client'

import React from 'react'
import { usePathname } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import Topbar from '@/components/Topbar'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  // Dela upp pathen till segment: "/properties/123/ob/456" -> ["properties","123","ob","456"]
  const segments = pathname.split('/').filter(Boolean)

  const hideSidebarForObDetail =
    segments[0] === 'properties' &&
    segments[2] === 'ob' &&
    segments.length >= 4 // då har vi ett inspectionId efter "ob"

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Global sidebar visas på alla sidor UTOM detaljsidan för ÖB */}
      {!hideSidebarForObDetail && <Sidebar />}

      <div className="flex flex-1 flex-col">
        <Topbar />
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  )
}
