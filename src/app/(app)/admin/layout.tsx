import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { requireProductAccess } from '@/lib/access/server'

export default async function AdminLayout({ children }: { children: ReactNode }) {
  try {
    await requireProductAccess('hushub_admin')
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      redirect('/login')
    }

    return (
      <main className="mx-auto w-full max-w-5xl px-6 py-12">
        <section className="rounded-[28px] border border-rose-200 bg-rose-50 p-8 text-rose-900">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-rose-500">Åtkomst</p>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight">Åtkomst nekad</h1>
          <p className="mt-4 max-w-2xl text-sm leading-7">
            Den här adminytan kräver separat HusHub-adminbehörighet. RenoApp- eller Dashboard-access ger
            inte automatiskt tillgång hit.
          </p>
        </section>
      </main>
    )
  }

  return <>{children}</>
}
