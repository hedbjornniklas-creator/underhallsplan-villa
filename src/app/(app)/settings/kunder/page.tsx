import Link from 'next/link'
import { Suspense } from 'react'
import { ArrowLeft } from 'lucide-react'
import CustomerRegistryClient from '@/components/settings/CustomerRegistryClient'
import SettingsNav from '@/components/settings/SettingsNav'

export default async function CustomerSettingsPage({
  searchParams,
}: {
  searchParams?: Promise<{ orgId?: string | string[] }>
}) {
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const organizationId =
    typeof resolvedSearchParams.orgId === 'string' ? resolvedSearchParams.orgId : null
  const settingsHref = organizationId
    ? `/settings?orgId=${encodeURIComponent(organizationId)}`
    : '/settings'

  return (
    <main className="relative min-h-full overflow-hidden p-4 md:p-6">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(120% 100% at 50% 100%, rgba(56,189,248,0.28) 0%, rgba(56,189,248,0) 55%), radial-gradient(90% 70% at 20% 40%, rgba(14,165,233,0.3) 0%, rgba(14,165,233,0) 55%), linear-gradient(180deg, #020617 0%, #07143a 42%, #0b2f73 100%), url('/ob-settings-bg.jpg')",
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
      />
      <div className="pointer-events-none absolute inset-0 bg-black/45" />
      <div className="pointer-events-none absolute inset-0 opacity-35 [background-image:linear-gradient(to_right,rgba(125,211,252,0.28)_1px,transparent_1px),linear-gradient(to_bottom,rgba(125,211,252,0.28)_1px,transparent_1px)] [background-size:72px_72px]" />

      <div className="relative mx-auto max-w-5xl space-y-4">
        <header className="rounded-2xl border border-white/30 bg-white/90 p-4 shadow-sm backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <Link
              href={settingsHref}
              aria-label="Tillbaka till inställningar"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-700 transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <ArrowLeft size={16} aria-hidden="true" />
            </Link>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">
                Inställningar
              </p>
              <h1 className="text-xl font-semibold text-gray-900">Kundregister</h1>
            </div>
          </div>
        </header>

        <SettingsNav />
        <Suspense
          fallback={
            <section className="rounded-2xl border border-white/30 bg-white/90 p-5 text-sm text-gray-600 shadow-sm backdrop-blur-sm">
              Laddar kundregister…
            </section>
          }
        >
          <CustomerRegistryClient />
        </Suspense>
      </div>
    </main>
  )
}
