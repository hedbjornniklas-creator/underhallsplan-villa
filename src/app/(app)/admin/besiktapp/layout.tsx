import type { ReactNode } from 'react'
import { requireModuleAccess } from '@/lib/access/server'

export default async function BesiktAppAdminLayout({ children }: { children: ReactNode }) {
  try {
    await requireModuleAccess({
      productKey: 'hushub_admin',
      moduleKey: 'besiktapp_admin',
    })
  } catch {
    return (
      <main className="mx-auto w-full max-w-5xl px-6 py-12">
        <section className="rounded-[28px] border border-rose-200 bg-rose-50 p-8 text-rose-900">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-rose-500">Åtkomst</p>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight">Åtkomst nekad</h1>
          <p className="mt-4 max-w-2xl text-sm leading-7">
            Du har inte behörighet till BesiktApp-admin. Den här adminmodulen styrs separat från övriga
            produkter.
          </p>
        </section>
      </main>
    )
  }

  return <>{children}</>
}
