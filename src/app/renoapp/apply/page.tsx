'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'

function normalizeSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, '')
    .replace(/^renoapp\/brf\//, '')
    .replace(/\/apply$/, '')
}

function extractSlug(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ''

  try {
    const parsed = new URL(trimmed)
    const match = parsed.pathname.match(/\/renoapp\/brf\/([^/]+)\/apply\/?$/)
    if (match?.[1]) {
      return normalizeSlug(match[1])
    }
  } catch {
    return normalizeSlug(trimmed)
  }

  return normalizeSlug(trimmed)
}

export default function RenoAppResidentApplyEntryPage() {
  const router = useRouter()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  const resolvedSlug = useMemo(() => extractSlug(value), [value])

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const slug = extractSlug(value)

    if (!slug) {
      setError('Ange BRF-länk eller BRF-kod för att fortsätta.')
      return
    }

    setError(null)
    router.push(`/renoapp/brf/${slug}/apply`)
  }

  return (
    <main className="bg-[linear-gradient(180deg,#f8f3ea_0%,#f7f7f5_48%,#edf4f2_100%)]">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-5 py-8 sm:px-6 md:px-10">
        <section className="rounded-[30px] border border-stone-200/80 bg-white/88 p-6 shadow-[0_24px_70px_-44px_rgba(41,37,36,0.42)] sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">För boende</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-stone-900 sm:text-5xl">
            Skicka renoveringsansökan
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-8 text-stone-700 sm:text-lg">
            Här börjar du som lägenhetsinnehavare. Klistra in länken du fått från din BRF eller ange
            BRF-koden för att komma till rätt ansökningssida.
          </p>

          <form onSubmit={handleSubmit} className="mt-8 grid gap-4">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-stone-800">BRF-länk eller BRF-kod</span>
              <input
                value={value}
                onChange={(event) => setValue(event.target.value)}
                className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900 outline-none transition focus:border-stone-500"
                placeholder="Till exempel hushub.se/renoapp/brf/min-brf/apply eller min-brf"
              />
            </label>

            {resolvedSlug ? (
              <p className="text-sm text-stone-600">
                Du skickas vidare till: <span className="font-medium text-stone-900">/renoapp/brf/{resolvedSlug}/apply</span>
              </p>
            ) : null}

            {error ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                {error}
              </div>
            ) : null}

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-full bg-stone-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-stone-700"
              >
                Fortsätt till ansökan
              </button>
              <Link
                href="/renoapp"
                className="inline-flex items-center justify-center rounded-full border border-stone-300 px-5 py-3 text-sm font-semibold text-stone-800 transition hover:bg-stone-100"
              >
                Till RenoApp-start
              </Link>
            </div>
          </form>
        </section>

        <section className="mt-6 grid gap-4 lg:grid-cols-2">
          <article className="rounded-[28px] border border-stone-200/80 bg-white/86 p-6 shadow-[0_24px_70px_-44px_rgba(41,37,36,0.42)]">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">Det här behöver du</p>
            <ul className="mt-4 space-y-3 text-sm leading-7 text-stone-700 sm:text-base">
              <li>Kontaktuppgifter till dig som söker.</li>
              <li>BRF-länk eller BRF-kod från styrelsen.</li>
              <li>En kort beskrivning av åtgärden du vill göra.</li>
              <li>Underlag och dokument om din BRF kräver det.</li>
            </ul>
          </article>

          <article className="rounded-[28px] border border-stone-200/80 bg-white/86 p-6 shadow-[0_24px_70px_-44px_rgba(41,37,36,0.42)]">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">Om du saknar länk</p>
            <p className="mt-4 text-sm leading-7 text-stone-700 sm:text-base">
              Kontakta din BRF eller styrelse och be om rätt RenoApp-länk. Ansökan skickas alltid in på
              BRF:ens egen ansökningssida.
            </p>
            <div className="mt-5">
              <Link
                href="/renoapp/request-access"
                className="inline-flex items-center justify-center rounded-full border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900 transition hover:bg-emerald-100"
              >
                Min BRF använder inte RenoApp än
              </Link>
            </div>
          </article>
        </section>
      </div>
    </main>
  )
}
