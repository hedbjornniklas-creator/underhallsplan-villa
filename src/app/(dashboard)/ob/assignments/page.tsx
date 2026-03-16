'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Loader2, Mail, Plus, Send, Trash2 } from 'lucide-react'
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

type StatusFilter = 'all' | 'draft' | 'sent' | 'ordered' | 'booked' | 'completed' | 'expired'
type SortField = 'date' | 'address' | 'customer' | 'status'
type SortDirection = 'asc' | 'desc'

type SavedListView = {
  search: string
  statusFilter: StatusFilter
  sortField: SortField
  sortDirection: SortDirection
  pageSize: number
}

type ToastState = {
  kind: 'success' | 'error'
  message: string
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const STORAGE_KEY = 'ob:assignments:list:view:v1'
const DEFAULT_PAGE_SIZE = 25
const PAGE_SIZE_OPTIONS = [10, 25, 50]
const COLLATOR = new Intl.Collator('sv', { sensitivity: 'base', numeric: true })

const STATUS_TABS: Array<{ key: StatusFilter; label: string }> = [
  { key: 'all', label: 'Alla' },
  { key: 'draft', label: 'Utkast' },
  { key: 'sent', label: 'Skickade' },
  { key: 'ordered', label: 'Beställda' },
  { key: 'booked', label: 'Bokade' },
  { key: 'completed', label: 'Avklarade' },
  { key: 'expired', label: 'Utgångna' },
]

function getStatusLabel(status: AssignmentItem['status']) {
  switch (status) {
    case 'ordered':
      return 'Beställd'
    case 'booked':
      return 'Bokad'
    case 'completed':
      return 'Avklarad'
    case 'sent':
      return 'Skickad'
    case 'expired':
      return 'Utgången'
    case 'cancelled':
      return 'Avbruten'
    default:
      return 'Utkast'
  }
}

function getStatusBucket(status: AssignmentItem['status']): Exclude<StatusFilter, 'all'> {
  if (status === 'draft') return 'draft'
  if (status === 'sent') return 'sent'
  if (status === 'ordered') return 'ordered'
  if (status === 'booked') return 'booked'
  if (status === 'completed') return 'completed'
  return 'expired'
}

function getStatusBadgeClass(status: AssignmentItem['status']) {
  switch (getStatusBucket(status)) {
    case 'draft':
      return 'border-amber-200 bg-amber-50 text-amber-700'
    case 'sent':
      return 'border-indigo-200 bg-indigo-50 text-indigo-700'
    case 'ordered':
      return 'border-violet-200 bg-violet-50 text-violet-700'
    case 'booked':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700'
    case 'completed':
      return 'border-sky-200 bg-sky-50 text-sky-700'
    default:
      return 'border-slate-200 bg-slate-100 text-slate-700'
  }
}

function getAddress(item: AssignmentItem) {
  const line = item.property_address ?? item.preliminary_address
  const postalCity = [item.property_postal_code, item.property_city].filter(Boolean).join(' ')
  return [line, postalCity].filter(Boolean).join(', ') || 'Adress saknas'
}

function formatDate(item: AssignmentItem) {
  const raw = item.preferred_date ?? item.created_at
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  return date.toLocaleDateString('sv-SE')
}

function formatType(value: AssignmentItem['assignment_type']) {
  if (value === 'OB') return 'ÖB'
  if (value === 'STATUS') return 'Status'
  return 'UHP'
}

function getDateValue(item: AssignmentItem) {
  return new Date(item.preferred_date ?? item.created_at).getTime()
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
  const [sortField, setSortField] = useState<SortField>('date')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [currentPage, setCurrentPage] = useState(1)
  const [quickEmail, setQuickEmail] = useState('')
  const [quickSending, setQuickSending] = useState(false)
  const [quickError, setQuickError] = useState<string | null>(null)
  const [quickSuccess, setQuickSuccess] = useState<string | null>(null)
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
      if (saved.sortField && ['date', 'address', 'customer', 'status'].includes(saved.sortField)) {
        setSortField(saved.sortField as SortField)
      }
      if (saved.sortDirection === 'asc' || saved.sortDirection === 'desc') {
        setSortDirection(saved.sortDirection)
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

  const activeItems = useMemo(() => items.filter((item) => item.status !== 'cancelled'), [items])

  const statusCounts = useMemo(() => {
    const counts: Record<StatusFilter, number> = {
      all: activeItems.length,
      draft: 0,
      sent: 0,
      ordered: 0,
      booked: 0,
      completed: 0,
      expired: 0,
    }

    for (const item of activeItems) {
      counts[getStatusBucket(item.status)] += 1
    }

    return counts
  }, [activeItems])

  const filteredAndSorted = useMemo(() => {
    const q = search.trim().toLowerCase()

    const filtered = activeItems.filter((item) => {
      if (statusFilter !== 'all' && getStatusBucket(item.status) !== statusFilter) {
        return false
      }

      if (!q) return true

      const searchable = [
        item.customer_name ?? '',
        item.customer_email ?? '',
        item.customer_phone ?? '',
        getAddress(item),
        formatType(item.assignment_type),
        getStatusLabel(item.status),
      ]
        .join(' ')
        .toLowerCase()

      return searchable.includes(q)
    })

    return [...filtered].sort((a, b) => {
      let comparison = 0

      if (sortField === 'date') {
        comparison = getDateValue(a) - getDateValue(b)
      } else if (sortField === 'address') {
        comparison = COLLATOR.compare(getAddress(a), getAddress(b))
      } else if (sortField === 'customer') {
        comparison = COLLATOR.compare(a.customer_name ?? a.customer_email, b.customer_name ?? b.customer_email)
      } else {
        comparison = COLLATOR.compare(getStatusLabel(a.status), getStatusLabel(b.status))
      }

      return sortDirection === 'asc' ? comparison : -comparison
    })
  }, [activeItems, search, sortField, sortDirection, statusFilter])

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
    sortField !== 'date' ||
    sortDirection !== 'desc' ||
    pageSize !== DEFAULT_PAGE_SIZE

  const resetView = () => {
    setSearch('')
    setStatusFilter('all')
    setSortField('date')
    setSortDirection('desc')
    setPageSize(DEFAULT_PAGE_SIZE)
    setCurrentPage(1)
  }

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
      return
    }

    setSortField(field)
    setSortDirection(field === 'date' ? 'desc' : 'asc')
  }

  const handleQuickSend = async () => {
    const email = quickEmail.trim().toLowerCase()
    if (!EMAIL_REGEX.test(email)) {
      setQuickError('Ange en giltig mejladress.')
      return
    }

    try {
      setQuickSending(true)
      setQuickError(null)
      setQuickSuccess(null)

      const response = await fetch('/api/ob/assignments/quick-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerEmail: email }),
      })

      const body = (await response.json().catch(() => ({}))) as {
        error?: string
        acceptUrl?: string
      }

      if (!response.ok) {
        if (body.acceptUrl) {
          setQuickError(`Mejl kunde inte skickas. Länk skapades: ${body.acceptUrl}`)
        } else {
          setQuickError(body.error ?? 'Kunde inte skapa uppdragsbekräftelse.')
        }
        return
      }

      setQuickSuccess('Uppdragsbekräftelse skickad.')
      setQuickEmail('')
      await loadAssignments()
    } catch (sendError) {
      const message =
        sendError instanceof Error ? sendError.message : 'Kunde inte skapa uppdragsbekräftelse.'
      setQuickError(message)
    } finally {
      setQuickSending(false)
    }
  }

  const handleResend = async (id: string) => {
    try {
      setBusyId(id)
      setError(null)
      const response = await fetch(`/api/ob/assignments/${id}/send`, {
        method: 'POST',
      })
      const body = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) {
        throw new Error(body.error ?? 'Kunde inte skicka om uppdragsbekräftelsen.')
      }
      await loadAssignments()
    } catch (resendError) {
      setError(
        resendError instanceof Error
          ? resendError.message
          : 'Kunde inte skicka om uppdragsbekräftelsen.'
      )
    } finally {
      setBusyId(null)
    }
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

              <div className="flex w-full items-center gap-2 lg:w-auto">
                <div className="relative min-w-[240px] flex-1 lg:w-[360px] lg:flex-none">
                  <Mail
                    size={15}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                  />
                  <input
                    value={quickEmail}
                    onChange={(event) => setQuickEmail(event.target.value)}
                    placeholder="kund@epost.se"
                    className="w-full rounded-lg border border-white/40 bg-white/95 py-2 pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void handleQuickSend()}
                  disabled={quickSending}
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-full border border-white/50 bg-white/15 px-4 text-sm font-medium text-white transition hover:bg-white/25 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {quickSending ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <Send size={15} />
                  )}
                  Skicka uppdragsbekräftelse
                </button>
                <button
                  type="button"
                  onClick={() => router.push('/ob/assignments/new')}
                  disabled={quickSending}
                  aria-label="Skapa tom uppdragsbekräftelse"
                  title="Skapa tom uppdragsbekräftelse"
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/50 bg-white/15 text-white transition hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Plus size={16} strokeWidth={2.2} />
                </button>
              </div>
            </div>
            {quickError ? (
              <p className="mt-3 rounded-md bg-rose-100/95 px-3 py-2 text-sm text-rose-700">{quickError}</p>
            ) : null}
            {quickSuccess ? (
              <p className="mt-3 rounded-md bg-emerald-100/95 px-3 py-2 text-sm text-emerald-700">
                {quickSuccess}
              </p>
            ) : null}
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

              {STATUS_TABS.map((tab) => {
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
                          onClick={() => handleSort('date')}
                          className="inline-flex items-center gap-1 font-semibold hover:text-gray-900"
                        >
                          Datum <span>{getSortIndicator(sortField === 'date', sortDirection)}</span>
                        </button>
                      </th>
                      <th className="px-3 py-2">Typ</th>
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
                          onClick={() => handleSort('status')}
                          className="inline-flex items-center gap-1 font-semibold hover:text-gray-900"
                        >
                          Status <span>{getSortIndicator(sortField === 'status', sortDirection)}</span>
                        </button>
                      </th>
                      <th className="px-3 py-2 text-right">Åtgärder</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedRows.map((item) => {
                      const canResend =
                        item.status === 'draft' || item.status === 'sent' || item.status === 'ordered'
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
                          className="cursor-pointer border-b last:border-b-0 hover:bg-indigo-50/40 focus-visible:bg-indigo-50/50 focus-visible:outline-none"
                        >
                          <td className="px-3 py-2 align-top whitespace-nowrap">{formatDate(item)}</td>
                          <td className="px-3 py-2 align-top">{formatType(item.assignment_type)}</td>
                          <td className="px-3 py-2 align-top">
                            <div className="text-gray-900">{item.customer_name || 'Namn saknas'}</div>
                            <div className="text-xs text-gray-500">{item.customer_email}</div>
                          </td>
                          <td className="px-3 py-2 align-top text-gray-900">{getAddress(item)}</td>
                          <td className="px-3 py-2 align-top">
                            <span
                              className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${getStatusBadgeClass(
                                item.status
                              )}`}
                            >
                              {getStatusLabel(item.status)}
                            </span>
                          </td>
                          <td className="px-3 py-2 align-top">
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  void handleResend(item.id)
                                }}
                                disabled={isBusy || !canResend}
                                aria-label="Skicka igen"
                                title="Skicka igen"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-indigo-300 bg-indigo-50 text-indigo-700 transition hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {isBusy && canResend ? (
                                  <Loader2 size={14} className="animate-spin" />
                                ) : (
                                  <Send size={14} />
                                )}
                              </button>
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
                                <Trash2 size={14} />
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
            ? `${activeDeleteTarget.customer_name ?? activeDeleteTarget.customer_email} • ${formatDate(activeDeleteTarget)}`
            : undefined
        }
        onClose={() => setDeleteTargetId(null)}
        onExecute={handleDeleteConfirm}
        onSuccess={() => setToast({ kind: 'success', message: 'Command executed' })}
        onError={(message) => setToast({ kind: 'error', message })}
        abortLabel="Abort Mission"
        executeLabel="Execute Order"
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
