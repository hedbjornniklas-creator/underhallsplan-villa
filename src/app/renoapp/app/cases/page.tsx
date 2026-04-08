'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

type CaseItem = {
  id: string
  caseNumber: string
  title: string
  status: 'draft' | 'submitted' | 'review' | 'need_info' | 'approved' | 'conditional' | 'rejected' | string
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

type StatusFilter = 'all' | 'draft' | 'review' | 'need_info' | 'approved' | 'conditional' | 'rejected'
type SortField = 'caseNumber' | 'title' | 'status' | 'submittedAt' | 'applicant'
type SortDirection = 'asc' | 'desc'

type SavedListView = {
  search: string
  statusFilter: StatusFilter
  sortField: SortField
  sortDirection: SortDirection
  pageSize: number
}

const STORAGE_KEY = 'renoapp:cases:list:view:v1'
const DEFAULT_PAGE_SIZE = 25
const PAGE_SIZE_OPTIONS = [10, 25, 50]
const COLLATOR = new Intl.Collator('sv', { sensitivity: 'base', numeric: true })

const STATUS_TABS: Array<{ key: StatusFilter; label: string }> = [
  { key: 'all', label: 'Alla' },
  { key: 'draft', label: 'Utkast' },
  { key: 'review', label: 'Under granskning' },
  { key: 'need_info', label: 'Begär komplettering' },
  { key: 'approved', label: 'Godkänd' },
  { key: 'conditional', label: 'Godkänd med villkor' },
  { key: 'rejected', label: 'Avslag' },
]

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

function getStatusBucket(status: CaseItem['status']): StatusFilter {
  if (status === 'draft') return 'draft'
  if (status === 'need_info') return 'need_info'
  if (status === 'approved') return 'approved'
  if (status === 'conditional') return 'conditional'
  if (status === 'rejected') return 'rejected'
  return 'review'
}

function getStatusSortRank(status: CaseItem['status']) {
  switch (getStatusBucket(status)) {
    case 'draft':
      return 0
    case 'review':
      return 1
    case 'need_info':
      return 2
    case 'approved':
      return 3
    case 'conditional':
      return 4
    case 'rejected':
      return 5
    default:
      return 6
  }
}

function getStatusRowClass(status: CaseItem['status']) {
  switch (getStatusBucket(status)) {
    case 'draft':
      return 'bg-[#F9FAFB] text-black hover:bg-[#F3F4F6] focus-visible:bg-[#F3F4F6]'
    case 'review':
      return 'bg-[#DBEAFE] text-black hover:bg-[#BFDBFE] focus-visible:bg-[#BFDBFE]'
    case 'need_info':
      return 'bg-[#FEF3C7] text-black hover:bg-[#FDE68A] focus-visible:bg-[#FDE68A]'
    case 'approved':
      return 'bg-[#DCFCE7] text-black hover:bg-[#BBF7D0] focus-visible:bg-[#BBF7D0]'
    case 'conditional':
      return 'bg-[#FFEDD5] text-black hover:bg-[#FED7AA] focus-visible:bg-[#FED7AA]'
    case 'rejected':
      return 'bg-[#FEE2E2] text-black hover:bg-[#FECACA] focus-visible:bg-[#FECACA]'
    default:
      return 'bg-white text-black hover:bg-stone-50 focus-visible:bg-stone-50'
  }
}

type StatusTabStyle = {
  inactive: string
  active: string
  countInactive: string
  countActive: string
}

function getStatusTabStyle(key: StatusFilter): StatusTabStyle {
  switch (key) {
    case 'draft':
      return {
        inactive: 'border-gray-300 bg-[#F9FAFB] text-[#111827] hover:bg-[#F3F4F6]',
        active: 'border-gray-400 bg-[#FFFFFF] text-[#111827]',
        countInactive: 'bg-gray-200 text-[#111827]',
        countActive: 'bg-gray-200 text-[#111827]',
      }
    case 'review':
      return {
        inactive: 'border-[#93C5FD] bg-[#DBEAFE] text-[#1E3A8A] hover:bg-[#BFDBFE]',
        active: 'border-[#2563EB] bg-[#2563EB] text-[#FFFFFF]',
        countInactive: 'bg-[#BFDBFE] text-[#1E3A8A]',
        countActive: 'bg-white/20 text-white',
      }
    case 'need_info':
      return {
        inactive: 'border-[#FDE68A] bg-[#FEF3C7] text-[#92400E] hover:bg-[#FDE68A]',
        active: 'border-[#FACC15] bg-[#FACC15] text-[#111827]',
        countInactive: 'bg-[#FDE68A] text-[#92400E]',
        countActive: 'bg-[#EAB308] text-[#111827]',
      }
    case 'approved':
      return {
        inactive: 'border-[#86EFAC] bg-[#DCFCE7] text-[#14532D] hover:bg-[#BBF7D0]',
        active: 'border-[#15803D] bg-[#15803D] text-[#FFFFFF]',
        countInactive: 'bg-[#BBF7D0] text-[#14532D]',
        countActive: 'bg-white/20 text-white',
      }
    case 'conditional':
      return {
        inactive: 'border-[#FDBA74] bg-[#FFEDD5] text-[#9A3412] hover:bg-[#FED7AA]',
        active: 'border-[#C2410C] bg-[#C2410C] text-[#FFFFFF]',
        countInactive: 'bg-[#FED7AA] text-[#9A3412]',
        countActive: 'bg-white/20 text-white',
      }
    case 'rejected':
      return {
        inactive: 'border-[#FCA5A5] bg-[#FEE2E2] text-[#7F1D1D] hover:bg-[#FECACA]',
        active: 'border-[#DC2626] bg-[#DC2626] text-[#FFFFFF]',
        countInactive: 'bg-[#FECACA] text-[#7F1D1D]',
        countActive: 'bg-white/20 text-white',
      }
    default:
      return {
        inactive: 'border-indigo-300 bg-indigo-100 text-indigo-900 hover:bg-indigo-200',
        active: 'border-indigo-700 bg-indigo-700 text-white',
        countInactive: 'bg-indigo-200 text-indigo-900',
        countActive: 'bg-white/20 text-white',
      }
  }
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
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sortField, setSortField] = useState<SortField>('submittedAt')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [currentPage, setCurrentPage] = useState(1)

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

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (!raw) return

      const saved = JSON.parse(raw) as Partial<SavedListView>
      if (typeof saved.search === 'string') setSearch(saved.search)
      if (saved.statusFilter && STATUS_TABS.some((tab) => tab.key === saved.statusFilter)) {
        setStatusFilter(saved.statusFilter)
      }
      if (saved.sortField) setSortField(saved.sortField)
      if (saved.sortDirection) setSortDirection(saved.sortDirection)
      if (typeof saved.pageSize === 'number' && PAGE_SIZE_OPTIONS.includes(saved.pageSize)) {
        setPageSize(saved.pageSize)
      }
    } catch {
      // Ignore malformed localStorage payloads
    }
  }, [])

  useEffect(() => {
    const payload: SavedListView = {
      search,
      statusFilter,
      sortField,
      sortDirection,
      pageSize,
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  }, [search, statusFilter, sortField, sortDirection, pageSize])

  useEffect(() => {
    setCurrentPage(1)
  }, [search, statusFilter, sortField, sortDirection, pageSize])

  const statusCounts = useMemo(() => {
    const counts: Record<StatusFilter, number> = {
      all: items.length,
      draft: 0,
      review: 0,
      need_info: 0,
      approved: 0,
      conditional: 0,
      rejected: 0,
    }

    for (const item of items) {
      counts[getStatusBucket(item.status)] += 1
    }

    return counts
  }, [items])

  const filteredAndSorted = useMemo(() => {
    const query = search.trim().toLowerCase()

    const filtered = items.filter((item) => {
      if (statusFilter !== 'all' && getStatusBucket(item.status) !== statusFilter) {
        return false
      }

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
        comparison = getStatusSortRank(left.status) - getStatusSortRank(right.status)
      } else if (sortField === 'applicant') {
        comparison = COLLATOR.compare(left.applicant.name ?? '', right.applicant.name ?? '')
      }

      if (comparison === 0) {
        comparison = new Date(right.submittedAt).getTime() - new Date(left.submittedAt).getTime()
      }

      return sortDirection === 'asc' ? comparison : -comparison
    })
  }, [items, search, sortField, sortDirection, statusFilter])

  const totalItems = filteredAndSorted.length
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  const safePage = Math.min(currentPage, totalPages)

  const pagedRows = useMemo(() => {
    const start = (safePage - 1) * pageSize
    return filteredAndSorted.slice(start, start + pageSize)
  }, [filteredAndSorted, pageSize, safePage])

  useEffect(() => {
    if (currentPage !== safePage) {
      setCurrentPage(safePage)
    }
  }, [currentPage, safePage])

  const hasActiveFilters =
    search.trim().length > 0 ||
    statusFilter !== 'all' ||
    sortField !== 'submittedAt' ||
    sortDirection !== 'desc' ||
    pageSize !== DEFAULT_PAGE_SIZE

  const resetView = () => {
    setSearch('')
    setStatusFilter('all')
    setSortField('submittedAt')
    setSortDirection('desc')
    setPageSize(DEFAULT_PAGE_SIZE)
    setCurrentPage(1)
  }

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
    if (field === 'status') {
      setSortDirection('asc')
      return
    }
    setSortDirection('asc')
  }

  return (
    <div className="grid gap-6">
      <section className="rounded-[32px] border border-stone-200/80 bg-white/90 p-3 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
        <div className="flex items-center gap-1 overflow-x-auto whitespace-nowrap pb-0.5">
          <div className="w-[320px] shrink-0">
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Sök på ärendenummer, åtgärd, status eller sökande"
              className="w-full rounded-md border border-stone-300 bg-white px-2 py-1 text-[11px] text-stone-900 placeholder:text-stone-400 focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-500"
            />
          </div>

          {STATUS_TABS.map((tab) => {
            const active = statusFilter === tab.key
            const style = getStatusTabStyle(tab.key)
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setStatusFilter(tab.key)}
                className={
                  active
                    ? `inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium ${style.active}`
                    : `inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] ${style.inactive}`
                }
              >
                <span>{tab.label}</span>
                <span
                  className={
                    active
                      ? `rounded-full px-1.5 py-0 text-[10px] ${style.countActive}`
                      : `rounded-full px-1.5 py-0 text-[10px] ${style.countInactive}`
                  }
                >
                  {statusCounts[tab.key]}
                </span>
              </button>
            )
          })}

          <div className="ml-auto flex shrink-0 items-center gap-1">
            <label className="text-[10px] text-stone-600" htmlFor="renoappCasesPageSize">
              Rader/sida
            </label>
            <select
              id="renoappCasesPageSize"
              value={pageSize}
              onChange={(event) => setPageSize(Number(event.target.value))}
              className="rounded-md border border-stone-300 bg-white px-1.5 py-0.5 text-[11px] text-stone-700"
            >
              {PAGE_SIZE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>

            {hasActiveFilters ? (
              <button
                type="button"
                onClick={resetView}
                className="rounded-md border border-stone-300 px-2 py-0.5 text-[11px] text-stone-700 hover:bg-stone-50"
              >
                Rensa filter
              </button>
            ) : null}
          </div>
        </div>
      </section>

      {error ? <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}

      {loading ? (
        <div className="text-sm text-stone-600">Laddar RenoApp-ärenden...</div>
      ) : totalItems === 0 ? (
        <div className="rounded-md border border-dashed border-stone-300 bg-white/75 p-4 text-sm text-stone-700">
          Inga RenoApp-ärenden i denna vy.
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
            <table className="min-w-full text-left text-sm text-black">
              <thead className="border-b bg-stone-50 text-xs uppercase text-black">
                <tr>
                  <th className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => handleSort('caseNumber')}
                      className="inline-flex items-center gap-1 font-semibold hover:text-stone-900"
                    >
                      Ärendenummer <span>{getSortIndicator(sortField === 'caseNumber', sortDirection)}</span>
                    </button>
                  </th>
                  <th className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => handleSort('title')}
                      className="inline-flex items-center gap-1 font-semibold hover:text-stone-900"
                    >
                      Åtgärd <span>{getSortIndicator(sortField === 'title', sortDirection)}</span>
                    </button>
                  </th>
                  <th className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => handleSort('status')}
                      className="inline-flex items-center gap-1 font-semibold hover:text-stone-900"
                    >
                      Status <span>{getSortIndicator(sortField === 'status', sortDirection)}</span>
                    </button>
                  </th>
                  <th className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => handleSort('submittedAt')}
                      className="inline-flex items-center gap-1 font-semibold hover:text-stone-900"
                    >
                      Ansökningsdatum <span>{getSortIndicator(sortField === 'submittedAt', sortDirection)}</span>
                    </button>
                  </th>
                  <th className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => handleSort('applicant')}
                      className="inline-flex items-center gap-1 font-semibold hover:text-stone-900"
                    >
                      Sökande <span>{getSortIndicator(sortField === 'applicant', sortDirection)}</span>
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {pagedRows.map((item) => (
                  <tr key={item.id} className={`${getStatusRowClass(item.status)} border-b border-stone-200`}>
                    <td className="px-4 py-3">
                      <Link href={`/renoapp/app/cases/${item.id}`} className="font-semibold text-stone-900">
                        {item.caseNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{getActionLabel(item)}</td>
                    <td className="px-4 py-3">{getStatusLabel(item.status)}</td>
                    <td className="px-4 py-3">{formatDate(item.submittedAt)}</td>
                    <td className="px-4 py-3">{item.applicant.name ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-stone-600">
            <p>
              Visar {(safePage - 1) * pageSize + 1}-{Math.min(safePage * pageSize, totalItems)} av {totalItems} ärenden
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCurrentPage((current) => Math.max(1, current - 1))}
                disabled={safePage <= 1}
                className="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Föregående
              </button>
              <span>
                Sida {safePage} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setCurrentPage((current) => Math.min(totalPages, current + 1))}
                disabled={safePage >= totalPages}
                className="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Nästa
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
