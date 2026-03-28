import type { ReactNode } from 'react'
import RenoAppAuthGuard from '@/components/renoapp/RenoAppAuthGuard'

export default function RenoAppAppLayout({ children }: { children: ReactNode }) {
  return (
    <RenoAppAuthGuard>
      <div className="min-h-full">
        <main className="mx-auto w-full max-w-6xl px-6 py-10 md:px-10">{children}</main>
      </div>
    </RenoAppAuthGuard>
  )
}
