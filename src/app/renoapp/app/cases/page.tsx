'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CircleHelp, ArrowDown, ArrowUp, ArrowUpDown, ChevronRight, ChevronLeft, RotateCcw, Search, X } from 'lucide-react'

type CaseItem = {
  id: string
  caseNumber: string
  title: string
  status: 'draft' | 'new_application' | 'submitted' | 'review' | 'need_info' | 'approved' | 'conditional' | 'rejected' | string
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

type StatusFilter = 'all' | 'draft' | 'new_application' | 'review' | 'need_info' | 'approved' | 'rejected'
type SortField = 'caseNumber' | 'title' | 'status' | 'submittedAt' | 'applicant'
type SortDirection = 'asc' | 'desc'

type SavedListView = {
  sortVersion: number
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
  { key: 'new_application', label: 'Ny ansökan' },
  { key: 'review', label: 'Att granska' },
  { key: 'need_info', label: 'Komplettering begärd' },
  { key: 'approved', label: 'Godkänd' },
  { key: 'rejected', label: 'Avslag' },
  { key: 'draft', label: 'Utkast' },
]

const STATUS_HELP_ITEMS = [
  {
    key: 'new_application',
    label: 'Ny ansökan',
    meaning: 'Ansökan är inskickad och styrelsen ska välja vilka uppgifter eller underlag som ska begäras in.',
    action: 'Öppna ärendet, granska ansökan och markera vad som ska begäras in från sökanden.',
  },
  {
    key: 'review',
    label: 'Att granska',
    meaning: 'Ansökan är inskickad och väntar på styrelsens handläggning.',
    action: 'Öppna ärendet, granska underlag och fatta beslut eller begär komplettering om något saknas.',
  },
  {
    key: 'need_info',
    label: 'Komplettering begärd',
    meaning: 'Styrelsen har bett lägenhetsinnehavaren att skicka in mer information eller fler underlag.',
    action: 'Följ upp ärendet och fortsätt handläggningen när kompletteringen har kommit in.',
  },
  {
    key: 'approved',
    label: 'Godkänd',
    meaning: 'Ansökan är godkänd. Beslutet kan innehålla villkor som måste följas.',
    action: 'Öppna ärendet för att läsa beslutet och eventuella villkor.',
  },
  {
    key: 'rejected',
    label: 'Avslag',
    meaning: 'Ansökan har fått avslag i sin nuvarande form.',
    action: 'Öppna ärendet för att läsa motivering och beslut om lägenhetsinnehavaren återkommer senare.',
  },
  {
    key: 'draft',
    label: 'Utkast',
    meaning: 'Ärendet är påbörjat men ännu inte inskickat av lägenhetsinnehavaren.',
    action: 'Styrelsen behöver normalt inte göra något ännu. Avvakta tills ansökan skickas in.',
  },
] as const

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleDateString('sv-SE')
}

function getStatusLabel(status: string) {
  if (status === 'draft') return 'Utkast'
  if (status === 'new_application' || status === 'submitted') return 'Ny ansökan'
  if (status === 'review') return 'Att granska'
  if (status === 'need_info') return 'Komplettering begärd'
  if (status === 'approved' || status === 'conditional') return 'Godkänd'
  if (status === 'rejected') return 'Avslag'
  return status || '-'
}

function getStatusBucket(status: CaseItem['status']): StatusFilter {
  if (status === 'draft') return 'draft'
  if (status === 'new_application' || status === 'submitted') return 'new_application'
  if (status === 'need_info') return 'need_info'
  if (status === 'approved' || status === 'conditional') return 'approved'
  if (status === 'rejected') return 'rejected'
  return 'review'
}

function getStatusSortRank(status: CaseItem['status']) {
  switch (getStatusBucket(status)) {
    case 'new_application':
      return 0
    case 'review':
      return 1
    case 'need_info':
      return 2
    case 'approved':
      return 3
    case 'rejected':
      return 4
    case 'draft':
      return 5
    default:
      return 6
  }
}

function getStatusMarkerClass(status: CaseItem['status']) {
  switch (getStatusBucket(status)) {
    case 'draft':
      return 'bg-stone-500'
    case 'new_application':
      return 'bg-violet-600'
    case 'review':
      return 'bg-cyan-600'
    case 'need_info':
      return 'bg-amber-500'
    case 'approved':
      return 'bg-emerald-600'
    case 'rejected':
      return 'bg-rose-600'
    default:
      return 'bg-stone-500'
  }
}

function getActionLabel(item: CaseItem) {
  const title = item.title.trim()
  if (title === 'RenoveringsansÃ¶kan') return 'Renoveringsansökan'
  if (title) {
    return title.startsWith('Renovering: ') ? title.slice('Renovering: '.length) : title
  }

  return item.actionType?.label ?? '-'
}

function getSortIndicator(active: boolean, direction: SortDirection) {
  const Icon = active ? (direction === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
  return <Icon size={14} aria-hidden="true" />
}

export default function RenoAppCasesPage() {
  const router = useRouter()
  const [items, setItems] = useState<CaseItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showStatusHelp, setShowStatusHelp] = useState(false)
  const statusDialog = useRef<HTMLDialogElement>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sortField, setSortField] = useState<SortField>('status')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [currentPage, setCurrentPage] = useState(1)

  useEffect(() => {
    if (!showStatusHelp) return
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    statusDialog.current?.showModal()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
      trigger?.focus()
    }
  }, [showStatusHelp])

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

      const saved = JSON.parse(raw) as Partial<Omit<SavedListView, 'statusFilter'>> & { statusFilter?: StatusFilter | 'conditional' }
      if (typeof saved.search === 'string') setSearch(saved.search)
      if (saved.statusFilter === 'conditional') {
        setStatusFilter('approved')
      } else if (saved.statusFilter && STATUS_TABS.some((tab) => tab.key === saved.statusFilter)) {
        setStatusFilter(saved.statusFilter)
      }
      // Migrate the old date default without discarding other saved preferences.
      const oldDefault = saved.sortVersion !== 2 && saved.sortField === 'submittedAt' && saved.sortDirection === 'desc'
      if (!oldDefault) {
        if (saved.sortField) setSortField(saved.sortField)
        if (saved.sortDirection) setSortDirection(saved.sortDirection)
      }
      if (typeof saved.pageSize === 'number' && PAGE_SIZE_OPTIONS.includes(saved.pageSize)) {
        setPageSize(saved.pageSize)
      }
    } catch {
      // Ignore malformed localStorage payloads
    }
  }, [])

  useEffect(() => {
    const payload: SavedListView = {
      sortVersion: 2,
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
      new_application: 0,
      review: 0,
      need_info: 0,
      approved: 0,
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
    sortField !== 'status' ||
    sortDirection !== 'asc' ||
    pageSize !== DEFAULT_PAGE_SIZE

  const resetView = () => {
    setSearch('')
    setStatusFilter('all')
    setSortField('status')
    setSortDirection('asc')
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
      <div>
        <h1 className="text-2xl font-bold text-[var(--reno-ink)]">Ärendehantering</h1>
      </div>

      <section className="reno-cases-workspace" aria-label="Ärenden">
        <div className="reno-cases-toolbar">
          <div className="reno-cases-search">
            <Search size={18} aria-hidden="true" />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Sök ärenden"
              aria-label="Sök ärenden"
              className="reno-field h-11 w-full border bg-white py-2 pl-10 pr-3 text-[var(--reno-ink)] placeholder:text-[var(--reno-muted)]"
            />
          </div>
          <button
            type="button"
            onClick={() => setShowStatusHelp(true)}
            className="reno-cases-help"
            aria-label="Vad betyder statusarna?"
            title="Vad betyder statusarna?"
          >
            <CircleHelp size={16} className="shrink-0" aria-hidden="true" />
            <span>Vad betyder statusarna?</span>
          </button>

          <div className="reno-cases-filters" role="group" aria-label="Filtrera efter status">
            {STATUS_TABS.map((tab) => {
              const active = statusFilter === tab.key
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setStatusFilter(tab.key)}
                  aria-pressed={active}
                  className="reno-cases-filter"
                >
                  <span>{tab.label}</span>
                  <span className="reno-cases-filter-count">
                    {statusCounts[tab.key]}
                  </span>
                </button>
              )
            })}
          </div>

          <label className="reno-cases-filter-mobile">
            <span className="sr-only">Filtrera efter status</span>
            <select id="renoappCasesStatusFilter" value={statusFilter} onChange={event => setStatusFilter(event.target.value as StatusFilter)}
              className="reno-field min-h-11 w-full min-w-0 border bg-white px-2">
              {STATUS_TABS.map(tab => <option key={tab.key} value={tab.key}>{tab.label} ({statusCounts[tab.key]})</option>)}
            </select>
          </label>

          <div className="reno-cases-page-size">
            <label htmlFor="renoappCasesPageSize">
              Rader/sida
            </label>
            <select
              id="renoappCasesPageSize"
              value={pageSize}
              onChange={(event) => setPageSize(Number(event.target.value))}
              className="reno-field min-h-11 border bg-white px-2 py-1.5"
            >
              {PAGE_SIZE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>

          <div className="reno-cases-sort">
            <label htmlFor="renoappCasesSort">Sortera</label>
            <div className="flex min-w-0 items-center gap-2">
              <select id="renoappCasesSort" value={sortField} onChange={event => handleSort(event.target.value as SortField)}
                className="reno-field min-h-11 min-w-0 flex-1 border bg-white px-2">
                <option value="status">Status</option>
                <option value="submittedAt">Ansökningsdatum</option>
                <option value="caseNumber">Ärendenummer</option>
                <option value="title">Åtgärd</option>
                <option value="applicant">Sökande</option>
              </select>
              <button type="button" onClick={() => setSortDirection(current => current === 'asc' ? 'desc' : 'asc')}
                className="reno-icon-button" aria-label={sortDirection === 'asc' ? 'Sortera fallande' : 'Sortera stigande'}
                title={sortDirection === 'asc' ? 'Sortera fallande' : 'Sortera stigande'}>
                {sortDirection === 'asc' ? <ArrowUp size={18} aria-hidden="true" /> : <ArrowDown size={18} aria-hidden="true" />}
              </button>
            </div>
          </div>

          {hasActiveFilters ? (
            <button type="button" onClick={resetView} className="reno-cases-reset">
              <RotateCcw size={16} aria-hidden="true" />Rensa filter
            </button>
          ) : null}
        </div>

        {error ? <div role="alert" className="m-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}

        {loading ? (
          <div className="p-5 text-sm text-[var(--reno-muted)]" role="status">Laddar RenoApp-ärenden...</div>
        ) : totalItems === 0 ? (
          <div className="p-5 text-sm text-[var(--reno-muted)]" role="status">
            Inga RenoApp-ärenden i denna vy.
          </div>
        ) : (
          <>
            <div className="reno-cases-desktop">
              <table className="reno-cases-table w-full table-fixed text-left text-sm text-[var(--reno-ink)]">
                <colgroup>
                  <col className="w-[185px]" />
                  <col />
                  <col className="w-[185px]" />
                  <col className="w-[155px]" />
                  <col className="w-[145px]" />
                </colgroup>
                <thead>
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
                    <tr
                      key={item.id}
                      tabIndex={0}
                      onClick={() => router.push(`/renoapp/app/cases/${item.id}`)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          router.push(`/renoapp/app/cases/${item.id}`)
                        }
                      }}
                      className="h-14 cursor-pointer border-b border-[var(--reno-line)] bg-white last:border-b-0 hover:bg-[var(--reno-mist)] focus-visible:bg-[var(--reno-mist)] focus:outline-none focus:ring-2 focus:ring-[var(--reno-focus)] focus:ring-inset"
                    >
                      <td className="relative whitespace-nowrap px-4 py-2">
                        <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${getStatusMarkerClass(item.status)}`} />
                        <Link href={`/renoapp/app/cases/${item.id}`} className="whitespace-nowrap tabular-nums text-[var(--reno-ink)]">
                          {item.caseNumber}
                        </Link>
                      </td>
                      <td className="px-4 py-2">
                        <span className="block truncate" title={getActionLabel(item)}>{getActionLabel(item)}</span>
                      </td>
                      <td className="px-4 py-2">
                        <span className="reno-case-status">
                          {getStatusLabel(item.status)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 tabular-nums">{formatDate(item.submittedAt)}</td>
                      <td className="px-4 py-2">
                        <span className="block truncate" title={item.applicant.name ?? undefined}>{item.applicant.name ?? '-'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="reno-cases-mobile" role="list" aria-label="Renoveringsansökningar">
              {pagedRows.map(item => (
                <div key={item.id} role="listitem">
                  <Link href={`/renoapp/app/cases/${item.id}`} className="reno-mobile-case" data-case-number={item.caseNumber}>
                    <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${getStatusMarkerClass(item.status)}`} />
                    <div className="flex items-center justify-between gap-2">
                      <span className="whitespace-nowrap text-sm font-bold tabular-nums">{item.caseNumber}</span>
                      <ChevronRight size={18} className="shrink-0 text-[var(--reno-muted)]" aria-hidden="true" />
                    </div>
                    <p className="mt-2 break-words text-sm font-medium">{getActionLabel(item)}</p>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <span className="reno-case-status">{getStatusLabel(item.status)}</span>
                      <span className="text-xs tabular-nums text-[var(--reno-muted)]">{formatDate(item.submittedAt)}</span>
                    </div>
                    <p className="mt-2 break-words text-sm text-[var(--reno-muted)]">{item.applicant.name ?? '-'}</p>
                  </Link>
                </div>
              ))}
            </div>

            <div className="reno-cases-pagination">
              <p>
                Visar {(safePage - 1) * pageSize + 1}-{Math.min(safePage * pageSize, totalItems)} av {totalItems} ärenden
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCurrentPage((current) => Math.max(1, current - 1))}
                  disabled={safePage <= 1}
                  className="reno-icon-button disabled:opacity-50"
                  aria-label="Föregående sida" title="Föregående sida"
                >
                  <ChevronLeft size={18} aria-hidden="true" />
                </button>
                <span>
                  Sida {safePage} av {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setCurrentPage((current) => Math.min(totalPages, current + 1))}
                  disabled={safePage >= totalPages}
                  className="reno-icon-button disabled:opacity-50"
                  aria-label="Nästa sida" title="Nästa sida"
                >
                  <ChevronRight size={18} aria-hidden="true" />
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      {showStatusHelp ? (
        <dialog
          ref={statusDialog}
          className="reno-review-dialog fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-2xl border border-[var(--reno-line)] bg-white p-0 text-[var(--reno-ink)] backdrop:bg-black/40"
          aria-labelledby="renoapp-status-help-title"
          onClick={() => setShowStatusHelp(false)}
          onCancel={() => setShowStatusHelp(false)}
        >
          <div
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-stone-200 px-5 py-4 sm:px-6">
              <div className="space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">Hjälp</p>
                <h2 id="renoapp-status-help-title" className="text-xl font-semibold tracking-tight text-stone-900">
                  Status i ärendehanteringen
                </h2>
                <p className="max-w-xl text-sm text-stone-600">
                  Här ser du vad varje status betyder och vad styrelsen normalt kan göra i det läget.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowStatusHelp(false)}
                className="reno-icon-button" aria-label="Stäng" title="Stäng"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <div className="px-5 py-4 sm:px-6">
              <div className="grid gap-3">
                {STATUS_HELP_ITEMS.map((item) => (
                  <article key={item.key} className="border-b border-[var(--reno-line)] py-4 last:border-b-0">
                    <h3 className="text-base font-semibold text-stone-900">{item.label}</h3>
                    <p className="mt-2 text-sm leading-6 text-stone-700">{item.meaning}</p>
                    <p className="mt-2 text-sm leading-6 text-stone-600">
                      <span className="font-medium text-stone-800">Det kan du göra:</span> {item.action}
                    </p>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </dialog>
      ) : null}
    </div>
  )
}
