'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

type DashboardResponse = {
  accessibleBrfs: Array<{
    id: string
    name: string | null
    slug: string | null
    role: 'board' | 'admin'
  }>
  stats: {
    openCases: number
    needInfoCases: number
    preliminaryUnits: number
  }
}

export default function RenoAppAppHomePage() {
  const [payload, setPayload] = useState<DashboardResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    const loadSummary = async () => {
      setLoading(true)
      setError(null)

      try {
        const response = await fetch('/api/renoapp/app/context', { cache: 'no-store' })
        const data = (await response.json().catch(() => ({}))) as DashboardResponse & { error?: string }

        if (!response.ok) {
          throw new Error(data.error ?? 'Kunde inte läsa RenoApp-kontext.')
        }

        if (active) {
          setPayload(data)
        }
      } catch (fetchError) {
        if (active) {
          setError(fetchError instanceof Error ? fetchError.message : 'Kunde inte läsa RenoApp-kontext.')
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void loadSummary()

    return () => {
      active = false
    }
  }, [])

  const cards = [
    {
      title: 'Öppna ärenden',
      value: payload?.stats.openCases ?? 0,
      description: 'Submitted, review och conditional.',
    },
    {
      title: 'Väntar på komplettering',
      value: payload?.stats.needInfoCases ?? 0,
      description: 'Ärenden med status need_info.',
    },
    {
      title: 'Preliminära lägenheter',
      value: payload?.stats.preliminaryUnits ?? 0,
      description: 'BRF-lägenheter med status preliminary.',
    },
  ]

  return (
    <div className="grid gap-6">
      <section className="rounded-[32px] border border-stone-200/80 bg-white/85 p-8 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">MVP-skelett</p>
        <h2 className="mt-4 text-4xl font-semibold tracking-tight text-stone-900">RenoApp är nu kopplad till sina egna API-routes.</h2>
        <p className="mt-4 max-w-3xl text-base leading-8 text-stone-700">
          Styrelseportalen läser nu riktig RenoApp-data från de nya tabellerna. Om du inte har BRF-medlemskap ännu visas ett tydligt åtkomstfel, utan att någon befintlig modul påverkas.
        </p>
        {error ? <p className="mt-4 text-sm text-rose-700">{error}</p> : null}
      </section>

      {loading ? (
        <section className="rounded-[32px] border border-stone-200/80 bg-white/85 p-8 text-sm text-stone-600 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
          Laddar RenoApp-sammanfattning...
        </section>
      ) : (
        <>
          <section className="grid gap-5 lg:grid-cols-3">
            {cards.map((card) => (
              <article key={card.title} className="rounded-[28px] border border-stone-200/80 bg-white/85 p-6 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">{card.title}</p>
                <p className="mt-4 text-5xl font-semibold tracking-tight text-stone-900">{card.value}</p>
                <p className="mt-3 text-sm leading-7 text-stone-700">{card.description}</p>
              </article>
            ))}
          </section>

          <section className="rounded-[32px] border border-stone-200/80 bg-[linear-gradient(150deg,rgba(252,250,247,0.96),rgba(238,246,244,0.92))] p-8 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
            <h3 className="text-2xl font-semibold text-stone-900">Tillgängliga BRF-kopplingar</h3>
            {payload && payload.accessibleBrfs.length > 0 ? (
              <div className="mt-5 grid gap-3 md:grid-cols-2">
                {payload.accessibleBrfs.map((brf) => (
                  <div key={brf.id} className="rounded-2xl border border-stone-200 bg-white/80 p-4 text-sm leading-7 text-stone-700">
                    <p className="font-semibold text-stone-900">{brf.name ?? 'Namnlös BRF'}</p>
                    <p>Slug: {brf.slug ?? '-'}</p>
                    <p>Roll: {brf.role}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-5 text-sm text-stone-700">Ingen RenoApp-BRF är ännu kopplad till den inloggade användaren.</p>
            )}

            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/renoapp/app/cases" className="rounded-full bg-stone-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-stone-700">
                Öppna ärenden
              </Link>
              <Link href="/renoapp/app/units" className="rounded-full border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-100">
                Öppna lägenheter
              </Link>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
