'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Archive, ArrowLeft, Ban, ChevronsLeft, FileText, Mail, Play, Plus } from 'lucide-react'
import Protected from '@/components/Protected'

type AssignmentItem = {
  id: string
  org_id: string
  status: 'draft' | 'sent' | 'ordered' | 'booked' | 'completed' | 'expired' | 'cancelled'
  assignment_type: 'TU'
  customer_name: string | null
  customer_email: string
  customer_phone: string | null
  preferred_date: string | null
  preferred_time: string | null
  preliminary_address: string | null
  property_address: string | null
  property_postal_code: string | null
  property_city: string | null
  scope_description: string | null
  accepted_at: string | null
  converted_at: string | null
  inspection_id: string | null
  responsible_profile_id: string
  created_at: string
  updated_at: string
  last_sent_at: string | null
  archived_at: string | null
  archived_by: string | null
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
  showArchived: boolean
  showExpired: boolean
}

const STORAGE_KEY = 'tu:assignments:list:view:v1'
const DEFAULT_PAGE_SIZE = 25
const PAGE_SIZE_OPTIONS = [10, 25, 50]
const COLLATOR = new Intl.Collator('sv', { sensitivity: 'base', numeric: true })

const STATUS_TABS: Array<{ key: StatusFilter; label: string }> = [
  { key: 'all', label: 'Alla' },
  { key: 'draft', label: 'Utkast' },
  { key: 'sent', label: 'Skickad' },
  { key: 'ordered', label: 'Godkänd' },
  { key: 'booked', label: 'Bokad' },
  { key: 'completed', label: 'Startad' },
  { key: 'cancelled', label: 'Avbruten' },
  { key: 'expired', label: 'Utgången länk' },
]

function getStatusLabel(status: AssignmentItem['status']) {
  switch (status) {
    case 'ordered':
      return 'Godkänd'
    case 'booked':
      return 'Bokad'
    case 'completed':
      return 'Startad'
    case 'sent':
      return 'Skickad'
    case 'expired':
      return 'Utgången länk'
    case 'cancelled':
      return 'Avbruten'
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
      return 'bg-[#F9FAFB] text-[#111827] hover:bg-[#F3F4F6]'
    case 'sent':
      return 'bg-[#EDE9FE] text-[#111827] hover:bg-[#DDD6FE]'
    case 'ordered':
      return 'bg-[#FEF3C7] text-[#111827] hover:bg-[#FDE68A]'
    case 'booked':
      return 'bg-[#FFEDD5] text-[#111827] hover:bg-[#FED7AA]'
    case 'completed':
      return 'bg-[#DCFCE7] text-[#111827] hover:bg-[#BBF7D0]'
    case 'cancelled':
      return 'bg-[#FEE2E2] text-[#111827] hover:bg-[#FECACA]'
    default:
      return 'bg-[#E5E7EB] text-[#111827] hover:bg-[#D1D5DB]'
  }
}

function getStatusTabClass(key: StatusFilter, active: boolean) {
  if (active) {
    if (key === 'all') return 'border-violet-700 bg-violet-700 text-white'
    if (key === 'ordered') return 'border-amber-500 bg-amber-400 text-amber-950'
    if (key === 'completed') return 'border-emerald-700 bg-emerald-700 text-white'
    if (key === 'cancelled') return 'border-rose-700 bg-rose-700 text-white'
    if (key === 'expired') return 'border-slate-600 bg-slate-600 text-white'
    return 'border-violet-700 bg-violet-700 text-white'
  }
  if (key === 'ordered') return 'border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100'
  if (key === 'completed') return 'border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100'
  if (key === 'cancelled') return 'border-rose-200 bg-rose-50 text-rose-900 hover:bg-rose-100'
  if (key === 'expired') return 'border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200'
  return 'border-violet-200 bg-violet-50 text-violet-900 hover:bg-violet-100'
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

export default function TuAssignmentsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<AssignmentItem[]>([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sortField, setSortField] = useState<SortField>('status')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [showArchived, setShowArchived] = useState(false)
  const [showExpired, setShowExpired] = useState(false)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [currentPage, setCurrentPage] = useState(1)
  const [actionState, setActionState] = useState<{
    id: string
    type: 'archive' | 'cancel' | 'convert' | 'send'
  } | null>(null)

  const loadAssignments = async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await fetch('/api/tu/assignments', { cache: 'no-store' })
      const data = (await response.json().catch(() => ({}))) as Partial<ListResponse> & { error?: string }
      if (!response.ok) throw new Error(data.error ?? 'Kunde inte hämta uppdragsbekräftelser.')
      setItems(data.items ?? [])
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Kunde inte hämta uppdragsbekräftelser.')
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
      if (typeof saved.showArchived === 'boolean') setShowArchived(saved.showArchived)
      if (typeof saved.showExpired === 'boolean') setShowExpired(saved.showExpired)
    } catch {
      // Ignore malformed localStorage payloads.
    }
  }, [])

  useEffect(() => {
    const payload: SavedListView = {
      search,
      statusFilter,
      sortField,
      sortDirection,
      pageSize,
      showArchived,
      showExpired,
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  }, [search, statusFilter, sortField, sortDirection, pageSize, showArchived, showExpired])

  useEffect(() => {
    setCurrentPage(1)
  }, [search, statusFilter, sortField, sortDirection, pageSize, showArchived, showExpired])

  const visibleItems = useMemo(
    () =>
      items.filter(
        (item) => (showArchived || !item.archived_at) && (showExpired || item.status !== 'expired')
      ),
    [items, showArchived, showExpired]
  )

  useEffect(() => {
    if (!showExpired && statusFilter === 'expired') setStatusFilter('all')
  }, [showExpired, statusFilter])

  const statusTabs = useMemo(
    () => STATUS_TABS.filter((tab) => !(tab.key === 'expired' && !showExpired)),
    [showExpired]
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
    for (const item of visibleItems) counts[getStatusBucket(item.status)] += 1
    return counts
  }, [visibleItems])

  const filteredAndSorted = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = visibleItems.filter((item) => {
      if (statusFilter !== 'all' && getStatusBucket(item.status) !== statusFilter) return false
      if (!q) return true
      const searchable = [
        item.customer_name ?? '',
        item.customer_email ?? '',
        item.customer_phone ?? '',
        item.scope_description ?? '',
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
        if (comparison === 0) comparison = new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
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
    if (currentPage !== safePage) setCurrentPage(safePage)
  }, [currentPage, safePage])

  const hasActiveFilters =
    search.trim().length > 0 ||
    statusFilter !== 'all' ||
    sortField !== 'status' ||
    sortDirection !== 'asc' ||
    pageSize !== DEFAULT_PAGE_SIZE ||
    showArchived ||
    showExpired

  const resetView = () => {
    setSearch('')
    setStatusFilter('all')
    setSortField('status')
    setSortDirection('asc')
    setPageSize(DEFAULT_PAGE_SIZE)
    setShowArchived(false)
    setShowExpired(false)
    setCurrentPage(1)
  }

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortField(field)
    setSortDirection(field === 'status' ? 'asc' : 'desc')
  }

  const isArchived = (item: AssignmentItem) => Boolean(item.archived_at)
  const canArchiveAssignment = (item: AssignmentItem) => {
    if (isArchived(item)) return true
    return !['sent', 'ordered', 'booked'].includes(item.status)
  }
  const canStartInvestigation = (item: AssignmentItem) =>
    item.status === 'ordered' && !item.inspection_id && !item.archived_at
  const canSend = (item: AssignmentItem) =>
    !item.archived_at && (item.status === 'draft' || item.status === 'sent')
  const canCancelAssignment = (item: AssignmentItem) => item.status !== 'cancelled'

  const updateRow = (updated: AssignmentItem) => {
    setItems((prev) => prev.map((row) => (row.id === updated.id ? updated : row)))
  }

  const handleSend = async (item: AssignmentItem) => {
    if (!canSend(item)) return
    try {
      setError(null)
      setActionState({ id: item.id, type: 'send' })
      const response = await fetch(`/api/tu/assignments/${item.id}/send`, { method: 'POST' })
      const payload = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) throw new Error(payload.error ?? 'Kunde inte skicka uppdragsbekräftelse.')
      await loadAssignments()
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Kunde inte skicka uppdragsbekräftelse.')
    } finally {
      setActionState(null)
    }
  }

  const handleArchive = async (item: AssignmentItem) => {
    const nextArchived = !isArchived(item)
    const confirmed = window.confirm(
      nextArchived
        ? 'Är du säker på att du vill arkivera uppdragsbekräftelsen?'
        : 'Vill du återföra uppdragsbekräftelsen från arkivet?'
    )
    if (!confirmed) return

    try {
      setError(null)
      setActionState({ id: item.id, type: 'archive' })
      const response = await fetch(`/api/tu/assignments/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived_at: nextArchived ? new Date().toISOString() : null }),
      })
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; assignment?: AssignmentItem }
        | null
      if (!response.ok) throw new Error(payload?.error ?? 'Kunde inte uppdatera arkivering.')
      if (payload?.assignment) updateRow(payload.assignment)
      else await loadAssignments()
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : 'Kunde inte uppdatera arkivering.')
    } finally {
      setActionState(null)
    }
  }

  const handleCancel = async (item: AssignmentItem) => {
    if (!canCancelAssignment(item)) return
    const confirmed = window.confirm(
      'Är du säker på att du vill avbryta uppdragsbekräftelsen och flytta den till arkivet?'
    )
    if (!confirmed) return

    try {
      setError(null)
      setActionState({ id: item.id, type: 'cancel' })
      const response = await fetch(`/api/tu/assignments/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled', archived_at: new Date().toISOString() }),
      })
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; assignment?: AssignmentItem }
        | null
      if (!response.ok) throw new Error(payload?.error ?? 'Kunde inte avbryta uppdragsbekräftelse.')
      if (payload?.assignment) updateRow(payload.assignment)
      else await loadAssignments()
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : 'Kunde inte avbryta uppdragsbekräftelse.')
    } finally {
      setActionState(null)
    }
  }

  const handleConvertToInvestigation = async (item: AssignmentItem) => {
    if (!canStartInvestigation(item)) return
    try {
      setError(null)
      setActionState({ id: item.id, type: 'convert' })
      const response = await fetch(`/api/tu/assignments/${item.id}/convert`, { method: 'POST' })
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; inspectionId?: string }
        | null
      if (!response.ok) throw new Error(payload?.error ?? 'Kunde inte starta utredning.')
      if (!payload?.inspectionId) throw new Error('Konverteringen saknar utrednings-id.')
      router.push(`/tu/investigations/${payload.inspectionId}`)
    } catch (convertError) {
      setError(convertError instanceof Error ? convertError.message : 'Kunde inte starta utredning.')
    } finally {
      setActionState(null)
    }
  }

  return (
    <Protected>
      <main className="relative min-h-full overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0"
          style={{ backgroundImage: 'linear-gradient(135deg, #fbf7ff 0%, #ffffff 52%, #f6f0ff 100%)' }}
        />

        <div className="relative mx-auto w-full max-w-7xl space-y-4 p-4 md:p-6">
          <header className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm backdrop-blur-sm md:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => router.push('/tu')}
                  aria-label="Till huvudsidan"
                  title="Till huvudsidan"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
                >
                  <ChevronsLeft size={15} strokeWidth={2.2} />
                </button>
                <button
                  type="button"
                  onClick={() => router.push('/tu')}
                  aria-label="Tillbaka"
                  title="Tillbaka"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
                >
                  <ArrowLeft size={16} strokeWidth={2} />
                </button>
                <h1 className="text-2xl font-semibold text-slate-950">Uppdragsbekräftelser</h1>
              </div>

              <button
                type="button"
                onClick={() => router.push('/tu')}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm font-medium text-violet-800 transition hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 sm:w-auto"
              >
                <Plus size={14} strokeWidth={2.3} />
                Ny uppdragsbekräftelse
              </button>
            </div>
          </header>

          <section className="rounded-xl border border-white/30 bg-white/90 p-2 shadow-sm backdrop-blur md:p-3">
            <div className="flex items-center gap-1 overflow-x-auto whitespace-nowrap pb-0.5">
              <div className="w-[230px] shrink-0">
                <input
                  type="text"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Sök på adress, kund, mejl eller omfattning"
                  className="w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-[11px] text-gray-900 placeholder:text-gray-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                />
              </div>

              {statusTabs.map((tab) => {
                const active = statusFilter === tab.key
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setStatusFilter(tab.key)}
                    className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium ${getStatusTabClass(tab.key, active)}`}
                  >
                    <span>{tab.label}</span>
                    <span className={active ? 'rounded-full bg-white/20 px-1.5 text-[10px]' : 'rounded-full bg-white/70 px-1.5 text-[10px]'}>
                      {statusCounts[tab.key]}
                    </span>
                  </button>
                )
              })}

              <div className="ml-auto flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowArchived((prev) => !prev)}
                  className={
                    showArchived
                      ? 'rounded-md border border-rose-400 bg-rose-100 px-2 py-0.5 text-[11px] text-rose-900'
                      : 'rounded-md border border-gray-300 bg-white px-2 py-0.5 text-[11px] text-gray-700 hover:bg-gray-50'
                  }
                >
                  {showArchived ? 'Dölj arkiverade' : 'Visa arkiverade'}
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
                <label className="text-[10px] text-gray-600" htmlFor="tuAssignmentsPageSize">
                  Rader/sida
                </label>
                <select
                  id="tuAssignmentsPageSize"
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

          {loading ? <div className="text-sm text-violet-900">Laddar uppdragsbekräftelser...</div> : null}
          {error && !loading ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>
          ) : null}
          {!loading && totalItems === 0 ? (
            <div className="rounded-md border border-dashed border-violet-200 bg-white/75 p-4 text-sm text-gray-700">
              Inga uppdragsbekräftelser i denna vy.
            </div>
          ) : null}

          {!loading && totalItems > 0 ? (
            <>
              <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
                <table className="min-w-full text-left text-sm text-gray-900">
                  <thead className="border-b bg-gray-50 text-xs uppercase text-gray-700">
                    <tr>
                      <SortableTh label="Utredningsdag" field="preferred_date" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                      <SortableTh label="Skapad" field="created" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                      <SortableTh label="Kund" field="customer" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                      <SortableTh label="Adress" field="address" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                      <th className="px-3 py-2 font-semibold">Omfattning</th>
                      <SortableTh label="Status" field="status" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                      <th className="px-3 py-2 text-right font-semibold">Åtgärder</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedRows.map((item) => {
                      const archived = isArchived(item)
                      const archiveEnabled = canArchiveAssignment(item)
                      const sendEnabled = canSend(item)
                      const convertEnabled = canStartInvestigation(item)
                      const cancelEnabled = canCancelAssignment(item)
                      return (
                        <tr
                          key={item.id}
                          className={`border-b last:border-b-0 ${
                            archived
                              ? 'bg-slate-200 text-slate-900 hover:bg-slate-300'
                              : getStatusRowClass(item.status)
                          }`}
                        >
                          <td className="px-3 py-2 align-middle whitespace-nowrap">{formatDate(item.preferred_date)}</td>
                          <td className="px-3 py-2 align-middle whitespace-nowrap">{formatDate(item.created_at)}</td>
                          <td className="px-3 py-2 align-middle">
                            <div className="font-medium">{item.customer_name || '-'}</div>
                            <div className="text-xs text-gray-600">{item.customer_email}</div>
                          </td>
                          <td className="px-3 py-2 align-middle">{getAddress(item)}</td>
                          <td className="max-w-[280px] px-3 py-2 align-middle">
                            <div className="line-clamp-2 text-xs leading-5">{item.scope_description || '-'}</div>
                          </td>
                          <td className="px-3 py-2 align-middle whitespace-nowrap font-medium">
                            <div className="flex items-center gap-2">
                              <span>{getStatusLabel(item.status)}</span>
                              {archived ? (
                                <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                                  Arkiverad
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-3 py-2 align-middle whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1">
                              {item.inspection_id ? (
                                <button
                                  type="button"
                                  onClick={() => router.push(`/tu/investigations/${item.inspection_id}`)}
                                  title="Öppna utredning"
                                  aria-label="Öppna utredning"
                                  className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-gray-300 bg-white/95 text-violet-700 transition hover:bg-violet-50"
                                >
                                  <FileText size={13} />
                                </button>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => void handleSend(item)}
                                disabled={!sendEnabled || Boolean(actionState)}
                                title={sendEnabled ? 'Skicka uppdragsbekräftelse' : 'Kan inte skickas i denna status'}
                                aria-label="Skicka uppdragsbekräftelse"
                                className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-gray-300 bg-white/95 text-violet-700 transition hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-45"
                              >
                                <Mail size={13} />
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleCancel(item)}
                                disabled={!cancelEnabled || Boolean(actionState)}
                                title={cancelEnabled ? 'Avbryt och flytta till arkiv' : 'Uppdraget är redan avbrutet'}
                                aria-label="Avbryt uppdragsbekräftelse"
                                className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-gray-300 bg-white/95 text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-45"
                              >
                                <Ban size={13} />
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleArchive(item)}
                                disabled={!archiveEnabled || Boolean(actionState)}
                                title={
                                  archiveEnabled
                                    ? archived
                                      ? 'Återför från arkiv'
                                      : 'Arkivera uppdragsbekräftelse'
                                    : 'Skickad, Godkänd och Bokad kan inte arkiveras'
                                }
                                aria-label={archived ? 'Återför från arkiv' : 'Arkivera uppdragsbekräftelse'}
                                className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-gray-300 bg-white/95 text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-45"
                              >
                                <Archive size={13} />
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleConvertToInvestigation(item)}
                                disabled={!convertEnabled || Boolean(actionState)}
                                title={
                                  convertEnabled
                                    ? 'Starta utredning från godkänd uppdragsbekräftelse'
                                    : archived
                                      ? 'Återför först från arkiv'
                                      : 'Tillgänglig när status är Godkänd'
                                }
                                aria-label="Starta utredning"
                                className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-gray-300 bg-white/95 text-violet-700 transition hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-45"
                              >
                                <Play size={13} />
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
    </Protected>
  )
}

function SortableTh({
  label,
  field,
  sortField,
  sortDirection,
  onSort,
}: {
  label: string
  field: SortField
  sortField: SortField
  sortDirection: SortDirection
  onSort: (field: SortField) => void
}) {
  return (
    <th className="px-3 py-2">
      <button
        type="button"
        onClick={() => onSort(field)}
        className="inline-flex items-center gap-1 font-semibold hover:text-gray-900"
      >
        {label} <span>{getSortIndicator(sortField === field, sortDirection)}</span>
      </button>
    </th>
  )
}
