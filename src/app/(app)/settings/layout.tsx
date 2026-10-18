import type { ReactNode } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireProductAccess } from '@/lib/access/server'

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  try {
    await requireProductAccess('dashboard')
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
            Inställningarna i den här delen tillhör Dashboard och kräver separat Dashboard-behörighet.
          </p>
          <p className="mt-4 max-w-2xl text-sm leading-7">Du kan skapa en ny organisation med ditt befintliga konto. Om företaget redan finns i HusHub behöver dess administratör bjuda in dig.</p>
          <Link href="/settings/organisation/skapa" className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700">Skapa organisation</Link>
        </section>
      </main>
    )
  }

  return <>{children}</>
}
