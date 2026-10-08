'use client'
import Topbar from './Topbar'
import { Suspense } from 'react'
import OrganizationContextProvider from './organizations/OrganizationContextProvider'

export default function Shell({ children }: { children: React.ReactNode }) {
  return (
    <Suspense><OrganizationContextProvider><div className="h-dvh w-dvw bg-gray-50 text-gray-900 flex flex-col">
      <Topbar />
      <main className="flex-1 min-w-0 p-4 md:p-6">{children}</main>
    </div></OrganizationContextProvider></Suspense>
  )
}
