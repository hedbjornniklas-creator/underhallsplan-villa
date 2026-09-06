'use client'

import React, { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import Topbar from '@/components/Topbar'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [isEmbed, setIsEmbed] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const v = params.get('embed')
    setIsEmbed(v === '1' || v === 'true')
  }, [pathname])

  const isLandingPage = pathname === '/'

  if (isEmbed || isLandingPage) {
    return <div className="min-h-screen bg-white">{children}</div>
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <div className="flex flex-1 min-h-0 flex-col">
        <Topbar />
        <main className="flex-1 min-h-0 overflow-auto">{children}</main>
      </div>
    </div>
  )
}
