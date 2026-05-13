'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { Archive, ArrowLeft, Ban, ChevronsLeft, Play, Plus } from 'lucide-react'
import Protected from '@/components/Protected'

type AssignmentItem = {
  id: string
  org_id: string
  status: 'draft' | 'sent' | 'ordered' | 'booked' | 'completed' | 'expired' | 'cancelled'
  assignment_type: 'OB' | 'STATUS' | 'UHP' | 'EB'
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
  { key: 'cancelled', label: 'Avbokad' },
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
      return 'Avbokad'
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
      return 'bg-[#F9FAFB] text-black hover:bg-[#F3F4F6] focus-visible:bg-[#F3F4F6]'
    case 'sent':
      return 'bg-[#DBEAFE] text-black hover:bg-[#BFDBFE] focus-visible:bg-[#BFDBFE]'
    case 'ordered':
      return 'bg-[#FEF3C7] text-black hover:bg-[#FDE68A] focus-visible:bg-[#FDE68A]'
    case 'booked':
      return 'bg-[#FFEDD5] text-black hover:bg-[#FED7AA] focus-visible:bg-[#FED7AA]'
    case 'completed':
      return 'bg-[#DCFCE7] text-black hover:bg-[#BBF7D0] focus-visible:bg-[#BBF7D0]'
    case 'cancelled':
      return 'bg-[#FEE2E2] text-black hover:bg-[#FECACA] focus-visible:bg-[#FECACA]'
    default:
      return 'bg-[#E5E7EB] text-black hover:bg-[#D1D5DB] focus-visible:bg-[#D1D5DB]'
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
    case 'sent':
      return {
        inactive: 'border-[#93C5FD] bg-[#DBEAFE] text-[#1E3A8A] hover:bg-[#BFDBFE]',
        active: 'border-[#2563EB] bg-[#2563EB] text-[#FFFFFF]',
        countInactive: 'bg-[#BFDBFE] text-[#1E3A8A]',
        countActive: 'bg-white/20 text-white',
      }
    case 'ordered':
      return {
        inactive: 'border-[#FDE68A] bg-[#FEF3C7] text-[#92400E] hover:bg-[#FDE68A]',
        active: 'border-[#FACC15] bg-[#FACC15] text-[#111827]',
        countInactive: 'bg-[#FDE68A] text-[#92400E]',
        countActive: 'bg-[#EAB308] text-[#111827]',
      }
    case 'booked':
      return {
        inactive: 'border-[#FDBA74] bg-[#FFEDD5] text-[#9A3412] hover:bg-[#FED7AA]',
        active: 'border-[#C2410C] bg-[#C2410C] text-[#FFFFFF]',
        countInactive: 'bg-[#FED7AA] text-[#9A3412]',
        countActive: 'bg-white/20 text-white',
      }
    case 'completed':
      return {
        inactive: 'border-[#86EFAC] bg-[#DCFCE7] text-[#14532D] hover:bg-[#BBF7D0]',
        active: 'border-[#15803D] bg-[#15803D] text-[#FFFFFF]',
        countInactive: 'bg-[#BBF7D0] text-[#14532D]',
        countActive: 'bg-white/20 text-white',
      }
    case 'cancelled':
      return {
        inactive: 'border-[#FCA5A5] bg-[#FEE2E2] text-[#7F1D1D] hover:bg-[#FECACA]',
        active: 'border-[#DC2626] bg-[#DC2626] text-[#FFFFFF]',
        countInactive: 'bg-[#FECACA] text-[#7F1D1D]',
        countActive: 'bg-white/20 text-white',
      }
    case 'expired':
      return {
        inactive: 'border-[#9CA3AF] bg-[#E5E7EB] text-[#374151] hover:bg-[#D1D5DB]',
        active: 'border-[#6B7280] bg-[#6B7280] text-[#FFFFFF]',
        countInactive: 'bg-[#D1D5DB] text-[#374151]',
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
  const [showArchived, setShowArchived] = useState(false)
  const [showExpired, setShowExpired] = useState(false)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [currentPage, setCurrentPage] = useState(1)
  const [actionState, setActionState] = useState<{ id: string; type: 'archive' | 'cancel' | 'convert' } | null>(
    null
  )

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
      if (typeof saved.showArchived === 'boolean') {
        setShowArchived(saved.showArchived)
      } else if (typeof (saved as { showCancelled?: boolean }).showCancelled === 'boolean') {
        setShowArchived(Boolean((saved as { showCancelled?: boolean }).showCancelled))
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
        (item) =>
          (showArchived || !item.archived_at) &&
          (showExpired || item.status !== 'expired')
      ),
    [items, showArchived, showExpired]
  )

  useEffect(() => {
    if (!showExpired && statusFilter === 'expired') {
      setStatusFilter('all')
    }
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

  const isArchived = (item: AssignmentItem) => Boolean(item.archived_at)
  const canArchiveAssignment = (item: AssignmentItem) => {
    if (isArchived(item)) return true
    return !['sent', 'ordered', 'booked'].includes(item.status)
  }

  const canStartInspection = (item: AssignmentItem) =>
    item.status === 'booked' && !item.inspection_id && !item.archived_at

  const canCancelAssignment = (item: AssignmentItem) => item.status !== 'cancelled'

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
      const response = await fetch(`/api/ob/assignments/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          archived_at: nextArchived ? new Date().toISOString() : null,
        }),
      })
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; assignment?: AssignmentItem }
        | null
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Kunde inte uppdatera arkivering.')
      }

      const updated = payload?.assignment
      if (updated) {
        setItems((prev) => prev.map((row) => (row.id === updated.id ? updated : row)))
      } else {
        await loadAssignments()
      }
    } catch (archiveError) {
      setError(
        archiveError instanceof Error
          ? archiveError.message
          : 'Kunde inte uppdatera arkivering.'
      )
    } finally {
      setActionState(null)
    }
  }

  const handleConvertToInspection = async (item: AssignmentItem) => {
    if (!canStartInspection(item)) return
    try {
      setError(null)
      setActionState({ id: item.id, type: 'convert' })
      const response = await fetch(`/api/ob/assignments/${item.id}/convert`, {
        method: 'POST',
      })
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; propertyId?: string; inspectionId?: string }
        | null
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Kunde inte starta besiktning.')
      }
      if (!payload?.propertyId || !payload?.inspectionId) {
        throw new Error('Konvertering saknar property/inspection-id.')
      }
      router.push(`/properties/${payload.propertyId}/ob/${payload.inspectionId}`)
    } catch (convertError) {
      setError(convertError instanceof Error ? convertError.message : 'Kunde inte starta besiktning.')
    } finally {
      setActionState(null)
    }
  }

  const handleCancel = async (item: AssignmentItem) => {
    if (!canCancelAssignment(item)) return
    const confirmed = window.confirm(
      'Är du säker på att du vill avboka uppdragsbekräftelsen och flytta den till arkivet?'
    )
    if (!confirmed) return

    try {
      setError(null)
      setActionState({ id: item.id, type: 'cancel' })
      const response = await fetch(`/api/ob/assignments/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'cancelled',
          archived_at: new Date().toISOString(),
        }),
      })
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; assignment?: AssignmentItem }
        | null
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Kunde inte avboka uppdragsbekräftelse.')
      }

      const updated = payload?.assignment
      if (updated) {
        setItems((prev) => prev.map((row) => (row.id === updated.id ? updated : row)))
      } else {
        await loadAssignments()
      }
    } catch (cancelError) {
      setError(
        cancelError instanceof Error
          ? cancelError.message
          : 'Kunde inte avboka uppdragsbekräftelse.'
      )
    } finally {
      setActionState(null)
    }
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
                <button
                  type="button"
                  onClick={() => router.push('/ob')}
                  aria-label="Till huvudsidan"
                  title="Till huvudsidan"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/50 bg-white/15 text-white transition hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                >
                  <ChevronsLeft size={15} strokeWidth={2.2} />
                </button>
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
                <table className="min-w-full text-left text-sm text-black">
                  <thead className="border-b bg-gray-50 text-xs uppercase text-black">
                    <tr>
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
                          onClick={() => handleSort('status')}
                          className="inline-flex items-center gap-1 font-semibold hover:text-gray-900"
                        >
                          Status <span>{getSortIndicator(sortField === 'status', sortDirection)}</span>
                        </button>
                      </th>
                      <th className="px-3 py-2 text-right font-semibold">Åtgärder</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedRows.map((item) => {
                      const archiveEnabled = canArchiveAssignment(item)
                      const archived = isArchived(item)
                      const convertEnabled = canStartInspection(item)
                      const archiveBusy =
                        actionState?.id === item.id && actionState?.type === 'archive'
                      const cancelEnabled = canCancelAssignment(item)
                      const cancelBusy =
                        actionState?.id === item.id && actionState?.type === 'cancel'
                      const convertBusy =
                        actionState?.id === item.id && actionState?.type === 'convert'
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
                          className={`cursor-pointer border-b last:border-b-0 focus-visible:outline-none ${
                            archived
                              ? 'bg-slate-200 text-slate-900 hover:bg-slate-300 focus-visible:bg-slate-300'
                              : getStatusRowClass(item.status)
                          }`}
                        >
                          <td className="px-3 py-2 align-middle whitespace-nowrap">{formatDate(item.preferred_date)}</td>
                          <td className="px-3 py-2 align-middle whitespace-nowrap">{formatDate(item.created_at)}</td>
                          <td className="px-3 py-2 align-middle">
                            <div>{item.customer_name || '-'}</div>
                          </td>
                          <td className="px-3 py-2 align-middle">{getAddress(item)}</td>
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
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.preventDefault()
                                  event.stopPropagation()
                                  void handleCancel(item)
                                }}
                                disabled={!cancelEnabled || cancelBusy || Boolean(actionState)}
                                title={
                                  cancelEnabled
                                    ? 'Avboka och flytta till arkiverade'
                                    : 'Uppdragsbekräftelsen är redan avbokad'
                                }
                                aria-label="Avboka uppdragsbekräftelse"
                                className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-gray-300 bg-white/95 text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-45"
                              >
                                <Ban size={13} />
                              </button>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.preventDefault()
                                  event.stopPropagation()
                                  void handleArchive(item)
                                }}
                                disabled={!archiveEnabled || archiveBusy || Boolean(actionState)}
                                title={
                                  archiveEnabled
                                    ? archived
                                      ? 'Återför från arkiv'
                                      : 'Arkivera uppdragsbekräftelse'
                                    : 'Skickad, Godkänd och Bokad kan inte arkiveras'
                                }
                                aria-label={
                                  archived
                                    ? 'Återför uppdragsbekräftelse från arkiv'
                                    : 'Arkivera uppdragsbekräftelse'
                                }
                                className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-gray-300 bg-white/95 text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-45"
                              >
                                <Archive size={13} />
                              </button>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.preventDefault()
                                  event.stopPropagation()
                                  void handleConvertToInspection(item)
                                }}
                                disabled={!convertEnabled || convertBusy || Boolean(actionState)}
                                title={
                                  convertEnabled
                                    ? 'Starta besiktning från bokad uppdragsbekräftelse'
                                    : archived
                                      ? 'Återför först från arkiv'
                                      : 'Tillgänglig när status är Bokad'
                                }
                                aria-label="Starta besiktning"
                                className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-gray-300 bg-white/95 text-indigo-700 transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-45"
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
