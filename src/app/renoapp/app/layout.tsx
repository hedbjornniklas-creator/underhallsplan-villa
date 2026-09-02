import type { ReactNode } from 'react'
import { requireModuleAccess } from '@/lib/access/server'
import RenoAppLoginRedirect from '@/components/renoapp/RenoAppLoginRedirect'

export default async function RenoAppAppLayout({ children }: { children: ReactNode }) {
  try {
    await requireModuleAccess({
      productKey: 'renoapp',
      moduleKey: 'board_portal',
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return <RenoAppLoginRedirect />
    }

    return (
      <main className="mx-auto w-full max-w-5xl px-6 py-12">
        <section className="rounded-[28px] border border-rose-200 bg-rose-50 p-8 text-rose-900">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-rose-500">Atkomst</p>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight">Atkomst nekad</h1>
          <p className="mt-4 max-w-2xl text-sm leading-7">
            RenoApps styrelseportal kraver egen behorighet. En giltig session, Dashboard-access eller
            annan produktaccess racker inte i sig for att oppna den har ytan.
          </p>
        </section>
      </main>
    )
  }

  return (
    <div className="min-h-full">
      <main className="mx-auto w-full max-w-6xl px-6 py-10 md:px-10">{children}</main>
    </div>
  )
}
