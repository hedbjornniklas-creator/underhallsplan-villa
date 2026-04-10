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

export default function RenoAppResidentApplyEntryPage() {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [items, setItems] = useState<PublicBrfListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isBrfPickerOpen, setIsBrfPickerOpen] = useState(false)

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

  const openBrfPicker = () => {
    setSearch('')
    setIsBrfPickerOpen(true)
  }

  return (
    <main>
      <div className="mx-auto flex min-h-[calc(100vh-73px)] w-full max-w-[1800px] flex-col px-6 py-8 sm:px-8 lg:px-10">
        <section className="border-b border-stone-200 pb-8 text-center">
          <h1 className="mx-auto max-w-[16ch] text-3xl font-semibold tracking-tight text-stone-950 sm:text-4xl xl:text-5xl">
            Skapa renoveringsansökan
          </h1>
          <p className="mx-auto mt-4 max-w-[42rem] text-base leading-7 text-stone-700 sm:text-lg sm:leading-8">
            Välj din BRF för att öppna rätt ansökningssida. Har du redan fått en direktlänk från styrelsen kan du gå
            vidare via den direkt.
          </p>
        </section>

        <section className="flex flex-1 flex-col">
          <article className="border-b border-stone-200 px-2 py-12 md:px-12 lg:px-16 xl:px-20">
            <div className="mx-auto w-full max-w-[32rem]">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.24em] text-stone-500">
                För boende och lägenhetsinnehavare
              </p>
              <h2 className="mt-4 text-4xl font-semibold tracking-tight text-stone-950 sm:text-5xl">Välj din BRF</h2>
              <p className="mt-5 max-w-[30rem] text-base leading-8 text-stone-700 sm:text-lg">
                Öppna sökningen och välj rätt BRF för att gå direkt till ansökan. Har du en personlig länk från
                styrelsen kan du använda den i stället.
              </p>
              <div className="mt-10">
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

          <article className="border-b border-stone-200 px-2 py-12 md:px-12 lg:px-16 xl:px-20">
            <div className="mx-auto w-full max-w-[32rem]">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.24em] text-stone-500">
                Så fungerar ansökan
              </p>
              <h2 className="mt-4 text-4xl font-semibold tracking-tight text-stone-950 sm:text-5xl">
                Ett steg i taget
              </h2>
              <ul className="mt-5 space-y-3 text-base leading-8 text-stone-700 sm:text-lg">
                <li>Välj din BRF och öppna rätt ansökningssida.</li>
                <li>Fyll i det du har just nu och spara utkast om du vill fortsätta senare.</li>
                <li>Skicka in även om allt inte är klart från början.</li>
                <li>Om styrelsen begär komplettering fortsätter du via samma länk.</li>
              </ul>
            </div>
          </article>

          <article className="border-b border-stone-200 px-2 py-12 md:px-12 lg:px-16 xl:px-20">
            <div className="mx-auto w-full max-w-[32rem]">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.24em] text-stone-500">
                Det här behöver du
              </p>
              <h2 className="mt-4 text-4xl font-semibold tracking-tight text-stone-950 sm:text-5xl">
                Förbered det viktigaste
              </h2>
              <ul className="mt-5 space-y-3 text-base leading-8 text-stone-700 sm:text-lg">
                <li>Kontaktuppgifter till dig som söker.</li>
                <li>Rätt BRF eller BRF-länk från styrelsen.</li>
                <li>En kort beskrivning av åtgärden du vill göra.</li>
                <li>Underlag och dokument om din BRF kräver det.</li>
              </ul>
            </div>
          </article>

          <article className="border-b border-stone-200 px-2 py-12 md:px-12 lg:px-16 xl:px-20">
            <div className="mx-auto w-full max-w-[32rem]">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.24em] text-stone-500">
                Hittar du inte din BRF?
              </p>
              <h2 className="mt-4 text-4xl font-semibold tracking-tight text-stone-950 sm:text-5xl">
                Be om rätt länk
              </h2>
              <p className="mt-5 max-w-[30rem] text-base leading-8 text-stone-700 sm:text-lg">
                Kontakta din BRF eller styrelse och be om rätt RenoApp-länk. Om föreningen ännu inte använder RenoApp
                kan den ansöka om anslutning.
              </p>
              <div className="mt-10">
                <Link
                  href="/renoapp/request-access"
                  className="inline-flex items-center justify-center border border-stone-300 px-5 py-3 text-sm font-semibold text-stone-800 transition hover:bg-stone-100"
                >
                  Min BRF använder inte RenoApp än
                </Link>
              </div>
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
