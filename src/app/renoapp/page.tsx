import Link from 'next/link'

export default function RenoAppLandingPage() {
  return (
    <main className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(180,123,70,0.18),transparent_34%),radial-gradient(circle_at_80%_18%,rgba(23,92,102,0.16),transparent_30%),linear-gradient(140deg,rgba(255,255,255,0.72),rgba(255,255,255,0))]" />
      <div className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col justify-center px-6 py-16 md:px-10">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-500">RenoApp MVP</p>
          <h1 className="mt-4 max-w-2xl text-5xl font-semibold tracking-tight text-stone-900 sm:text-6xl">
            Renoveringsärenden för BRF utan onödig friktion.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-stone-700">
            Publika ansökningar för boende, styrd handläggning för styrelsen och en separat intern adminyta för konfiguration.
          </p>
        </div>

        <section className="mt-12 grid gap-6 md:grid-cols-3">
          <article className="rounded-[28px] border border-stone-200/80 bg-white/80 p-6 shadow-[0_24px_70px_-38px_rgba(41,37,36,0.55)] backdrop-blur">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-800">Boende</p>
            <h2 className="mt-3 text-2xl font-semibold text-stone-900">Publik BRF-länk</h2>
            <p className="mt-3 text-sm leading-7 text-stone-700">
              Ansökan sker utan konto. Den slutliga URL:en är BRF-specifik och använder formatet `/renoapp/brf/[slug]/apply`.
            </p>
            <Link
              href="/renoapp/brf/demo-brf/apply"
              className="mt-6 inline-flex items-center rounded-full bg-stone-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-stone-700"
            >
              Öppna demoansökan
            </Link>
          </article>

          <article className="rounded-[28px] border border-stone-200/80 bg-white/80 p-6 shadow-[0_24px_70px_-38px_rgba(41,37,36,0.55)] backdrop-blur">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-teal-800">Styrelse</p>
            <h2 className="mt-3 text-2xl font-semibold text-stone-900">Inloggad RenoApp-yta</h2>
            <p className="mt-3 text-sm leading-7 text-stone-700">
              Här landar styrelsen för att granska ärenden, begära komplettering och följa preliminära lägenhetskopplingar.
            </p>
            <Link
              href="/renoapp/login"
              className="mt-6 inline-flex items-center rounded-full border border-teal-800 px-5 py-3 text-sm font-semibold text-teal-900 transition hover:bg-teal-50"
            >
              Styrelselogin
            </Link>
          </article>

          <article className="rounded-[28px] border border-stone-200/80 bg-white/80 p-6 shadow-[0_24px_70px_-38px_rgba(41,37,36,0.55)] backdrop-blur">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-stone-500">Internt</p>
            <h2 className="mt-3 text-2xl font-semibold text-stone-900">Admin för konfiguration</h2>
            <p className="mt-3 text-sm leading-7 text-stone-700">
              Intern admin ligger separat från BRF-upplevelsen och används för BRF-inställningar, dokumentkrav och access-link-hantering.
            </p>
            <Link
              href="/admin/renoapp"
              className="mt-6 inline-flex items-center rounded-full border border-stone-300 px-5 py-3 text-sm font-semibold text-stone-800 transition hover:bg-stone-100"
            >
              Öppna intern admin
            </Link>
          </article>
        </section>
      </div>
    </main>
  )
}
