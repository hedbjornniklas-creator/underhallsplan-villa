'use client'

import React, { Suspense } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import Topbar from '@/components/Topbar'
import OrganizationContextProvider from '@/components/organizations/OrganizationContextProvider'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <Suspense><OrganizationContextProvider><AppLayoutContent>{children}</AppLayoutContent></OrganizationContextProvider></Suspense>
}

function AppLayoutContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const embed = searchParams.get('embed')
  const isEmbed = embed === '1' || embed === 'true'

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
