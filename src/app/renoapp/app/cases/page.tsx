'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

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

type SortKey = 'submitted_desc' | 'submitted_asc' | 'case_number' | 'status'

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleDateString('sv-SE')
}

function getStatusLabel(status: string) {
  if (status === 'draft') return 'Utkast'
  if (status === 'submitted' || status === 'review') return 'Under granskning'
  if (status === 'need_info') return 'Begär komplettering'
  if (status === 'approved') return 'Godkänd'
  if (status === 'conditional') return 'Godkänd med villkor'
  if (status === 'rejected') return 'Avslag'
  return status || '-'
}

function getActionLabel(item: CaseItem) {
  const title = item.title.trim()
  if (title) {
    return title.startsWith('Renovering: ') ? title.slice('Renovering: '.length) : title
  }

  return item.actionType?.label ?? '-'
}

export default function RenoAppCasesPage() {
  const [items, setItems] = useState<CaseItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<SortKey>('submitted_desc')

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

  const sortedItems = useMemo(() => {
    const next = [...items]

    next.sort((left, right) => {
      if (sortBy === 'submitted_asc') {
        return new Date(left.submittedAt).getTime() - new Date(right.submittedAt).getTime()
      }

      if (sortBy === 'case_number') {
        return left.caseNumber.localeCompare(right.caseNumber, 'sv')
      }

      if (sortBy === 'status') {
        return getStatusLabel(left.status).localeCompare(getStatusLabel(right.status), 'sv') || right.submittedAt.localeCompare(left.submittedAt)
      }

      return new Date(right.submittedAt).getTime() - new Date(left.submittedAt).getTime()
    })

    return next
  }, [items, sortBy])

  return (
    <div className="grid gap-6">
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}

      <section className="overflow-hidden rounded-[32px] border border-stone-200/80 bg-white/90 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200/80 bg-stone-50/80 px-4 py-3">
          <p className="text-sm font-medium text-stone-600">
            {loading ? 'Laddar ärenden...' : `${sortedItems.length} ärenden`}
          </p>
          <label className="flex items-center gap-2 text-sm text-stone-700">
            <span className="font-medium">Sortera</span>
            <select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as SortKey)}
              className="rounded-full border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none"
            >
              <option value="submitted_desc">Ansökningsdatum, nyast först</option>
              <option value="submitted_asc">Ansökningsdatum, äldst först</option>
              <option value="case_number">Ärendenummer</option>
              <option value="status">Status</option>
            </select>
          </label>
        </div>

        <div className="hidden grid-cols-[1.2fr_1fr_0.9fr_1fr_1fr] gap-px bg-stone-200 text-xs font-semibold uppercase tracking-[0.14em] text-stone-500 md:grid">
          {['Ärendenummer', 'Åtgärd', 'Status', 'Ansökningsdatum', 'Sökande'].map((column) => (
            <div key={column} className="bg-stone-50 px-4 py-3">
              {column}
            </div>
          ))}
        </div>

        {loading ? (
          <div className="px-4 py-10 text-sm text-stone-600">Laddar RenoApp-ärenden...</div>
        ) : sortedItems.length === 0 ? (
          <div className="px-4 py-10 text-sm text-stone-600">Inga RenoApp-ärenden hittades ännu.</div>
        ) : (
          <div className="divide-y divide-stone-200">
            {sortedItems.map((item) => (
              <Link
                key={item.id}
                href={`/renoapp/app/cases/${item.id}`}
                className="grid gap-2 px-4 py-4 text-sm text-stone-700 transition hover:bg-stone-50/80 md:grid-cols-[1.2fr_1fr_0.9fr_1fr_1fr] md:items-center"
              >
                <div className="font-semibold text-stone-900">{item.caseNumber}</div>
                <div>{getActionLabel(item)}</div>
                <div>{getStatusLabel(item.status)}</div>
                <div>{formatDate(item.submittedAt)}</div>
                <div>{item.applicant.name ?? '-'}</div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
