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

type SortField = 'submittedAt' | 'caseNumber' | 'title' | 'status' | 'applicant'
type SortDirection = 'asc' | 'desc'

const COLLATOR = new Intl.Collator('sv', { sensitivity: 'base', numeric: true })

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

function getSortIndicator(active: boolean, direction: SortDirection) {
  if (!active) return '↕'
  return direction === 'asc' ? '↑' : '↓'
}

export default function RenoAppCasesPage() {
  const [items, setItems] = useState<CaseItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sortField, setSortField] = useState<SortField>('submittedAt')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')

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

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
      return
    }

    setSortField(field)
    if (field === 'submittedAt') {
      setSortDirection('desc')
      return
    }
    setSortDirection('asc')
  }

  const filteredAndSorted = useMemo(() => {
    const query = search.trim().toLowerCase()

    const filtered = items.filter((item) => {
      if (!query) return true

      const searchable = [
        item.caseNumber,
        getActionLabel(item),
        getStatusLabel(item.status),
        formatDate(item.submittedAt),
        item.applicant.name ?? '',
        item.applicant.email ?? '',
      ]
        .join(' ')
        .toLowerCase()

      return searchable.includes(query)
    })

    return [...filtered].sort((left, right) => {
      let comparison = 0

      if (sortField === 'submittedAt') {
        comparison = new Date(left.submittedAt).getTime() - new Date(right.submittedAt).getTime()
      } else if (sortField === 'caseNumber') {
        comparison = COLLATOR.compare(left.caseNumber, right.caseNumber)
      } else if (sortField === 'title') {
        comparison = COLLATOR.compare(getActionLabel(left), getActionLabel(right))
      } else if (sortField === 'status') {
        comparison = COLLATOR.compare(getStatusLabel(left.status), getStatusLabel(right.status))
      } else if (sortField === 'applicant') {
        comparison = COLLATOR.compare(left.applicant.name ?? '', right.applicant.name ?? '')
      }

      if (comparison === 0) {
        comparison = new Date(right.submittedAt).getTime() - new Date(left.submittedAt).getTime()
      }

      return sortDirection === 'asc' ? comparison : -comparison
    })
  }, [items, search, sortField, sortDirection])

  const hasActiveFilters = search.trim().length > 0 || sortField !== 'submittedAt' || sortDirection !== 'desc'

  const resetView = () => {
    setSearch('')
    setSortField('submittedAt')
    setSortDirection('desc')
  }

  return (
    <div className="grid gap-6">
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}

      <section className="rounded-[32px] border border-stone-200/80 bg-white/90 p-3 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-[240px] flex-1">
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Sök på ärendenummer, åtgärd, status eller sökande"
              className="w-full rounded-full border border-stone-300 bg-white px-4 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-400"
            />
          </div>
          {hasActiveFilters ? (
            <button
              type="button"
              onClick={resetView}
              className="rounded-full border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
            >
              Rensa
            </button>
          ) : null}
          <p className="ml-auto text-sm text-stone-600">{loading ? 'Laddar ärenden...' : `${filteredAndSorted.length} ärenden`}</p>
        </div>
      </section>

      <section className="overflow-hidden rounded-[32px] border border-stone-200/80 bg-white/90 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
        {loading ? (
          <div className="px-5 py-10 text-sm text-stone-600">Laddar RenoApp-ärenden...</div>
        ) : filteredAndSorted.length === 0 ? (
          <div className="px-5 py-10 text-sm text-stone-600">Inga RenoApp-ärenden hittades i denna vy.</div>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="min-w-full table-fixed text-left text-sm text-stone-800">
                <colgroup>
                  <col className="w-[23%]" />
                  <col className="w-[26%]" />
                  <col className="w-[18%]" />
                  <col className="w-[20%]" />
                  <col className="w-[13%]" />
                </colgroup>
                <thead className="border-b border-stone-200/80 bg-stone-50/80 text-xs uppercase tracking-[0.14em] text-stone-500">
                  <tr>
                    <th className="px-5 py-4">
                      <button
                        type="button"
                        onClick={() => handleSort('caseNumber')}
                        className="inline-flex items-center gap-1 font-semibold hover:text-stone-800"
                      >
                        Ärendenummer
                        <span>{getSortIndicator(sortField === 'caseNumber', sortDirection)}</span>
                      </button>
                    </th>
                    <th className="border-l border-stone-200/80 px-5 py-4">
                      <button
                        type="button"
                        onClick={() => handleSort('title')}
                        className="inline-flex items-center gap-1 font-semibold hover:text-stone-800"
                      >
                        Åtgärd
                        <span>{getSortIndicator(sortField === 'title', sortDirection)}</span>
                      </button>
                    </th>
                    <th className="border-l border-stone-200/80 px-5 py-4">
                      <button
                        type="button"
                        onClick={() => handleSort('status')}
                        className="inline-flex items-center gap-1 font-semibold hover:text-stone-800"
                      >
                        Status
                        <span>{getSortIndicator(sortField === 'status', sortDirection)}</span>
                      </button>
                    </th>
                    <th className="border-l border-stone-200/80 px-5 py-4">
                      <button
                        type="button"
                        onClick={() => handleSort('submittedAt')}
                        className="inline-flex items-center gap-1 font-semibold hover:text-stone-800"
                      >
                        Ansökningsdatum
                        <span>{getSortIndicator(sortField === 'submittedAt', sortDirection)}</span>
                      </button>
                    </th>
                    <th className="border-l border-stone-200/80 px-5 py-4">
                      <button
                        type="button"
                        onClick={() => handleSort('applicant')}
                        className="inline-flex items-center gap-1 font-semibold hover:text-stone-800"
                      >
                        Sökande
                        <span>{getSortIndicator(sortField === 'applicant', sortDirection)}</span>
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200/80">
                  {filteredAndSorted.map((item) => (
                    <tr key={item.id} className="transition hover:bg-stone-50/80">
                      <td className="px-5 py-4 align-middle">
                        <Link href={`/renoapp/app/cases/${item.id}`} className="font-semibold text-stone-900">
                          {item.caseNumber}
                        </Link>
                      </td>
                      <td className="px-5 py-4 align-middle">{getActionLabel(item)}</td>
                      <td className="px-5 py-4 align-middle">{getStatusLabel(item.status)}</td>
                      <td className="px-5 py-4 align-middle">{formatDate(item.submittedAt)}</td>
                      <td className="px-5 py-4 align-middle">{item.applicant.name ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-stone-200/80 md:hidden">
              {filteredAndSorted.map((item) => (
                <Link
                  key={item.id}
                  href={`/renoapp/app/cases/${item.id}`}
                  className="grid gap-2 px-5 py-4 text-sm text-stone-700 transition hover:bg-stone-50/80"
                >
                  <div className="font-semibold text-stone-900">{item.caseNumber}</div>
                  <div>{getActionLabel(item)}</div>
                  <div>{getStatusLabel(item.status)}</div>
                  <div>Ansökningsdatum: {formatDate(item.submittedAt)}</div>
                  <div>Sökande: {item.applicant.name ?? '-'}</div>
                </Link>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  )
}
