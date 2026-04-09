'use client'

import React, { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import Topbar from '@/components/Topbar'

export default function DashboardLayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [isEmbed, setIsEmbed] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const v = params.get('embed')
    setIsEmbed(v === '1' || v === 'true')
  }, [pathname])

  const segments = pathname.split('/').filter(Boolean)

  const hideSidebarForObDetail =
    segments[0] === 'properties' &&
    segments[2] === 'ob' &&
    segments.length >= 4

  const isLandingPage = pathname === '/'

  if (isEmbed || isLandingPage) {
    return <main className="min-h-screen bg-white">{children}</main>
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      {!hideSidebarForObDetail && <Sidebar />}

      <div className="flex min-h-0 flex-1 flex-col">
        <Topbar />
        <main className="min-h-0 flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  )
}
