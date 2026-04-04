'use client'

import { useEffect, useState } from 'react'

type DashboardResponse = {
  accessibleBrfs: Array<{
    id: string
    name: string | null
    slug: string | null
    role: 'board' | 'admin'
  }>
  activeBrfId: string | null
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
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}

      {loading ? (
        <section className="rounded-[32px] border border-stone-200/80 bg-white/85 p-8 text-sm text-stone-600 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
          Laddar RenoApp-sammanfattning...
        </section>
      ) : (
        <section className="grid gap-5 lg:grid-cols-3">
          {cards.map((card) => (
            <article
              key={card.title}
              className="rounded-[28px] border border-stone-200/80 bg-white/85 p-6 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]"
            >
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">
                {card.title}
              </p>
              <p className="mt-4 text-5xl font-semibold tracking-tight text-stone-900">{card.value}</p>
              <p className="mt-3 text-sm leading-7 text-stone-700">{card.description}</p>
            </article>
          ))}
        </section>
      )}
    </div>
  )
}
