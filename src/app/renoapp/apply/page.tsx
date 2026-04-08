'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'

type PublicBrfListItem = {
  id: string
  name: string
  slug: string
  address: string | null
}

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
  const [search, setSearch] = useState('')
  const [items, setItems] = useState<PublicBrfListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isBrfPickerOpen, setIsBrfPickerOpen] = useState(false)

  const resolvedSlug = useMemo(() => extractSlug(value), [value])
  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return items

    return items.filter((item) => {
      const haystack = [item.name, item.slug, item.address ?? ''].join(' ').toLowerCase()
      return haystack.includes(query)
    })
  }, [items, search])

  useEffect(() => {
    let active = true

    const loadBrfs = async () => {
      setLoading(true)
      setError(null)

      try {
        const response = await fetch('/api/renoapp/public/brfs', { cache: 'no-store' })
        const payload = (await response.json().catch(() => ({}))) as {
          items?: PublicBrfListItem[]
          error?: string
        }

        if (!response.ok) {
          throw new Error(payload.error ?? 'Kunde inte läsa publika BRF:er.')
        }

        if (active) {
          setItems(payload.items ?? [])
        }
      } catch (fetchError) {
        if (active) {
          setError(fetchError instanceof Error ? fetchError.message : 'Kunde inte läsa publika BRF:er.')
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void loadBrfs()

    return () => {
      active = false
    }
  }, [])

  const goToApply = (slug: string) => {
    router.push(`/renoapp/brf/${slug}/apply`)
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const slug = extractSlug(value)

    if (!slug) {
      setError('Ange BRF-länk eller BRF-kod för att fortsätta.')
      return
    }

    setError(null)
    goToApply(slug)
  }

  const openBrfPicker = () => {
    setSearch('')
    setIsBrfPickerOpen(true)
  }

  return (
    <main>
      <div className="mx-auto flex min-h-[calc(100vh-73px)] w-full max-w-[1800px] flex-col px-6 py-8 sm:px-8 lg:px-10">
        <section className="border-b border-stone-200 pb-8">
          <h1 className="max-w-[14ch] text-3xl font-semibold tracking-tight text-stone-950 sm:text-4xl xl:text-5xl">
            Skapa renoveringsansökan
          </h1>
          <p className="mt-4 max-w-[44rem] text-base leading-7 text-stone-700 sm:text-lg sm:leading-8">
            Välj din BRF eller klistra in länken du fått från styrelsen för att komma till rätt ansökningssida.
          </p>
        </section>

        <section className="mt-8 grid flex-1 gap-0 border border-stone-200 md:grid-cols-2">
          <article className="border-b border-stone-200 px-6 py-8 md:border-b md:border-r md:px-10 lg:px-12">
            <div className="flex flex-col gap-4">
              <div>
                <p className="text-[0.72rem] font-semibold uppercase tracking-[0.24em] text-stone-500">
                  Välj din BRF
                </p>
                <p className="mt-3 max-w-[32rem] text-base leading-7 text-stone-700">
                  Öppna sökningen och välj rätt BRF för att gå direkt till ansökan.
                </p>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={openBrfPicker}
                  className="inline-flex items-center justify-center border border-stone-950 bg-stone-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-stone-800"
                >
                  Sök BRF
                </button>
              </div>
            </div>
          </article>

          <article className="border-b border-stone-200 px-6 py-8 md:border-b md:px-10 lg:px-12">
            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.24em] text-stone-500">
              Har du redan länken?
            </p>

            <form onSubmit={handleSubmit} className="mt-6 grid gap-4">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-stone-800">BRF-länk eller BRF-kod</span>
                <input
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  className="w-full border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900 outline-none transition focus:border-stone-500"
                  placeholder="Till exempel hushub.se/renoapp/brf/min-brf/apply eller min-brf"
                />
              </label>

              {resolvedSlug ? (
                <p className="text-sm text-stone-600">
                  Du skickas vidare till{' '}
                  <span className="font-medium text-stone-900">/renoapp/brf/{resolvedSlug}/apply</span>
                </p>
              ) : null}

              {error ? (
                <div className="border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>
              ) : null}

              <div className="flex flex-wrap gap-3 pt-2">
                <button
                  type="submit"
                  className="inline-flex items-center justify-center border border-stone-950 bg-stone-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-stone-800"
                >
                  Fortsätt till ansökan
                </button>
              </div>
            </form>
          </article>

          <article className="border-b border-stone-200 px-6 py-8 md:border-b-0 md:border-r md:px-10 lg:px-12">
            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.24em] text-stone-500">
              Det här behöver du
            </p>
            <ul className="mt-5 space-y-3 text-base leading-7 text-stone-700">
              <li>Kontaktuppgifter till dig som söker.</li>
              <li>Rätt BRF eller BRF-länk från styrelsen.</li>
              <li>En kort beskrivning av åtgärden du vill göra.</li>
              <li>Underlag och dokument om din BRF kräver det.</li>
            </ul>
          </article>

          <article className="px-6 py-8 md:px-10 lg:px-12">
            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.24em] text-stone-500">
              Om du inte hittar din BRF
            </p>
            <p className="mt-5 max-w-[32rem] text-base leading-7 text-stone-700">
              Kontakta din BRF eller styrelse och be om rätt RenoApp-länk. Om föreningen ännu inte använder
              RenoApp kan den ansöka om anslutning.
            </p>
            <div className="mt-8">
              <Link
                href="/renoapp/request-access"
                className="inline-flex items-center justify-center border border-stone-300 px-5 py-3 text-sm font-semibold text-stone-800 transition hover:bg-stone-100"
              >
                Min BRF använder inte RenoApp än
              </Link>
            </div>
          </article>
        </section>
      </div>

      {isBrfPickerOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/40 px-4 py-6">
          <div className="w-full max-w-3xl overflow-hidden border border-stone-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-stone-200 px-6 py-5">
              <div>
                <p className="text-[0.72rem] font-semibold uppercase tracking-[0.24em] text-stone-500">Sök BRF</p>
                <h2 className="mt-2 text-2xl font-semibold text-stone-950">Välj din BRF</h2>
                <p className="mt-2 text-sm text-stone-600">Klicka på rätt BRF för att öppna ansökningssidan direkt.</p>
              </div>
              <button
                type="button"
                onClick={() => setIsBrfPickerOpen(false)}
                className="border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-100"
              >
                Stäng
              </button>
            </div>

            <div className="px-6 py-5">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-stone-800">Sök BRF</span>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="w-full border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900 outline-none transition focus:border-stone-500"
                  placeholder="Sök på namn eller adress"
                />
              </label>

              {loading ? (
                <p className="mt-6 text-sm text-stone-600">Laddar BRF-lista...</p>
              ) : filteredItems.length === 0 ? (
                <p className="mt-6 text-sm text-stone-600">Ingen BRF matchade din sökning.</p>
              ) : (
                <div className="mt-6 max-h-[420px] overflow-y-auto border border-stone-200">
                  {filteredItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => goToApply(item.slug)}
                      className="flex w-full items-start justify-between gap-4 border-b border-stone-200 bg-white px-4 py-3 text-left transition last:border-b-0 hover:bg-stone-50"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-stone-900">{item.name}</p>
                        <p className="mt-1 text-sm text-stone-600">{item.address ?? item.slug}</p>
                      </div>
                      <span className="shrink-0 text-sm font-medium text-stone-500">Öppna</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  )
}
