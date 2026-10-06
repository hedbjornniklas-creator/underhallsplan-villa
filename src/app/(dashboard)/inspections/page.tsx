'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ChevronsLeft, Download, Loader2, LockOpen, Plus } from 'lucide-react'
import Protected from '@/components/Protected'
import ObOrganizationBoundary, { useObOrganization, useObOrganizationSwitchGuard, withObOrganization } from '@/components/ob/ObOrganizationBoundary'

type Inspection = {
  id: string
  property_id: string
  date: string | null
  type: string | null
  status: string | null
  inspector_name: string | null
  created_at: string
  customer_name: string | null
  client_name: string | null
  client_contact: string | null
  assignment_number: string | null
  locked_at: string | null
  locked_by: string | null
}

type Property = {
  id: string
  name: string | null
  address: string | null
  postal_code: string | null
  city: string | null
}

type InspectionWithProperty = Inspection & {
  property?: Property | null
  snapshot?: ObPropertySnapshotLite | null
  hasReadyPdf?: boolean
}

type ObPropertySnapshotLite = {
  inspection_id: string
  address: string | null
  postal_code: string | null
  city: string | null
  client_name: string | null
}

type StatusFilter = 'all' | 'draft' | 'ongoing' | 'completed' | 'archived'
type SortField = 'date' | 'address' | 'customer' | 'status'
type SortDirection = 'asc' | 'desc'

type SavedListView = {
  search: string
  statusFilter: StatusFilter
  sortField: SortField
  sortDirection: SortDirection
  pageSize: number
  showDraft: boolean
  showArchived: boolean
}

const STORAGE_KEY = 'inspections:list:view:v3'
const DEFAULT_PAGE_SIZE = 25
const PAGE_SIZE_OPTIONS = [10, 25, 50]
const COLLATOR = new Intl.Collator('sv', { sensitivity: 'base', numeric: true })

const STATUS_TABS: Array<{ key: StatusFilter; label: string }> = [
  { key: 'all', label: 'Alla' },
  { key: 'draft', label: 'Utkast' },
  { key: 'ongoing', label: 'Pågående' },
  { key: 'completed', label: 'Klar' },
  { key: 'archived', label: 'Arkiverad' },
]

function getStatusBucket(status: string | null): Exclude<StatusFilter, 'all'> {
  const value = status?.trim().toLowerCase() ?? ''

  if (value === 'draft' || value === 'utkast') return 'draft'
  if (value === 'completed' || value === 'klar' || value === 'done') return 'completed'
  if (value === 'archived' || value === 'arkiverad') return 'archived'

  return 'ongoing'
}

function getStatusLabel(status: string | null) {
  switch (getStatusBucket(status)) {
    case 'draft':
      return 'Utkast'
    case 'completed':
      return 'Klar'
    case 'archived':
      return 'Arkiverad'
    default:
      return 'Pågående'
  }
}

function getStatusBadgeClass(status: string | null) {
  switch (getStatusBucket(status)) {
    case 'draft':
      return 'border-amber-200 bg-amber-50 text-amber-700'
    case 'completed':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700'
    case 'archived':
      return 'border-slate-200 bg-slate-100 text-slate-700'
    default:
      return 'border-sky-200 bg-sky-50 text-sky-700'
  }
}

function getStatusRowClass(status: string | null) {
  switch (getStatusBucket(status)) {
    case 'draft':
      return 'bg-[#F9FAFB] text-black hover:bg-[#F3F4F6] focus-visible:bg-[#F3F4F6]'
    case 'completed':
      return 'bg-[#DCFCE7] text-black hover:bg-[#BBF7D0] focus-visible:bg-[#BBF7D0]'
    case 'archived':
      return 'bg-[#E5E7EB] text-black hover:bg-[#D1D5DB] focus-visible:bg-[#D1D5DB]'
    default:
      return 'bg-[#DBEAFE] text-black hover:bg-[#BFDBFE] focus-visible:bg-[#BFDBFE]'
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
    case 'ongoing':
      return {
        inactive: 'border-[#93C5FD] bg-[#DBEAFE] text-[#1E3A8A] hover:bg-[#BFDBFE]',
        active: 'border-[#2563EB] bg-[#2563EB] text-[#FFFFFF]',
        countInactive: 'bg-[#BFDBFE] text-[#1E3A8A]',
        countActive: 'bg-white/20 text-white',
      }
    case 'completed':
      return {
        inactive: 'border-[#86EFAC] bg-[#DCFCE7] text-[#14532D] hover:bg-[#BBF7D0]',
        active: 'border-[#15803D] bg-[#15803D] text-[#FFFFFF]',
        countInactive: 'bg-[#BBF7D0] text-[#14532D]',
        countActive: 'bg-white/20 text-white',
      }
    case 'archived':
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

function getAddressText(row: InspectionWithProperty) {
  const address = row.snapshot?.address ?? row.property?.address ?? null
  const postalCode = row.snapshot?.postal_code ?? row.property?.postal_code ?? null
  const city = row.snapshot?.city ?? row.property?.city ?? null
  const postalAndCity = [postalCode, city].filter(Boolean).join(' ')

  return [address, postalAndCity].filter(Boolean).join(', ') || 'Ingen adress angiven'
}

function getCustomerText(row: InspectionWithProperty) {
  return (
    row.customer_name?.trim() ||
    row.client_name?.trim() ||
    row.snapshot?.client_name?.trim() ||
    row.client_contact?.trim() ||
    '–'
  )
}

function getDateValue(row: InspectionWithProperty) {
  return row.date ? new Date(row.date).getTime() : new Date(row.created_at).getTime()
}

function getSortIndicator(active: boolean, direction: SortDirection) {
  if (!active) return '↕'
  return direction === 'asc' ? '↑' : '↓'
}

function getStatusSortRank(status: string | null) {
  switch (getStatusBucket(status)) {
    case 'draft':
      return 0
    case 'ongoing':
      return 1
    case 'completed':
      return 2
    default:
      return 3
  }
}

function PdfDownloadActionButton({
  href,
  enabled,
}: {
  href: string
  enabled: boolean
}) {
  if (!enabled) {
    return null
  }

  return (
    <Link
      href={href}
      onClick={(event) => event.stopPropagation()}
      aria-label="Ladda ner gällande PDF"
      title="Ladda ner gällande PDF"
      className="group inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-200 bg-white/95 text-slate-700 shadow-sm ring-1 ring-white/80 transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
    >
      <Download size={13} strokeWidth={1.9} />
      <span className="sr-only">Ladda ner gällande PDF</span>
    </Link>
  )
}

function UnlockInspectionActionButton({
  onClick,
  disabled,
}: {
  onClick: () => void
  disabled: boolean
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      disabled={disabled}
      aria-label="Lås upp besiktning"
      title="Lås upp besiktning"
      className="inline-flex h-7 items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 text-[11px] font-medium text-amber-800 transition hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <LockOpen size={12} strokeWidth={2.1} />
      Lås upp
    </button>
  )
}

export default function InspectionsPage() {
  return <ObOrganizationBoundary><InspectionsContent /></ObOrganizationBoundary>
}

function InspectionsContent() {
  const { id: orgId } = useObOrganization()
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [inspections, setInspections] = useState<InspectionWithProperty[]>([])

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sortField, setSortField] = useState<SortField>('status')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [showDraft, setShowDraft] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [currentPage, setCurrentPage] = useState(1)
  const [creatingMode, setCreatingMode] = useState<'scratch' | null>(null)
  const [unlockTarget, setUnlockTarget] = useState<InspectionWithProperty | null>(null)
  const [unlockReason, setUnlockReason] = useState('')
  const [unlockSubmitting, setUnlockSubmitting] = useState(false)
  useObOrganizationSwitchGuard(Boolean(unlockReason), Boolean(creatingMode) || unlockSubmitting)

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
      if (typeof saved.showDraft === 'boolean') {
        setShowDraft(saved.showDraft)
      }
      if (typeof saved.showArchived === 'boolean') {
        setShowArchived(saved.showArchived)
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
      showDraft,
      showArchived,
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  }, [search, statusFilter, sortField, sortDirection, pageSize, showDraft, showArchived])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    void fetch(withObOrganization('/api/ob/inspections', orgId), { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const body = await response.json()
        if (!response.ok || !Array.isArray(body.inspections)) throw new Error(body.error || 'Kunde inte hämta besiktningar.')
        if (!controller.signal.aborted) { setInspections(body.inspections); setError(null) }
      })
      .catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Kunde inte hämta besiktningar.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [orgId])

  useEffect(() => {
    setCurrentPage(1)
  }, [search, statusFilter, sortField, sortDirection, pageSize, showDraft, showArchived])

  const visibleInspections = useMemo(
    () =>
      inspections.filter((row) => {
        const bucket = getStatusBucket(row.status)
        if (!showDraft && bucket === 'draft') return false
        if (!showArchived && bucket === 'archived') return false
        return true
      }),
    [inspections, showDraft, showArchived]
  )

  useEffect(() => {
    if ((!showDraft && statusFilter === 'draft') || (!showArchived && statusFilter === 'archived')) {
      setStatusFilter('all')
    }
  }, [showDraft, showArchived, statusFilter])

  const statusTabs = useMemo(
    () =>
      STATUS_TABS.filter((tab) => {
        if (tab.key === 'draft' && !showDraft) return false
        if (tab.key === 'archived' && !showArchived) return false
        return true
      }),
    [showDraft, showArchived]
  )

  const statusCounts = useMemo(() => {
    const counts: Record<StatusFilter, number> = {
      all: visibleInspections.length,
      draft: 0,
      ongoing: 0,
      completed: 0,
      archived: 0,
    }

    for (const row of visibleInspections) {
      counts[getStatusBucket(row.status)] += 1
    }

    return counts
  }, [visibleInspections])

  const filteredAndSorted = useMemo(() => {
    const q = search.trim().toLowerCase()

    const filtered = visibleInspections.filter((row) => {
      if (statusFilter !== 'all' && getStatusBucket(row.status) !== statusFilter) {
        return false
      }

      if (!q) return true

      const searchable = [
        row.assignment_number ?? '',
        row.customer_name ?? '',
        row.client_name ?? '',
        row.client_contact ?? '',
        row.type ?? '',
        getAddressText(row),
        getStatusLabel(row.status),
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
      } else if (sortField === 'date') {
        comparison = getDateValue(a) - getDateValue(b)
      } else if (sortField === 'address') {
        comparison = COLLATOR.compare(getAddressText(a), getAddressText(b))
      } else if (sortField === 'customer') {
        comparison = COLLATOR.compare(getCustomerText(a), getCustomerText(b))
      }

      return sortDirection === 'asc' ? comparison : -comparison
    })
  }, [visibleInspections, search, statusFilter, sortField, sortDirection])

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
    showDraft ||
    showArchived

  const resetView = () => {
    setSearch('')
    setStatusFilter('all')
    setSortField('status')
    setSortDirection('asc')
    setPageSize(DEFAULT_PAGE_SIZE)
    setShowDraft(false)
    setShowArchived(false)
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
    setSortDirection(field === 'date' ? 'desc' : 'asc')
  }

  const openInspection = (row: InspectionWithProperty) => {
    router.push(withObOrganization(`/properties/${row.property_id}/ob/${row.id}`, orgId))
  }

  const handleBack = () => {
    router.push(withObOrganization('/ob', orgId))
  }

  const handleCreateFromScratch = async () => {
    if (creatingMode) return
    setMutationError(null)
    setCreatingMode('scratch')
    try {
      const response = await fetch(withObOrganization('/api/ob/inspections', orgId), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      })
      const body = await response.json()
      if (!response.ok || !body.propertyId || !body.inspectionId || body.orgId !== orgId) throw new Error(body.error || 'Kunde inte skapa besiktningen i vald organisation.')
      router.push(withObOrganization(`/properties/${body.propertyId}/ob/${body.inspectionId}`, orgId))
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Kunde inte skapa besiktning.')
    } finally { setCreatingMode(null) }
  }

  const openUnlockDialog = (row: InspectionWithProperty) => {
    setMutationError(null)
    setUnlockTarget(row)
    setUnlockReason('')
  }

  const closeUnlockDialog = () => {
    if (unlockSubmitting) return
    setUnlockTarget(null)
    setUnlockReason('')
  }

  const submitUnlock = async () => {
    if (!unlockTarget || unlockSubmitting) return

    const reason = unlockReason.trim()
    if (reason.length < 10) {
      setMutationError('Anledning för upplåsning måste vara minst 10 tecken.')
      return
    }

    try {
      setMutationError(null)
      setUnlockSubmitting(true)

      const response = await fetch(withObOrganization(`/api/ob/inspections/${unlockTarget.id}/unlock`, orgId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null

      if (!response.ok) {
        throw new Error(payload?.error ?? 'Kunde inte låsa upp besiktningen.')
      }

      setInspections((prev) =>
        prev.map((row) =>
          row.id === unlockTarget.id
            ? {
                ...row,
                locked_at: null,
                locked_by: null,
              }
            : row
        )
      )

      setUnlockTarget(null)
      setUnlockReason('')
    } catch (unlockError: unknown) {
      setMutationError(
        unlockError instanceof Error
          ? unlockError.message
          : 'Kunde inte låsa upp besiktningen.'
      )
    } finally {
      setUnlockSubmitting(false)
    }
  }

  return (
    <Protected>
      <main className="relative min-h-full overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'linear-gradient(135deg, #f7fbff 0%, #ffffff 52%, #f3f9ff 100%)',
          }}
        />
        <div className="pointer-events-none absolute inset-0 bg-transparent" />

        <div className="relative mx-auto w-full max-w-7xl space-y-4 p-4 md:p-6">
          <header className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm backdrop-blur-sm md:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => router.push(withObOrganization('/ob', orgId))}
                  aria-label="Till huvudsidan"
                  title="Till huvudsidan"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                >
                  <ChevronsLeft size={15} strokeWidth={2.2} />
                </button>
                <button
                  type="button"
                  onClick={handleBack}
                  aria-label="Tillbaka"
                  title="Tillbaka"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                >
                  <ArrowLeft size={16} strokeWidth={2} />
                </button>
                <h1 className="text-2xl font-semibold text-slate-950">Mina besiktningar</h1>
              </div>

              <div className="flex w-full items-center justify-end gap-2 lg:w-auto">
                <button
                  type="button"
                  onClick={() => void handleCreateFromScratch()}
                  disabled={Boolean(creatingMode)}
                  aria-label="Ny besiktning"
                  title="Ny besiktning"
                  className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {creatingMode === 'scratch' ? (
                    <Loader2 size={14} strokeWidth={2.3} className="animate-spin" />
                  ) : (
                    <Plus size={14} strokeWidth={2.3} />
                  )}
                  Ny besiktning
                </button>
              </div>
            </div>
          </header>

          <section className="rounded-xl border border-white/30 bg-white/90 p-2 shadow-sm backdrop-blur md:p-3">
            <div className="flex items-center gap-1 overflow-x-auto whitespace-nowrap pb-0.5">
              <div className="w-[230px] shrink-0">
                <input
                  type="text"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Sök på adress, kund, uppdragsnr eller status"
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
                  onClick={() => setShowDraft((prev) => !prev)}
                  className={
                    showDraft
                      ? 'rounded-md border border-gray-500 bg-gray-200 px-2 py-0.5 text-[11px] text-gray-900'
                      : 'rounded-md border border-gray-300 bg-white px-2 py-0.5 text-[11px] text-gray-700 hover:bg-gray-50'
                  }
                >
                  {showDraft ? 'Dölj utkast' : 'Visa utkast'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowArchived((prev) => !prev)}
                  className={
                    showArchived
                      ? 'rounded-md border border-slate-500 bg-slate-200 px-2 py-0.5 text-[11px] text-slate-900'
                      : 'rounded-md border border-gray-300 bg-white px-2 py-0.5 text-[11px] text-gray-700 hover:bg-gray-50'
                  }
                >
                  {showArchived ? 'Dölj arkiverade' : 'Visa arkiverade'}
                </button>
                <label className="text-[10px] text-gray-600" htmlFor="pageSize">
                  Rader/sida
                </label>
                <select
                  id="pageSize"
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

          {loading ? <div className="text-sm text-blue-100">Laddar besiktningar...</div> : null}

          {error && !loading ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
          ) : null}

          {mutationError && !loading ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {mutationError}
            </div>
          ) : null}

          {!loading && !error && totalItems === 0 ? (
            <div className="rounded-md border border-dashed border-white/40 bg-white/75 p-4 text-sm text-gray-700">
              Inga besiktningar hittades.
            </div>
          ) : null}

          {!loading && !error && totalItems > 0 ? (
            <>
              <div className="hidden overflow-x-auto rounded-xl border border-gray-200 bg-white md:block">
                <table className="min-w-full text-left text-sm text-black">
                  <thead className="border-b bg-gray-50 text-xs uppercase text-black">
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
                    {pagedRows.map((row) => {
                      const dateText = row.date ?? new Date(row.created_at).toLocaleDateString('sv-SE')
                      const customer = getCustomerText(row)
                      const downloadHref = withObOrganization(`/api/report-v2/${row.id}/pdf`, orgId)
                      const canDownloadPdf = Boolean(row.hasReadyPdf)
                      const isLocked = Boolean(row.locked_at)
                      const isUnlockingThis = unlockSubmitting && unlockTarget?.id === row.id

                      return (
                        <tr
                          key={row.id}
                          className={`cursor-pointer border-b last:border-b-0 focus-visible:outline-none ${getStatusRowClass(
                            row.status
                          )}`}
                          tabIndex={0}
                          onClick={() => openInspection(row)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              openInspection(row)
                            }
                          }}
                        >
                          <td className="px-3 py-1.5 align-middle whitespace-nowrap">
                            <div>{dateText}</div>
                          </td>

                          <td className="px-3 py-1.5 align-middle">{customer}</td>

                          <td className="px-3 py-1.5 align-middle">{getAddressText(row)}</td>

                          <td className="px-3 py-1.5 align-middle whitespace-nowrap font-medium">
                            {getStatusLabel(row.status)}
                          </td>

                          <td className="px-3 py-1.5 align-middle text-right">
                            <div className="flex items-center justify-end gap-2">
                              {isLocked ? (
                                <UnlockInspectionActionButton
                                  onClick={() => openUnlockDialog(row)}
                                  disabled={isUnlockingThis}
                                />
                              ) : null}
                              <PdfDownloadActionButton href={downloadHref} enabled={canDownloadPdf} />
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <div className="space-y-3 md:hidden">
                {pagedRows.map((row) => {
                  const dateText = row.date ?? new Date(row.created_at).toLocaleDateString('sv-SE')
                  const downloadHref = withObOrganization(`/api/report-v2/${row.id}/pdf`, orgId)
                  const canDownloadPdf = Boolean(row.hasReadyPdf)
                  const isLocked = Boolean(row.locked_at)
                  const isUnlockingThis = unlockSubmitting && unlockTarget?.id === row.id

                  return (
                    <article
                      key={row.id}
                      className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm"
                      onClick={() => openInspection(row)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-xs text-gray-500">Datum</div>
                          <div className="text-sm font-medium text-gray-900">{dateText}</div>
                        </div>
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${getStatusBadgeClass(
                            row.status
                          )}`}
                        >
                          {getStatusLabel(row.status)}
                        </span>
                      </div>

                      <div className="mt-3 space-y-2">
                        <div>
                          <div className="text-xs text-gray-500">Adress</div>
                          <div className="text-sm text-gray-900">{getAddressText(row)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500">Kund</div>
                          <div className="text-sm text-gray-900">{getCustomerText(row)}</div>
                        </div>
                      </div>

                      <div className="mt-3 flex items-center justify-end gap-2">
                        {isLocked ? (
                          <UnlockInspectionActionButton
                            onClick={() => openUnlockDialog(row)}
                            disabled={isUnlockingThis}
                          />
                        ) : null}
                        <PdfDownloadActionButton href={downloadHref} enabled={canDownloadPdf} />
                      </div>
                    </article>
                  )
                })}
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

          {unlockTarget ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
              <div className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-4 shadow-xl">
                <h2 className="text-base font-semibold text-gray-900">Lås upp besiktning</h2>
                <p className="mt-1 text-sm text-gray-600">
                  Ange anledning till upplåsning (minst 10 tecken).
                </p>

                <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
                  <div>
                    <span className="font-medium">Adress:</span> {getAddressText(unlockTarget)}
                  </div>
                  <div className="mt-1">
                    <span className="font-medium">Kund:</span> {getCustomerText(unlockTarget)}
                  </div>
                </div>

                <label className="mt-3 block text-xs font-medium text-gray-700" htmlFor="unlockReason">
                  Anledning
                </label>
                <textarea
                  id="unlockReason"
                  value={unlockReason}
                  onChange={(event) => setUnlockReason(event.target.value)}
                  rows={4}
                  autoFocus
                  disabled={unlockSubmitting}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:bg-gray-100"
                  placeholder="Exempel: Kund har inkommit med ändringar efter första utskick."
                />

                <div className="mt-1 text-right text-xs text-gray-500">
                  {unlockReason.trim().length}/10 tecken
                </div>

                <div className="mt-4 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeUnlockDialog}
                    disabled={unlockSubmitting}
                    className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Avbryt
                  </button>
                  <button
                    type="button"
                    onClick={() => void submitUnlock()}
                    disabled={unlockSubmitting}
                    className="inline-flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {unlockSubmitting ? (
                      <Loader2 size={14} strokeWidth={2.2} className="animate-spin" />
                    ) : (
                      <LockOpen size={14} strokeWidth={2.2} />
                    )}
                    Lås upp
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </main>
    </Protected>
  )
}



