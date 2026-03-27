'use client'

import { useEffect, useState } from 'react'

type CaseItem = {
  id: string
  caseNumber: string
  title: string
  status: string
  riskLevel: string | null
  updatedAt: string
  submittedAt: string
  brf: {
    id: string
    name: string | null
    slug: string | null
  }
  actionType: {
    key: string
    label: string
  } | null
  applicant: {
    name: string | null
    email: string | null
  }
}

export default function RenoAppCasesPage() {
  const [items, setItems] = useState<CaseItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    const loadCases = async () => {
      setLoading(true)
      setError(null)

      try {
        const response = await fetch('/api/renoapp/app/cases', { cache: 'no-store' })
        const payload = (await response.json().catch(() => ({}))) as { items?: CaseItem[]; error?: string }

        if (!response.ok) {
          throw new Error(payload.error ?? 'Kunde inte läsa RenoApp-ärenden.')
        }

        if (active) {
          setItems(payload.items ?? [])
        }
      } catch (fetchError) {
        if (active) {
          setError(fetchError instanceof Error ? fetchError.message : 'Kunde inte läsa RenoApp-ärenden.')
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void loadCases()

    return () => {
      active = false
    }
  }, [])

  return (
    <div className="grid gap-6">
      <section className="rounded-[32px] border border-stone-200/80 bg-white/85 p-8 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">Ärenden</p>
        <h2 className="mt-4 text-4xl font-semibold tracking-tight text-stone-900">RenoApp-ärenden</h2>
        <p className="mt-4 max-w-3xl text-base leading-8 text-stone-700">
          Tabellen läser nu från `renovation_cases` tillsammans med BRF, åtgärdstyp och sökande kontakt.
        </p>
        {error ? <p className="mt-4 text-sm text-rose-700">{error}</p> : null}
      </section>

      <section className="overflow-hidden rounded-[32px] border border-stone-200/80 bg-white/90 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
        <div className="hidden grid-cols-[1.2fr_1fr_1fr_0.9fr_1fr_1fr] gap-px bg-stone-200 text-xs font-semibold uppercase tracking-[0.14em] text-stone-500 md:grid">
          {['Ärendenummer', 'BRF', 'Åtgärd', 'Status', 'Risk', 'Sökande'].map((column) => (
            <div key={column} className="bg-stone-50 px-4 py-3">
              {column}
            </div>
          ))}
        </div>

        {loading ? (
          <div className="px-4 py-10 text-sm text-stone-600">Laddar RenoApp-ärenden...</div>
        ) : items.length === 0 ? (
          <div className="px-4 py-10 text-sm text-stone-600">Inga RenoApp-ärenden hittades ännu.</div>
        ) : (
          <div className="divide-y divide-stone-200">
            {items.map((item) => (
              <article key={item.id} className="grid gap-2 px-4 py-4 text-sm text-stone-700 md:grid-cols-[1.2fr_1fr_1fr_0.9fr_1fr_1fr] md:items-center">
                <div>
                  <p className="font-semibold text-stone-900">{item.caseNumber}</p>
                  <p className="mt-1 text-xs text-stone-500">{item.title}</p>
                </div>
                <div>{item.brf.name ?? '-'}</div>
                <div>{item.actionType?.label ?? '-'}</div>
                <div>{item.status}</div>
                <div>{item.riskLevel ?? '-'}</div>
                <div>
                  <p>{item.applicant.name ?? '-'}</p>
                  <p className="text-xs text-stone-500">{item.applicant.email ?? '-'}</p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
