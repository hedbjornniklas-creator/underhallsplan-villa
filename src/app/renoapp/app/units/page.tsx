'use client'

import { useEffect, useState } from 'react'

type UnitItem = {
  id: string
  unitNumberInternal: string | null
  unitNumberSkatteverket: string | null
  status: string
  updatedAt: string
  brf: {
    id: string
    name: string | null
    slug: string | null
  }
  currentContacts: Array<{
    id: string
    name: string | null
    email: string | null
    verificationStatus: string
    relationshipType: string
  }>
}

export default function RenoAppUnitsPage() {
  const [items, setItems] = useState<UnitItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    const loadUnits = async () => {
      setLoading(true)
      setError(null)

      try {
        const response = await fetch('/api/renoapp/app/units', { cache: 'no-store' })
        const payload = (await response.json().catch(() => ({}))) as { items?: UnitItem[]; error?: string }

        if (!response.ok) {
          throw new Error(payload.error ?? 'Kunde inte läsa RenoApp-lägenheter.')
        }

        if (active) {
          setItems(payload.items ?? [])
        }
      } catch (fetchError) {
        if (active) {
          setError(fetchError instanceof Error ? fetchError.message : 'Kunde inte läsa RenoApp-lägenheter.')
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void loadUnits()

    return () => {
      active = false
    }
  }, [])

  return (
    <div className="grid gap-6">
      <section className="rounded-[32px] border border-stone-200/80 bg-white/85 p-8 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">Lägenheter</p>
        <h2 className="mt-4 text-4xl font-semibold tracking-tight text-stone-900">RenoApp-lägenheter</h2>
        <p className="mt-4 max-w-3xl text-base leading-8 text-stone-700">
          Den här listan bygger nu på `brf_units` och `unit_contacts` och visar preliminära kontaktkopplingar per lägenhet.
        </p>
        {error ? <p className="mt-4 text-sm text-rose-700">{error}</p> : null}
      </section>

      {loading ? (
        <section className="rounded-[32px] border border-stone-200/80 bg-white/85 p-8 text-sm text-stone-600 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
          Laddar RenoApp-lägenheter...
        </section>
      ) : items.length === 0 ? (
        <section className="rounded-[32px] border border-stone-200/80 bg-white/85 p-8 text-sm text-stone-600 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
          Inga RenoApp-lägenheter hittades ännu.
        </section>
      ) : (
        <section className="grid gap-5">
          {items.map((item) => (
            <article key={item.id} className="rounded-[28px] border border-stone-200/80 bg-white/85 p-6 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">{item.brf.name ?? 'BRF'}</p>
                  <h3 className="mt-2 text-2xl font-semibold text-stone-900">
                    {item.unitNumberInternal ? `Internt nr ${item.unitNumberInternal}` : 'Internt nr saknas'}
                  </h3>
                  <p className="mt-2 text-sm text-stone-700">Skatteverket: {item.unitNumberSkatteverket ?? '-'}</p>
                </div>
                <div className="rounded-full border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-800">{item.status}</div>
              </div>

              <div className="mt-5 rounded-3xl border border-stone-200 bg-stone-50 p-5">
                <p className="text-sm font-semibold text-stone-900">Aktuella kontakter</p>
                {item.currentContacts.length === 0 ? (
                  <p className="mt-3 text-sm text-stone-700">Ingen kontakt är ännu kopplad som aktuell.</p>
                ) : (
                  <ul className="mt-3 space-y-2 text-sm text-stone-700">
                    {item.currentContacts.map((contact) => (
                      <li key={contact.id} className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
                        <p className="font-medium text-stone-900">{contact.name ?? 'Okänd kontakt'}</p>
                        <p>{contact.email ?? '-'}</p>
                        <p className="text-xs uppercase tracking-[0.12em] text-stone-500">
                          {contact.relationshipType} · {contact.verificationStatus}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  )
}
