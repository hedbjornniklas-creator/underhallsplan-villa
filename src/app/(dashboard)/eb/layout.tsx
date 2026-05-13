import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { requireModuleAccess } from '@/lib/access/server'

export default async function EbLayout({ children }: { children: ReactNode }) {
  try {
    await requireModuleAccess({ productKey: 'dashboard', moduleKey: 'construction_inspections' })
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      redirect('/login')
    }

    return (
      <main className="mx-auto w-full max-w-5xl px-6 py-12">
        <section className="rounded-lg border border-rose-200 bg-rose-50 p-8 text-rose-900">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-rose-500">Åtkomst</p>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight">Åtkomst nekad</h1>
          <p className="mt-4 max-w-2xl text-sm leading-7">
            Entreprenadbesiktning kräver egen modulbehörighet. Be en administratör aktivera EB för din användare.
          </p>
        </section>
      </main>
    )
  }

  return <>{children}</>
}
