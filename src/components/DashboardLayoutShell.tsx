'use client'

import React from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import Topbar from '@/components/Topbar'

export default function DashboardLayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const embed = searchParams.get('embed')
  const isEmbed = embed === '1' || embed === 'true'

  const isLandingPage = pathname === '/'

  if (isEmbed || isLandingPage) {
    return <main className="min-h-screen bg-white">{children}</main>
  }

  return (
    <div className="flex min-h-screen bg-gray-50 print:block print:min-h-0 print:bg-white">
      <div className="flex min-h-0 flex-1 flex-col print:block print:min-h-0">
        <div className="print:hidden">
          <Topbar />
        </div>
        <main className="min-h-0 flex-1 overflow-auto print:block print:min-h-0 print:overflow-visible">
          {children}
        </main>
      </div>
    </div>
  )
}
