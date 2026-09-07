'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { CircleHelp } from 'lucide-react'

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

function getStatusBadgeClass(status: CaseItem['status']) {
  switch (getStatusBucket(status)) {
    case 'draft':
      return 'border-stone-300 bg-stone-100 text-stone-800'
    case 'new_application':
      return 'border-violet-300 bg-violet-100 text-violet-950'
    case 'review':
      return 'border-cyan-300 bg-cyan-100 text-cyan-950'
    case 'need_info':
      return 'border-amber-300 bg-amber-100 text-amber-950'
    case 'approved':
      return 'border-emerald-300 bg-emerald-100 text-emerald-950'
    case 'rejected':
      return 'border-rose-300 bg-rose-100 text-rose-950'
    default:
      return 'border-stone-300 bg-stone-100 text-stone-800'
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
        inactive: 'border-gray-300 bg-[#FEFEFE] text-[#111827] hover:bg-[#FBFBFC]',
        active: 'border-gray-400 bg-[#FFFFFF] text-[#111827]',
        countInactive: 'bg-gray-200 text-[#111827]',
        countActive: 'bg-gray-200 text-[#111827]',
      }
    case 'new_application':
      return {
        inactive: 'border-violet-200 bg-violet-50 text-violet-900 hover:bg-violet-100',
        active: 'border-violet-400 bg-violet-100 text-violet-950',
        countInactive: 'bg-violet-100 text-violet-900',
        countActive: 'bg-violet-200 text-violet-950',
      }
    case 'review':
      return {
        inactive: 'border-cyan-200 bg-cyan-50 text-cyan-900 hover:bg-cyan-100',
        active: 'border-cyan-400 bg-cyan-100 text-cyan-950',
        countInactive: 'bg-cyan-100 text-cyan-900',
        countActive: 'bg-cyan-200 text-cyan-950',
      }
    case 'need_info':
      return {
        inactive: 'border-[#F4E6BC] bg-[#FFFDF5] text-[#8D6A23] hover:bg-[#FFF9EC]',
        active: 'border-[#E8D39A] bg-[#FBF3DB] text-[#7D5B16]',
        countInactive: 'bg-[#FCF4DE] text-[#8D6A23]',
        countActive: 'bg-[#F4E8C2] text-[#7D5B16]',
      }
    case 'approved':
      return {
        inactive: 'border-[#D1EAD7] bg-[#F8FDF9] text-[#3D6B4A] hover:bg-[#F0FAF2]',
        active: 'border-[#A4CFB0] bg-[#EEF7F0] text-[#355E41]',
        countInactive: 'bg-[#F0F8F2] text-[#3D6B4A]',
        countActive: 'bg-[#D1EAD7] text-[#355E41]',
      }
    case 'rejected':
      return {
        inactive: 'border-[#EBCFCF] bg-[#FFF8F8] text-[#8A5858] hover:bg-[#FFF0F0]',
        active: 'border-[#D9B0B0] bg-[#F9ECEC] text-[#7B4C4C]',
        countInactive: 'bg-[#FAEEEE] text-[#8A5858]',
        countActive: 'bg-[#EBCFCF] text-[#7B4C4C]',
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
  const router = useRouter()
  const [items, setItems] = useState<CaseItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showStatusHelp, setShowStatusHelp] = useState(false)
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

      const saved = JSON.parse(raw) as Partial<Omit<SavedListView, 'statusFilter'>> & { statusFilter?: StatusFilter | 'conditional' }
      if (typeof saved.search === 'string') setSearch(saved.search)
      if (saved.statusFilter === 'conditional') {
        setStatusFilter('approved')
      } else if (saved.statusFilter && STATUS_TABS.some((tab) => tab.key === saved.statusFilter)) {
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
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-stone-900 sm:text-4xl">Ärendehantering</h1>
      </div>

      <section className="grid gap-3 border-y border-stone-200 bg-white py-3">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="min-w-0 flex-1 sm:max-w-xl">
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Sök på ärendenummer, åtgärd, status eller sökande"
              aria-label="Sök ärenden"
              className="h-10 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-500"
            />
          </div>
          <button
            type="button"
            onClick={() => setShowStatusHelp(true)}
            className="inline-flex min-h-10 max-w-[145px] shrink-0 items-center gap-2 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-left text-xs text-stone-700 transition hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-stone-400 sm:max-w-none sm:text-sm"
          >
            <CircleHelp size={16} className="shrink-0" aria-hidden="true" />
            <span>Vad betyder statusarna?</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {STATUS_TABS.map((tab) => {
            const active = statusFilter === tab.key
            const style = getStatusTabStyle(tab.key)
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setStatusFilter(tab.key)}
                aria-pressed={active}
                className={
                  active
                    ? `inline-flex shrink-0 items-center gap-1 rounded-md border px-3 py-1.5 text-sm font-medium ${style.active}`
                    : `inline-flex shrink-0 items-center gap-1 rounded-md border px-3 py-1.5 text-sm ${style.inactive}`
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

          <div className="flex shrink-0 items-center gap-2 lg:ml-auto">
            <label className="text-xs text-stone-600" htmlFor="renoappCasesPageSize">
              Rader/sida
            </label>
            <select
              id="renoappCasesPageSize"
              value={pageSize}
              onChange={(event) => setPageSize(Number(event.target.value))}
              className="rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-700"
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
                className="rounded-md border border-stone-300 px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50"
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
          <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
            <table className="w-full min-w-[1000px] table-fixed text-left text-sm text-black">
              <colgroup>
                <col className="w-[190px]" />
                <col />
                <col className="w-[200px]" />
                <col className="w-[155px]" />
                <col className="w-[170px]" />
              </colgroup>
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
                    className="h-12 cursor-pointer border-b border-stone-200 bg-white text-black last:border-b-0 hover:bg-stone-50 focus-visible:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-stone-400 focus:ring-inset"
                  >
                    <td className="relative whitespace-nowrap px-4 py-2">
                      <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${getStatusMarkerClass(item.status)}`} />
                      <Link href={`/renoapp/app/cases/${item.id}`} className="whitespace-nowrap font-semibold tabular-nums text-stone-900">
                        {item.caseNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-2">
                      <span className="block truncate" title={getActionLabel(item)}>{getActionLabel(item)}</span>
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold ${getStatusBadgeClass(
                          item.status
                        )}`}
                      >
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

      {showStatusHelp ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-stone-950/40 px-3 py-4 sm:items-center sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="renoapp-status-help-title"
          onClick={() => setShowStatusHelp(false)}
        >
          <div
            className="max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-[28px] bg-white shadow-[0_24px_80px_-32px_rgba(28,25,23,0.55)]"
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
                className="shrink-0 rounded-full border border-stone-300 px-3 py-1.5 text-sm text-stone-700 transition hover:bg-stone-50"
              >
                Stäng
              </button>
            </div>

            <div className="max-h-[calc(85vh-96px)] overflow-y-auto px-5 py-4 sm:px-6">
              <div className="grid gap-3">
                {STATUS_HELP_ITEMS.map((item) => (
                  <article key={item.key} className="rounded-2xl border border-stone-200 bg-stone-50/70 p-4">
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
        </div>
      ) : null}
    </div>
  )
}
