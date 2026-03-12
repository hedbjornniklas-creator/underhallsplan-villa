'use client'

import React, { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import Topbar from '@/components/Topbar'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [isEmbed, setIsEmbed] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const v = params.get('embed')
    setIsEmbed(v === '1' || v === 'true')
  }, [pathname])

  // Dela upp pathen till segment: "/properties/123/ob/456" -> ["properties","123","ob","456"]
  const segments = pathname.split('/').filter(Boolean)

  const hideSidebarForObDetail =
    segments[0] === 'properties' &&
    segments[2] === 'ob' &&
    segments.length >= 4 // dÃƒÂ¥ har vi ett inspectionId efter "ob"

  const isLandingPage = pathname === '/'

  if (isEmbed || isLandingPage) {
    return <main className="min-h-screen bg-white">{children}</main>
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Global sidebar visas pÃƒÂ¥ alla sidor UTOM detaljsidan fÃƒÂ¶r Ãƒâ€“B */}
      {!hideSidebarForObDetail && <Sidebar />}

      <div className="flex flex-1 min-h-0 flex-col">
        <Topbar />
        <main className="flex-1 min-h-0 overflow-auto">{children}</main>
      </div>
    </div>
  )
}
