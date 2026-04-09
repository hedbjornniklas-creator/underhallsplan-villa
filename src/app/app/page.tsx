import Link from 'next/link'
import { redirect } from 'next/navigation'
import Protected from '@/components/Protected'
import { getCurrentUserAccessibleProducts } from '@/lib/access/server'

export default async function AppEntryPage() {
  try {
    const products = await getCurrentUserAccessibleProducts()

    if (products.length === 0) {
      return (
        <Protected>
          <main className="mx-auto w-full max-w-5xl px-6 py-12">
            <section className="rounded-[28px] border border-rose-200 bg-rose-50 p-8 text-rose-900">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-rose-500">Atkomst</p>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight">Ingen produktaccess</h1>
              <p className="mt-4 max-w-2xl text-sm leading-7">
                Du är inloggad men saknar aktiv access till RenoApp, Dashboard eller HusHub Admin.
              </p>
            </section>
          </main>
        </Protected>
      )
    }

    if (products.length === 1) {
      redirect(products[0].href)
    }

    return (
      <Protected>
        <main className="min-h-screen bg-[#f7f5f0] text-stone-950">
          <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-10 sm:px-8 lg:px-10">
            <section className="rounded-[32px] border border-stone-200/80 bg-white/90 p-8 shadow-[0_24px_80px_-42px_rgba(41,37,36,0.5)]">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-500">HusHub</p>
              <h1 className="mt-4 text-4xl font-semibold tracking-tight text-stone-950">Välj system</h1>
              <p className="mt-4 max-w-2xl text-base leading-8 text-stone-700">
                Ditt konto har access till flera delar av HusHub. Välj vilket system du vill öppna.
              </p>

              <div className="mt-8 grid gap-4 md:grid-cols-2">
                {products.map((product) => (
                  <Link
                    key={product.key}
                    href={product.href}
                    className="rounded-[24px] border border-stone-200/80 bg-stone-50/90 p-6 transition hover:border-stone-300 hover:bg-white"
                  >
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">Produkt</p>
                    <h2 className="mt-3 text-2xl font-semibold tracking-tight text-stone-950">{product.label}</h2>
                    <p className="mt-3 text-sm leading-7 text-stone-700">{product.description}</p>
                    <div className="mt-6 text-sm font-semibold text-stone-950">
                      Öppna {product.label} <span aria-hidden="true">-&gt;</span>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          </div>
        </main>
      </Protected>
    )
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      redirect('/login')
    }

    throw error
  }
}
