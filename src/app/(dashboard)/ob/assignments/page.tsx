'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Loader2, Plus, Trash2 } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import Protected from '@/components/Protected'
import DeleteConfirmOverlay from '@/components/ui/DeleteConfirmOverlay'

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
}

type ToastState = { kind: 'success' | 'error'; message: string }

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
  { key: 'completed', label: 'Avklarad' },
  { key: 'cancelled', label: 'Makulerad' },
  { key: 'expired', label: 'Utgången' },
]

function getStatusLabel(status: AssignmentItem['status']) {
  switch (status) {
    case 'ordered':
      return 'Godkänd'
    case 'booked':
      return 'Bokad'
    case 'completed':
      return 'Avklarad'
    case 'sent':
      return 'Skickad'
    case 'expired':
      return 'Utgången'
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
      return 'bg-amber-50/60 hover:bg-amber-100/70 focus-visible:bg-amber-100/80'
    case 'sent':
      return 'bg-indigo-50/60 hover:bg-indigo-100/70 focus-visible:bg-indigo-100/80'
    case 'ordered':
      return 'bg-violet-50/60 hover:bg-violet-100/70 focus-visible:bg-violet-100/80'
    case 'booked':
      return 'bg-emerald-50/60 hover:bg-emerald-100/70 focus-visible:bg-emerald-100/80'
    case 'completed':
      return 'bg-sky-50/60 hover:bg-sky-100/70 focus-visible:bg-sky-100/80'
    case 'cancelled':
      return 'bg-rose-50/60 hover:bg-rose-100/70 focus-visible:bg-rose-100/80'
    default:
      return 'bg-slate-50/60 hover:bg-slate-100/70 focus-visible:bg-slate-100/80'
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
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [currentPage, setCurrentPage] = useState(1)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)

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
      if (
        saved.sortField &&
        ['status', 'created', 'customer', 'address', 'preferred_date'].includes(saved.sortField)
      ) {
        setSortField(saved.sortField as SortField)
      }
      if (saved.sortDirection === 'asc' || saved.sortDirection === 'desc') {
        setSortDirection(saved.sortDirection)
      }
      if (typeof saved.pageSize === 'number' && PAGE_SIZE_OPTIONS.includes(saved.pageSize)) {
        setPageSize(saved.pageSize)
      }
      if (typeof saved.showCancelled === 'boolean') {
        setShowCancelled(saved.showCancelled)
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
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  }, [search, statusFilter, sortField, sortDirection, pageSize, showCancelled])

  useEffect(() => {
    setCurrentPage(1)
  }, [search, statusFilter, sortField, sortDirection, pageSize, showCancelled])

  const visibleItems = useMemo(
    () => items.filter((item) => showCancelled || item.status !== 'cancelled'),
    [items, showCancelled]
  )

  useEffect(() => {
    if (!showCancelled && statusFilter === 'cancelled') {
      setStatusFilter('all')
    }
  }, [showCancelled, statusFilter])

  const statusTabs = useMemo(
    () => (showCancelled ? STATUS_TABS : STATUS_TABS.filter((tab) => tab.key !== 'cancelled')),
    [showCancelled]
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
    showCancelled

  const resetView = () => {
    setSearch('')
    setStatusFilter('all')
    setSortField('status')
    setSortDirection('asc')
    setPageSize(DEFAULT_PAGE_SIZE)
    setShowCancelled(false)
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

  const handleDelete = async (id: string) => {
    try {
      setBusyId(id)
      setError(null)
      const response = await fetch(`/api/ob/assignments/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      })
      const body = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) {
        throw new Error(body.error ?? 'Kunde inte radera uppdragsbekräftelsen.')
      }
      await loadAssignments()
    } catch (deleteError) {
      const message =
        deleteError instanceof Error
          ? deleteError.message
          : 'Kunde inte radera uppdragsbekräftelsen.'
      setError(message)
      throw new Error(message)
    } finally {
      setBusyId(null)
    }
  }

  const handleDeleteConfirm = async () => {
    if (!deleteTargetId) return
    await handleDelete(deleteTargetId)
  }

  const openAssignment = (assignmentId: string) => {
    router.push(`/ob/assignments/${assignmentId}`)
  }

  const activeDeleteTarget = useMemo(
    () => items.find((item) => item.id === deleteTargetId) ?? null,
    [deleteTargetId, items]
  )

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 3200)
    return () => window.clearTimeout(timer)
  }, [toast])

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
                  className="inline-flex items-center rounded-md border border-white/40 bg-white/10 px-2 py-1 transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
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
                  aria-label="Skapa tom uppdragsbekräftelse"
                  title="Skapa tom uppdragsbekräftelse"
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/50 bg-white/15 text-white transition hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                >
                  <Plus size={16} strokeWidth={2.2} />
                </button>
              </div>
            </div>
          </header>

          <section className="rounded-xl border border-white/30 bg-white/90 p-2 shadow-sm backdrop-blur md:p-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="min-w-[165px] flex-1 lg:w-[270px] lg:flex-none">
                <input
                  type="text"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Sök på adress, kund, mejl eller status"
                  className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-900 placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              {statusTabs.map((tab) => {
                const active = statusFilter === tab.key
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setStatusFilter(tab.key)}
                    className={
                      active
                        ? 'inline-flex items-center gap-1.5 rounded-md border border-indigo-600 bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white'
                        : 'inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50'
                    }
                  >
                    <span>{tab.label}</span>
                    <span
                      className={
                        active
                          ? 'rounded-full bg-white/20 px-1.5 py-0.5 text-[10px] text-white'
                          : 'rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600'
                      }
                    >
                      {statusCounts[tab.key]}
                    </span>
                  </button>
                )
              })}

              <div className="ml-auto flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setShowCancelled((prev) => !prev)}
                  className={
                    showCancelled
                      ? 'rounded-md border border-rose-300 bg-rose-50 px-2.5 py-1 text-xs text-rose-700'
                      : 'rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50'
                  }
                >
                  {showCancelled ? 'Dölj makulerade' : 'Visa makulerade'}
                </button>
                <label className="text-[10px] text-gray-600" htmlFor="assignmentsPageSize">
                  Rader/sida
                </label>
                <select
                  id="assignmentsPageSize"
                  value={pageSize}
                  onChange={(event) => setPageSize(Number(event.target.value))}
                  className="rounded-md border border-gray-300 bg-white px-1.5 py-0.5 text-xs text-gray-700"
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
                    className="rounded-md border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50"
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
                      <th className="px-3 py-2 text-right">Åtgärder</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedRows.map((item) => {
                      const isBusy = busyId === item.id

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
                          <td className="px-3 py-2 align-top whitespace-nowrap">{formatDate(item.created_at)}</td>
                          <td className="px-3 py-2 align-top">
                            <div className="text-gray-900">{item.customer_name || '-'}</div>
                          </td>
                          <td className="px-3 py-2 align-top text-gray-900">{getAddress(item)}</td>
                          <td className="px-3 py-2 align-top whitespace-nowrap">{formatDate(item.preferred_date)}</td>
                          <td className="px-3 py-2 align-top">
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  setDeleteTargetId(item.id)
                                }}
                                disabled={isBusy}
                                aria-label="Radera"
                                title="Radera"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-rose-300 bg-rose-50 text-rose-700 transition hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {isBusy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                              </button>
                            </div>
                          </td>
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
      <DeleteConfirmOverlay
        open={Boolean(deleteTargetId)}
        targetLabel="Uppdragsbekräftelse"
        targetDetails={
          activeDeleteTarget
            ? `${activeDeleteTarget.customer_name ?? activeDeleteTarget.customer_email} • ${formatDate(activeDeleteTarget.created_at)}`
            : undefined
        }
        onClose={() => setDeleteTargetId(null)}
        onExecute={handleDeleteConfirm}
        onSuccess={() => setToast({ kind: 'success', message: 'Uppdragsbekräftelsen har makulerats.' })}
        onError={(message) => setToast({ kind: 'error', message })}
        abortLabel="Avbryt"
        executeLabel="Makulera"
      />
      {toast ? (
        <div className="pointer-events-none fixed bottom-4 right-4 z-[95] w-[min(92vw,360px)]">
          <div
            className={`rounded-lg border px-3 py-2 text-sm shadow-xl ${
              toast.kind === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-rose-200 bg-rose-50 text-rose-700'
            }`}
          >
            {toast.message}
          </div>
        </div>
      ) : null}
    </Protected>
  )
}
