'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Plus } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import Protected from '@/components/Protected'

type AssignmentItem = {
  id: string
  org_id: string
  status: 'draft' | 'sent' | 'ordered' | 'booked' | 'completed' | 'expired' | 'cancelled'
  assignment_type: 'OB' | 'STATUS' | 'UHP'
  customer_name: string | null
  customer_email: string
  customer_phone: string | null
  preferred_date: string | null
  preferred_time: string | null
  preliminary_address: string | null
  property_address: string | null
  property_postal_code: string | null
  property_city: string | null
  accepted_at: string | null
  converted_at: string | null
  inspection_id: string | null
  responsible_profile_id: string
  created_at: string
  updated_at: string
  last_sent_at: string | null
}

type ListResponse = {
  items: AssignmentItem[]
}

type StatusFilter =
  | 'all'
  | 'draft'
  | 'sent'
  | 'ordered'
  | 'booked'
  | 'completed'
  | 'expired'
  | 'cancelled'
type SortField = 'status' | 'created' | 'customer' | 'address' | 'preferred_date'
type SortDirection = 'asc' | 'desc'

type SavedListView = {
  search: string
  statusFilter: StatusFilter
  sortField: SortField
  sortDirection: SortDirection
  pageSize: number
  showCancelled: boolean
  showExpired: boolean
}

const STORAGE_KEY = 'ob:assignments:list:view:v1'
const DEFAULT_PAGE_SIZE = 25
const PAGE_SIZE_OPTIONS = [10, 25, 50]
const COLLATOR = new Intl.Collator('sv', { sensitivity: 'base', numeric: true })

const STATUS_TABS: Array<{ key: StatusFilter; label: string }> = [
  { key: 'all', label: 'Alla' },
  { key: 'draft', label: 'Utkast' },
  { key: 'sent', label: 'Skickad' },
  { key: 'ordered', label: 'Godkänd' },
  { key: 'booked', label: 'Bokad' },
  { key: 'completed', label: 'Klar' },
  { key: 'cancelled', label: 'Makulerad' },
  { key: 'expired', label: 'Utgången länk' },
]

function getStatusLabel(status: AssignmentItem['status']) {
  switch (status) {
    case 'ordered':
      return 'Godkänd'
    case 'booked':
      return 'Bokad'
    case 'completed':
      return 'Klar'
    case 'sent':
      return 'Skickad'
    case 'expired':
      return 'Utgången länk'
    case 'cancelled':
      return 'Makulerad'
    default:
      return 'Utkast'
  }
}

function getStatusBucket(status: AssignmentItem['status']): StatusFilter {
  if (status === 'cancelled') return 'cancelled'
  if (status === 'draft') return 'draft'
  if (status === 'sent') return 'sent'
  if (status === 'ordered') return 'ordered'
  if (status === 'booked') return 'booked'
  if (status === 'completed') return 'completed'
  return 'expired'
}

function getStatusSortRank(status: AssignmentItem['status']) {
  switch (status) {
    case 'draft':
      return 0
    case 'sent':
      return 1
    case 'ordered':
      return 2
    case 'booked':
      return 3
    case 'completed':
      return 4
    case 'cancelled':
      return 5
    default:
      return 6
  }
}

function getStatusRowClass(status: AssignmentItem['status']) {
  switch (status) {
    case 'draft':
      return 'bg-amber-200/65 hover:bg-amber-300/75 focus-visible:bg-amber-300/85'
    case 'sent':
      return 'bg-sky-200/65 hover:bg-sky-300/75 focus-visible:bg-sky-300/85'
    case 'ordered':
      return 'bg-violet-200/65 hover:bg-violet-300/75 focus-visible:bg-violet-300/85'
    case 'booked':
      return 'bg-blue-200/65 hover:bg-blue-300/75 focus-visible:bg-blue-300/85'
    case 'completed':
      return 'bg-emerald-200/65 hover:bg-emerald-300/75 focus-visible:bg-emerald-300/85'
    case 'cancelled':
      return 'bg-rose-200/65 hover:bg-rose-300/75 focus-visible:bg-rose-300/85'
    default:
      return 'bg-slate-300/55 hover:bg-slate-300/70 focus-visible:bg-slate-300/80'
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
        inactive: 'border-amber-300 bg-amber-100 text-amber-900 hover:bg-amber-200',
        active: 'border-amber-700 bg-amber-700 text-white',
        countInactive: 'bg-amber-200 text-amber-900',
        countActive: 'bg-white/20 text-white',
      }
    case 'sent':
      return {
        inactive: 'border-sky-300 bg-sky-100 text-sky-900 hover:bg-sky-200',
        active: 'border-sky-700 bg-sky-700 text-white',
        countInactive: 'bg-sky-200 text-sky-900',
        countActive: 'bg-white/20 text-white',
      }
    case 'ordered':
      return {
        inactive: 'border-violet-300 bg-violet-100 text-violet-900 hover:bg-violet-200',
        active: 'border-violet-700 bg-violet-700 text-white',
        countInactive: 'bg-violet-200 text-violet-900',
        countActive: 'bg-white/20 text-white',
      }
    case 'booked':
      return {
        inactive: 'border-blue-300 bg-blue-100 text-blue-900 hover:bg-blue-200',
        active: 'border-blue-700 bg-blue-700 text-white',
        countInactive: 'bg-blue-200 text-blue-900',
        countActive: 'bg-white/20 text-white',
      }
    case 'completed':
      return {
        inactive: 'border-emerald-300 bg-emerald-100 text-emerald-900 hover:bg-emerald-200',
        active: 'border-emerald-700 bg-emerald-700 text-white',
        countInactive: 'bg-emerald-200 text-emerald-900',
        countActive: 'bg-white/20 text-white',
      }
    case 'cancelled':
      return {
        inactive: 'border-rose-300 bg-rose-100 text-rose-900 hover:bg-rose-200',
        active: 'border-rose-700 bg-rose-700 text-white',
        countInactive: 'bg-rose-200 text-rose-900',
        countActive: 'bg-white/20 text-white',
      }
    case 'expired':
      return {
        inactive: 'border-slate-400 bg-slate-200 text-slate-900 hover:bg-slate-300',
        active: 'border-slate-700 bg-slate-700 text-white',
        countInactive: 'bg-slate-300 text-slate-900',
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

function getAddress(item: AssignmentItem) {
  const line = item.property_address ?? item.preliminary_address
  const postalCity = [item.property_postal_code, item.property_city].filter(Boolean).join(' ')
  return [line, postalCity].filter(Boolean).join(', ') || 'Adress saknas'
}

function formatDate(raw: string | null) {
  if (!raw) return '-'
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  return date.toLocaleDateString('sv-SE')
}

function getSortIndicator(active: boolean, direction: SortDirection) {
  if (!active) return '↕'
  return direction === 'asc' ? '↑' : '↓'
}

export default function ObAssignmentsPage() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<AssignmentItem[]>([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sortField, setSortField] = useState<SortField>('status')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [showCancelled, setShowCancelled] = useState(false)
  const [showExpired, setShowExpired] = useState(false)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [currentPage, setCurrentPage] = useState(1)

  const loadAssignments = async () => {
    try {
      setLoading(true)
      setError(null)

      const response = await fetch('/api/ob/assignments', { cache: 'no-store' })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? 'Kunde inte hämta uppdrag.')
      }

      const data = (await response.json()) as ListResponse
      setItems(data.items ?? [])
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Kunde inte hämta uppdrag.'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadAssignments()
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
      if (typeof saved.pageSize === 'number' && PAGE_SIZE_OPTIONS.includes(saved.pageSize)) {
        setPageSize(saved.pageSize)
      }
      if (typeof saved.showCancelled === 'boolean') {
        setShowCancelled(saved.showCancelled)
      }
      if (typeof saved.showExpired === 'boolean') {
        setShowExpired(saved.showExpired)
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
      showCancelled,
      showExpired,
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  }, [search, statusFilter, sortField, sortDirection, pageSize, showCancelled, showExpired])

  useEffect(() => {
    setCurrentPage(1)
  }, [search, statusFilter, sortField, sortDirection, pageSize, showCancelled, showExpired])

  const visibleItems = useMemo(
    () =>
      items.filter(
        (item) =>
          (showCancelled || item.status !== 'cancelled') && (showExpired || item.status !== 'expired')
      ),
    [items, showCancelled, showExpired]
  )

  useEffect(() => {
    if (
      (!showCancelled && statusFilter === 'cancelled') ||
      (!showExpired && statusFilter === 'expired')
    ) {
      setStatusFilter('all')
    }
  }, [showCancelled, showExpired, statusFilter])

  const statusTabs = useMemo(
    () =>
      STATUS_TABS.filter((tab) => {
        if (tab.key === 'cancelled' && !showCancelled) return false
        if (tab.key === 'expired' && !showExpired) return false
        return true
      }),
    [showCancelled, showExpired]
  )

  const statusCounts = useMemo(() => {
    const counts: Record<StatusFilter, number> = {
      all: visibleItems.length,
      draft: 0,
      sent: 0,
      ordered: 0,
      booked: 0,
      completed: 0,
      expired: 0,
      cancelled: 0,
    }

    for (const item of visibleItems) {
      counts[getStatusBucket(item.status)] += 1
    }

    return counts
  }, [visibleItems])

  const filteredAndSorted = useMemo(() => {
    const q = search.trim().toLowerCase()

    const filtered = visibleItems.filter((item) => {
      if (statusFilter !== 'all' && getStatusBucket(item.status) !== statusFilter) {
        return false
      }

      if (!q) return true

      const searchable = [
        item.customer_name ?? '',
        item.customer_email ?? '',
        item.customer_phone ?? '',
        getAddress(item),
        getStatusLabel(item.status),
      ]
        .join(' ')
        .toLowerCase()

      return searchable.includes(q)
    })

    return [...filtered].sort((a, b) => {
      let comparison = 0

      if (sortField === 'status') {
        comparison = getStatusSortRank(a.status) - getStatusSortRank(b.status)
        if (comparison === 0) {
          comparison = new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        }
      } else if (sortField === 'created') {
        comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      } else if (sortField === 'preferred_date') {
        const aValue = a.preferred_date ? new Date(a.preferred_date).getTime() : Number.MAX_SAFE_INTEGER
        const bValue = b.preferred_date ? new Date(b.preferred_date).getTime() : Number.MAX_SAFE_INTEGER
        comparison = aValue - bValue
      } else if (sortField === 'address') {
        comparison = COLLATOR.compare(getAddress(a), getAddress(b))
      } else if (sortField === 'customer') {
        comparison = COLLATOR.compare(a.customer_name ?? a.customer_email, b.customer_name ?? b.customer_email)
      }

      return sortDirection === 'asc' ? comparison : -comparison
    })
  }, [visibleItems, search, sortField, sortDirection, statusFilter])

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
    pageSize !== DEFAULT_PAGE_SIZE ||
    showCancelled ||
    showExpired

  const resetView = () => {
    setSearch('')
    setStatusFilter('all')
    setSortField('status')
    setSortDirection('asc')
    setPageSize(DEFAULT_PAGE_SIZE)
    setShowCancelled(false)
    setShowExpired(false)
    setCurrentPage(1)
  }

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
      return
    }

    setSortField(field)
    if (field === 'status') {
      setSortDirection('asc')
      return
    }
    if (field === 'created' || field === 'preferred_date') {
      setSortDirection('desc')
      return
    }
    setSortDirection('asc')
  }

  const openAssignment = (assignmentId: string) => {
    router.push(`/ob/assignments/${assignmentId}`)
  }

  return (
    <Protected>
      <main className="relative min-h-full overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(100% 70% at 50% 0%, rgba(219,234,254,0.5) 0%, rgba(219,234,254,0) 60%), linear-gradient(135deg, #1e3a8a 0%, #1d4ed8 42%, #60a5fa 100%)',
          }}
        />
        <div className="pointer-events-none absolute inset-0 bg-white/10 backdrop-blur-[1px]" />

        <div className="relative mx-auto w-full max-w-7xl space-y-4 p-4 md:p-6">
          <header className="rounded-2xl border border-white/30 bg-white/10 p-4 shadow-sm backdrop-blur-sm md:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-3">
                <Link
                  href="/ob"
                  aria-label="BesiktApp startsida"
                  title="Till BesiktApp"
                  className="inline-flex items-center rounded-sm transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                >
                  <Image
                    src="/report-assets/BesiktApp.png"
                    alt="BesiktApp"
                    width={124}
                    height={28}
                    className="h-7 w-auto object-contain"
                  />
                </Link>
                <button
                  type="button"
                  onClick={() => router.push('/ob')}
                  aria-label="Tillbaka"
                  title="Tillbaka"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/50 bg-white/15 text-white transition hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                >
                  <ArrowLeft size={16} strokeWidth={2} />
                </button>
                <h1 className="text-2xl font-semibold text-white drop-shadow-sm">Uppdragsbekräftelser</h1>
              </div>

              <div className="flex w-full items-center justify-end gap-2 lg:w-auto">
                <button
                  type="button"
                  onClick={() => router.push('/ob/assignments/new')}
                  aria-label="Ny uppdragsbekräftelse"
                  title="Ny uppdragsbekräftelse"
                  className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-white/60 bg-white/15 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                >
                  <Plus size={14} strokeWidth={2.3} />
                  Ny uppdragsbekräftelse
                </button>
              </div>
            </div>
          </header>

          <section className="rounded-xl border border-white/30 bg-white/90 p-2 shadow-sm backdrop-blur md:p-3">
            <div className="flex items-center gap-1 overflow-x-auto whitespace-nowrap pb-0.5">
              <div className="w-[210px] shrink-0">
                <input
                  type="text"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Sök på adress, kund, mejl eller status"
                  className="w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-[11px] text-gray-900 placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              {statusTabs.map((tab) => {
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
                <button
                  type="button"
                  onClick={() => setShowCancelled((prev) => !prev)}
                  className={
                    showCancelled
                      ? 'rounded-md border border-rose-400 bg-rose-100 px-2 py-0.5 text-[11px] text-rose-900'
                      : 'rounded-md border border-gray-300 bg-white px-2 py-0.5 text-[11px] text-gray-700 hover:bg-gray-50'
                  }
                >
                  {showCancelled ? 'Dölj makulerade' : 'Visa makulerade'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowExpired((prev) => !prev)}
                  className={
                    showExpired
                      ? 'rounded-md border border-slate-500 bg-slate-200 px-2 py-0.5 text-[11px] text-slate-900'
                      : 'rounded-md border border-gray-300 bg-white px-2 py-0.5 text-[11px] text-gray-700 hover:bg-gray-50'
                  }
                >
                  {showExpired ? 'Dölj utgången länk' : 'Visa utgången länk'}
                </button>
                <label className="text-[10px] text-gray-600" htmlFor="assignmentsPageSize">
                  Rader/sida
                </label>
                <select
                  id="assignmentsPageSize"
                  value={pageSize}
                  onChange={(event) => setPageSize(Number(event.target.value))}
                  className="rounded-md border border-gray-300 bg-white px-1.5 py-0.5 text-[11px] text-gray-700"
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
                    className="rounded-md border border-gray-300 px-2 py-0.5 text-[11px] text-gray-700 hover:bg-gray-50"
                  >
                    Rensa filter
                  </button>
                ) : null}
              </div>
            </div>
          </section>

          {loading ? <div className="text-sm text-blue-100">Laddar uppdragsbekräftelser...</div> : null}
          {error && !loading ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>
          ) : null}

          {!loading && totalItems === 0 ? (
            <div className="rounded-md border border-dashed border-white/40 bg-white/75 p-4 text-sm text-gray-700">
              Inga uppdragsbekräftelser i denna vy.
            </div>
          ) : null}

          {!loading && totalItems > 0 ? (
            <>
              <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
                    <tr>
                      <th className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => handleSort('created')}
                          className="inline-flex items-center gap-1 font-semibold hover:text-gray-900"
                        >
                          Skapad <span>{getSortIndicator(sortField === 'created', sortDirection)}</span>
                        </button>
                      </th>
                      <th className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => handleSort('status')}
                          className="inline-flex items-center gap-1 font-semibold hover:text-gray-900"
                        >
                          Status <span>{getSortIndicator(sortField === 'status', sortDirection)}</span>
                        </button>
                      </th>
                      <th className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => handleSort('customer')}
                          className="inline-flex items-center gap-1 font-semibold hover:text-gray-900"
                        >
                          Kund <span>{getSortIndicator(sortField === 'customer', sortDirection)}</span>
                        </button>
                      </th>
                      <th className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => handleSort('address')}
                          className="inline-flex items-center gap-1 font-semibold hover:text-gray-900"
                        >
                          Adress <span>{getSortIndicator(sortField === 'address', sortDirection)}</span>
                        </button>
                      </th>
                      <th className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => handleSort('preferred_date')}
                          className="inline-flex items-center gap-1 font-semibold hover:text-gray-900"
                        >
                          Besiktningsdag{' '}
                          <span>{getSortIndicator(sortField === 'preferred_date', sortDirection)}</span>
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedRows.map((item) => {
                      return (
                        <tr
                          key={item.id}
                          tabIndex={0}
                          role="button"
                          aria-label={`Öppna uppdragsbekräftelse ${item.customer_name ?? item.customer_email}`}
                          onClick={() => openAssignment(item.id)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              openAssignment(item.id)
                            }
                          }}
                          className={`cursor-pointer border-b last:border-b-0 focus-visible:outline-none ${getStatusRowClass(item.status)}`}
                        >
                          <td className="px-3 py-2 align-middle whitespace-nowrap">{formatDate(item.created_at)}</td>
                          <td className="px-3 py-2 align-middle whitespace-nowrap font-medium text-gray-900">
                            {getStatusLabel(item.status)}
                          </td>
                          <td className="px-3 py-2 align-middle">
                            <div className="text-gray-900">{item.customer_name || '-'}</div>
                          </td>
                          <td className="px-3 py-2 align-middle text-gray-900">{getAddress(item)}</td>
                          <td className="px-3 py-2 align-middle whitespace-nowrap">{formatDate(item.preferred_date)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <footer className="flex flex-col items-start justify-between gap-3 rounded-xl border border-white/30 bg-white/85 px-3 py-2 text-sm text-gray-700 md:flex-row md:items-center">
                <div>
                  Sida {safePage} av {totalPages} ({totalItems} totalt)
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                    disabled={safePage <= 1}
                    className="rounded-md border border-gray-300 px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Föregående
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                    disabled={safePage >= totalPages}
                    className="rounded-md border border-gray-300 px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Nästa
                  </button>
                </div>
              </footer>
            </>
          ) : null}
        </div>
      </main>
    </Protected>
  )
}
