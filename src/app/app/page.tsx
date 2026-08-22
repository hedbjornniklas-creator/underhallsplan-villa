import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowRight, Building2, ClipboardCheck, Settings2 } from 'lucide-react'
import Protected from '@/components/Protected'
import {
  getCurrentUserAccessibleProducts,
  type PlatformEntryProduct,
} from '@/lib/access/server'

export const metadata: Metadata = {
  title: 'Mina arbetsytor',
  description: 'Välj mellan de arbetsytor som är kopplade till ditt HusHub-konto.',
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <Protected>
      <main className="relative min-h-screen overflow-hidden bg-[#f5f3ee] text-stone-950">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(circle_at_top_left,rgba(79,70,229,0.11),transparent_48%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.1),transparent_44%)]"
        />
        <div className="relative mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-12 lg:px-10 lg:py-16">
          {children}
        </div>
      </main>
    </Protected>
  )
}

function PageHeader() {
  return (
    <header className="max-w-3xl">
      <Link
        href="/"
        className="inline-flex items-center gap-2.5 rounded-full text-sm font-semibold tracking-tight text-stone-700 transition hover:text-stone-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-500 focus-visible:ring-offset-4 focus-visible:ring-offset-[#f5f3ee]"
      >
        <span className="grid h-8 w-8 place-items-center rounded-full bg-stone-950 text-xs font-bold text-white">
          H
        </span>
        HusHub
      </Link>
      <h1 className="mt-8 text-4xl font-semibold tracking-[-0.035em] text-stone-950 sm:text-5xl">
        Mina arbetsytor
      </h1>
      <p className="mt-4 max-w-2xl text-base leading-7 text-stone-600 sm:text-lg sm:leading-8">
        Här hittar du de verktyg och funktioner som är kopplade till ditt konto.
      </p>
    </header>
  )
}

function WorkspaceCard({ product }: { product: PlatformEntryProduct }) {
  const isBesiktApp = product.key === 'dashboard'
  const Icon = isBesiktApp ? ClipboardCheck : Building2

  return (
    <Link
      href={product.href}
      className={`group relative flex min-h-72 flex-col overflow-hidden rounded-[28px] border p-7 shadow-[0_22px_65px_-42px_rgba(41,37,36,0.45)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_28px_70px_-38px_rgba(41,37,36,0.55)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-4 focus-visible:ring-offset-[#f5f3ee] sm:p-8 ${
        isBesiktApp
          ? 'border-indigo-200/80 bg-gradient-to-br from-indigo-50 via-white to-sky-50 focus-visible:ring-indigo-600'
          : 'border-emerald-200/80 bg-gradient-to-br from-emerald-50 via-white to-lime-50 focus-visible:ring-emerald-600'
      }`}
    >
      <div className="flex items-start justify-between gap-6">
        <span
          className={`grid h-12 w-12 place-items-center rounded-2xl text-white shadow-sm ${
            isBesiktApp ? 'bg-indigo-950' : 'bg-emerald-900'
          }`}
        >
          <Icon size={23} strokeWidth={1.8} aria-hidden="true" />
        </span>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            isBesiktApp ? 'bg-indigo-100 text-indigo-800' : 'bg-emerald-100 text-emerald-800'
          }`}
        >
          Arbetsyta
        </span>
      </div>

      <div className="mt-10">
        <h3 className="text-3xl font-semibold tracking-[-0.025em] text-stone-950">
          {product.label}
        </h3>
        <p className="mt-3 max-w-lg text-sm leading-7 text-stone-600 sm:text-base">
          {product.description}
        </p>
      </div>

      <span className="mt-auto flex items-center gap-2 pt-8 text-sm font-semibold text-stone-950">
        Öppna {product.label}
        <ArrowRight
          size={17}
          strokeWidth={2}
          aria-hidden="true"
          className="transition-transform duration-300 group-hover:translate-x-1"
        />
      </span>
    </Link>
  )
}

function EmptyWorkspaceState() {
  return (
    <PageShell>
      <PageHeader />

      <section className="mt-10 rounded-[30px] border border-amber-200/80 bg-white/90 p-7 shadow-[0_24px_70px_-46px_rgba(41,37,36,0.5)] sm:p-9">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-700">
          Behörighet saknas
        </p>
        <h2 className="mt-4 text-2xl font-semibold tracking-tight text-stone-950 sm:text-3xl">
          Ingen arbetsyta är kopplad till ditt konto
        </h2>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-stone-600 sm:text-base">
          Du är inloggad, men ditt konto har ännu inte tillgång till BesiktApp eller RenoApp.
          Om du har fått en inbjudan, kontrollera att du loggat in med samma e-postadress som
          inbjudan.
        </p>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-stone-600 sm:text-base">
          Behöver du hjälp? Kontakta personen som bjöd in dig eller administratören för din
          organisation eller BRF.
        </p>
        <Link
          href="/mina-uppdrag"
          className="mt-7 inline-flex items-center gap-2 rounded-full bg-stone-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-stone-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-500 focus-visible:ring-offset-2"
        >
          Öppna Mina uppdrag
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </section>
    </PageShell>
  )
}

async function loadAccessibleProducts() {
  try {
    return await getCurrentUserAccessibleProducts()
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      redirect('/login')
    }

    throw error
  }
}

export default async function AppEntryPage() {
  const products = await loadAccessibleProducts()

  if (products.length === 0) {
    return <EmptyWorkspaceState />
  }

  if (products.length === 1) {
    redirect(products[0].href)
  }

  const workspaces = products.filter((product) => product.key !== 'hushub_admin')
  const administration = products.find((product) => product.key === 'hushub_admin')

  return (
    <PageShell>
      <PageHeader />

      <section aria-labelledby="workspace-heading" className="mt-12">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">
            Arbetsytor
          </p>
          <h2
            id="workspace-heading"
            className="mt-3 text-2xl font-semibold tracking-tight text-stone-950 sm:text-3xl"
          >
            Vad vill du arbeta med?
          </h2>
          <p className="mt-3 text-sm leading-7 text-stone-600 sm:text-base">
            Välj arbetsyta utifrån uppgiften du ska göra.
          </p>
        </div>

        <div className="mt-7 grid gap-5 md:grid-cols-2">
          {workspaces.map((product) => (
            <WorkspaceCard key={product.key} product={product} />
          ))}
        </div>
      </section>

      {administration ? (
        <section
          aria-labelledby="administration-heading"
          className="mt-12 border-t border-stone-300/80 pt-8"
        >
          <div className="grid gap-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-center">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">
                Endast för administratörer
              </p>
              <h2
                id="administration-heading"
                className="mt-3 text-xl font-semibold tracking-tight text-stone-900"
              >
                Administration
              </h2>
              <p className="mt-2 max-w-lg text-sm leading-6 text-stone-600">
                Den här delen är till för plattformsinställningar och löpande administration,
                inte det dagliga arbetet.
              </p>
            </div>

            <Link
              href={administration.href}
              className="group flex items-center gap-4 rounded-2xl border border-stone-200 bg-stone-100/80 p-5 text-stone-700 transition hover:border-stone-300 hover:bg-white hover:text-stone-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-500 focus-visible:ring-offset-4 focus-visible:ring-offset-[#f5f3ee]"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-stone-200 text-stone-600">
                <Settings2 size={20} strokeWidth={1.8} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-stone-900">
                  Öppna administrationen
                </span>
                <span className="mt-1 block text-xs leading-5 text-stone-600 sm:text-sm">
                  {administration.description}
                </span>
              </span>
              <ArrowRight
                size={17}
                strokeWidth={2}
                aria-hidden="true"
                className="shrink-0 transition-transform duration-300 group-hover:translate-x-1"
              />
            </Link>
          </div>
        </section>
      ) : null}
    </PageShell>
  )
}
