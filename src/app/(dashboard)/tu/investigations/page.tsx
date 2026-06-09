'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ChevronsLeft, Download, Loader2, LockOpen, Plus, Trash2 } from 'lucide-react'
import Protected from '@/components/Protected'

type InvestigationItem = {
  inspectionId: string
  propertyId: string | null
  assignmentId: string | null
  title: string
  status: string | null
  date: string | null
  inspectionTime: string | null
  customerName: string | null
  customerEmail: string | null
  propertyAddress: string | null
  propertyCity: string | null
  objectType: 'villa' | 'apartment'
  cadastralId: string | null
  brfName: string | null
  apartmentNumber: string | null
  apartmentHolderName: string | null
  scopeDescription: string | null
  reportLockedAt: string | null
  hasReadyPdf?: boolean
  createdAt: string | null
  updatedAt: string | null
}

type ListResponse = {
  items: InvestigationItem[]
}

type StatusFilter = 'all' | 'draft' | 'ongoing' | 'completed' | 'locked'
type SortField = 'updated' | 'date' | 'title' | 'customer' | 'address' | 'status'
type SortDirection = 'asc' | 'desc'

type SavedListView = {
  search: string
  statusFilter: StatusFilter
  sortField: SortField
  sortDirection: SortDirection
  pageSize: number
}

const STORAGE_KEY = 'tu:investigations:list:view:v1'
const DEFAULT_PAGE_SIZE = 25
const PAGE_SIZE_OPTIONS = [10, 25, 50]
const COLLATOR = new Intl.Collator('sv', { sensitivity: 'base', numeric: true })

const STATUS_TABS: Array<{ key: StatusFilter; label: string }> = [
  { key: 'all', label: 'Alla' },
  { key: 'draft', label: 'Utkast' },
  { key: 'ongoing', label: 'Pågående' },
  { key: 'completed', label: 'Klar' },
  { key: 'locked', label: 'Låst' },
]

function getStatusBucket(item: InvestigationItem): StatusFilter {
  if (item.reportLockedAt) return 'locked'
  const status = item.status?.trim().toLowerCase() ?? ''
  if (status === 'draft' || status === 'utkast') return 'draft'
  if (status === 'completed' || status === 'klar' || status === 'done') return 'completed'
  return 'ongoing'
}

function getStatusLabel(item: InvestigationItem) {
  const bucket = getStatusBucket(item)
  if (bucket === 'locked') return 'Låst'
  if (bucket === 'draft') return 'Utkast'
  if (bucket === 'completed') return 'Klar'
  return 'Pågående'
}

function getStatusSortRank(item: InvestigationItem) {
  const bucket = getStatusBucket(item)
  if (bucket === 'draft') return 0
  if (bucket === 'ongoing') return 1
  if (bucket === 'completed') return 2
  return 3
}

function getStatusRowClass(item: InvestigationItem) {
  const bucket = getStatusBucket(item)
  if (bucket === 'draft') return 'bg-[#F9FAFB] text-[#111827] hover:bg-[#F3F4F6]'
  if (bucket === 'completed') return 'bg-[#DCFCE7] text-[#111827] hover:bg-[#BBF7D0]'
  if (bucket === 'locked') return 'bg-[#E5E7EB] text-[#111827] hover:bg-[#D1D5DB]'
  return 'bg-[#EDE9FE] text-[#111827] hover:bg-[#DDD6FE]'
}

function getStatusTabClass(key: StatusFilter, active: boolean) {
  if (active) {
    if (key === 'completed') return 'border-emerald-700 bg-emerald-700 text-white'
    if (key === 'locked') return 'border-slate-600 bg-slate-600 text-white'
    return 'border-violet-700 bg-violet-700 text-white'
  }
  if (key === 'completed') return 'border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100'
  if (key === 'locked') return 'border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200'
  return 'border-violet-200 bg-violet-50 text-violet-900 hover:bg-violet-100'
}

function getAddress(item: InvestigationItem) {
  const address = [item.propertyAddress, item.propertyCity].filter(Boolean).join(', ')
  const apartmentObject = [item.brfName, item.apartmentNumber ? `lgh ${item.apartmentNumber}` : null]
    .filter(Boolean)
    .join(', ')
  const objectReference = item.objectType === 'apartment' ? apartmentObject : item.cadastralId
  return [address, objectReference].filter(Boolean).join(' - ') || 'Adress saknas'
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

function timestamp(value: string | null) {
  if (!value) return 0
  const parsed = new Date(value).getTime()
  return Number.isNaN(parsed) ? 0 : parsed
}

function PdfDownloadActionButton({ inspectionId }: { inspectionId: string }) {
  return (
    <a
      href={`/api/report-v2/${encodeURIComponent(inspectionId)}/pdf`}
      onClick={(event) => event.stopPropagation()}
      title="Ladda ner gällande PDF"
      aria-label="Ladda ner gällande PDF"
      className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-violet-200 bg-white/95 text-violet-700 transition hover:bg-violet-50"
    >
      <Download size={13} />
    </a>
  )
}

function UnlockInvestigationActionButton({
  onClick,
  disabled,
  busy,
}: {
  onClick: () => void
  disabled: boolean
  busy: boolean
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onClick()
      }}
      disabled={disabled}
      aria-label="Lås upp TU-utlåtande"
      title="Lås upp TU-utlåtande"
      className="inline-flex h-6 items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 text-[11px] font-medium text-amber-800 transition hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {busy ? (
        <Loader2 size={12} strokeWidth={2.1} className="animate-spin" />
      ) : (
        <LockOpen size={12} strokeWidth={2.1} />
      )}
      Lås upp
    </button>
  )
}

export default function TuInvestigationsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<InvestigationItem[]>([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sortField, setSortField] = useState<SortField>('updated')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [currentPage, setCurrentPage] = useState(1)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [unlockTarget, setUnlockTarget] = useState<InvestigationItem | null>(null)
  const [unlockReason, setUnlockReason] = useState('')
  const [unlockSubmitting, setUnlockSubmitting] = useState(false)
  const [unlockError, setUnlockError] = useState<string | null>(null)

  useEffect(() => {
    const loadInvestigations = async () => {
      try {
        setLoading(true)
        setError(null)
        const response = await fetch('/api/tu/investigations', { cache: 'no-store' })
        const data = (await response.json().catch(() => ({}))) as Partial<ListResponse> & { error?: string }
        if (!response.ok) throw new Error(data.error ?? 'Kunde inte hämta utredningar.')
        setItems(data.items ?? [])
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Kunde inte hämta utredningar.')
      } finally {
        setLoading(false)
      }
    }

    void loadInvestigations()
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
      if (typeof saved.sortField === 'string') setSortField(saved.sortField as SortField)
      if (saved.sortDirection === 'asc' || saved.sortDirection === 'desc') setSortDirection(saved.sortDirection)
      if (typeof saved.pageSize === 'number' && PAGE_SIZE_OPTIONS.includes(saved.pageSize)) {
        setPageSize(saved.pageSize)
      }
    } catch {
      // Ignore malformed localStorage payloads.
    }
  }, [])

  useEffect(() => {
    const payload: SavedListView = { search, statusFilter, sortField, sortDirection, pageSize }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  }, [search, statusFilter, sortField, sortDirection, pageSize])

  useEffect(() => {
    setCurrentPage(1)
  }, [search, statusFilter, sortField, sortDirection, pageSize])

  const statusCounts = useMemo(() => {
    const counts: Record<StatusFilter, number> = {
      all: items.length,
      draft: 0,
      ongoing: 0,
      completed: 0,
      locked: 0,
    }
    for (const item of items) counts[getStatusBucket(item)] += 1
    return counts
  }, [items])

  const filteredAndSorted = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = items.filter((item) => {
      if (statusFilter !== 'all' && getStatusBucket(item) !== statusFilter) return false
      if (!q) return true
      const searchable = [
        item.title,
        item.customerName ?? '',
        item.customerEmail ?? '',
        item.scopeDescription ?? '',
        getAddress(item),
        item.apartmentHolderName ?? '',
        getStatusLabel(item),
      ]
        .join(' ')
        .toLowerCase()
      return searchable.includes(q)
    })

    return [...filtered].sort((a, b) => {
      let comparison = 0
      if (sortField === 'updated') {
        comparison = timestamp(a.updatedAt ?? a.createdAt) - timestamp(b.updatedAt ?? b.createdAt)
      } else if (sortField === 'date') {
        const aValue = a.date ? new Date(a.date).getTime() : Number.MAX_SAFE_INTEGER
        const bValue = b.date ? new Date(b.date).getTime() : Number.MAX_SAFE_INTEGER
        comparison = aValue - bValue
      } else if (sortField === 'title') {
        comparison = COLLATOR.compare(a.title, b.title)
      } else if (sortField === 'customer') {
        comparison = COLLATOR.compare(a.customerName ?? a.customerEmail ?? '', b.customerName ?? b.customerEmail ?? '')
      } else if (sortField === 'address') {
        comparison = COLLATOR.compare(getAddress(a), getAddress(b))
      } else if (sortField === 'status') {
        comparison = getStatusSortRank(a) - getStatusSortRank(b)
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
    if (currentPage !== safePage) setCurrentPage(safePage)
  }, [currentPage, safePage])

  const hasActiveFilters =
    search.trim().length > 0 ||
    statusFilter !== 'all' ||
    sortField !== 'updated' ||
    sortDirection !== 'desc' ||
    pageSize !== DEFAULT_PAGE_SIZE

  const resetView = () => {
    setSearch('')
    setStatusFilter('all')
    setSortField('updated')
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
    setSortDirection(field === 'date' || field === 'updated' ? 'desc' : 'asc')
  }

  const openInvestigation = (inspectionId: string) => {
    router.push(`/tu/investigations/${inspectionId}`)
  }

  const deleteInvestigation = async (item: InvestigationItem) => {
    if (item.reportLockedAt) {
      setError('Låsta utlåtanden kan inte raderas.')
      return
    }

    const confirmed = window.confirm(`Radera utlåtandet "${item.title}"? Det går inte att ångra.`)
    if (!confirmed) return

    try {
      setDeletingId(item.inspectionId)
      setError(null)
      const response = await fetch(`/api/tu/investigations/${encodeURIComponent(item.inspectionId)}`, {
        method: 'DELETE',
      })
      const payload = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) throw new Error(payload.error ?? 'Kunde inte radera utlåtandet.')
      setItems((prev) => prev.filter((row) => row.inspectionId !== item.inspectionId))
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Kunde inte radera utlåtandet.')
    } finally {
      setDeletingId(null)
    }
  }

  const openUnlockDialog = (item: InvestigationItem) => {
    setError(null)
    setUnlockError(null)
    setUnlockTarget(item)
    setUnlockReason('')
  }

  const closeUnlockDialog = () => {
    if (unlockSubmitting) return
    setUnlockTarget(null)
    setUnlockReason('')
    setUnlockError(null)
  }

  const submitUnlock = async () => {
    if (!unlockTarget || unlockSubmitting) return

    const reason = unlockReason.trim()
    if (reason.length < 10) {
      setUnlockError('Anledning för upplåsning måste vara minst 10 tecken.')
      return
    }

    try {
      setUnlockSubmitting(true)
      setUnlockError(null)
      setError(null)

      const response = await fetch(`/api/tu/investigations/${encodeURIComponent(unlockTarget.inspectionId)}/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      const payload = (await response.json().catch(() => null)) as { error?: string } | null

      if (!response.ok) {
        throw new Error(payload?.error ?? 'Kunde inte låsa upp TU-utlåtandet.')
      }

      const now = new Date().toISOString()
      setItems((prev) =>
        prev.map((row) =>
          row.inspectionId === unlockTarget.inspectionId
            ? {
                ...row,
                reportLockedAt: null,
                updatedAt: now,
              }
            : row
        )
      )

      setUnlockTarget(null)
      setUnlockReason('')
      setUnlockError(null)
      router.refresh()
    } catch (submitError) {
      setUnlockError(submitError instanceof Error ? submitError.message : 'Kunde inte låsa upp TU-utlåtandet.')
    } finally {
      setUnlockSubmitting(false)
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
                <h1 className="text-2xl font-semibold text-slate-950">Utredningar</h1>
              </div>

              <button
                type="button"
                onClick={() => router.push('/tu')}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm font-medium text-violet-800 transition hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 sm:w-auto"
              >
                <Plus size={14} strokeWidth={2.3} />
                Ny utredning
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
                  placeholder="Sök på adress, kund, rubrik eller omfattning"
                  className="w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-[11px] text-gray-900 placeholder:text-gray-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                />
              </div>

              {STATUS_TABS.map((tab) => {
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
                <label className="text-[10px] text-gray-600" htmlFor="tuInvestigationsPageSize">
                  Rader/sida
                </label>
                <select
                  id="tuInvestigationsPageSize"
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

          {loading ? <div className="text-sm text-violet-900">Laddar utredningar...</div> : null}
          {error && !loading ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>
          ) : null}
          {!loading && totalItems === 0 ? (
            <div className="rounded-md border border-dashed border-violet-200 bg-white/75 p-4 text-sm text-gray-700">
              Inga utredningar i denna vy.
            </div>
          ) : null}

          {!loading && totalItems > 0 ? (
            <>
              <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
                <table className="min-w-full text-left text-sm text-gray-900">
                  <thead className="border-b bg-gray-50 text-xs uppercase text-gray-700">
                    <tr>
                      <SortableTh label="Datum" field="date" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                      <SortableTh label="Uppdaterad" field="updated" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                      <SortableTh label="Rubrik" field="title" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                      <SortableTh label="Kund" field="customer" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                      <SortableTh label="Adress" field="address" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                      <th className="px-3 py-2 font-semibold">Omfattning</th>
                      <SortableTh label="Status" field="status" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                      <th className="px-3 py-2 text-right font-semibold">Åtgärder</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedRows.map((item) => (
                      <tr
                        key={item.inspectionId}
                        tabIndex={0}
                        role="button"
                        aria-label={`Öppna utredning ${item.title}`}
                        onClick={() => openInvestigation(item.inspectionId)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            openInvestigation(item.inspectionId)
                          }
                        }}
                        className={`cursor-pointer border-b last:border-b-0 focus-visible:outline-none ${getStatusRowClass(item)}`}
                      >
                        <td className="px-3 py-2 align-middle whitespace-nowrap">{formatDate(item.date)}</td>
                        <td className="px-3 py-2 align-middle whitespace-nowrap">
                          {formatDate(item.updatedAt ?? item.createdAt)}
                        </td>
                        <td className="px-3 py-2 align-middle font-medium">{item.title}</td>
                        <td className="px-3 py-2 align-middle">
                          <div>{item.customerName || '-'}</div>
                          {item.customerEmail ? <div className="text-xs text-gray-600">{item.customerEmail}</div> : null}
                        </td>
                        <td className="px-3 py-2 align-middle">{getAddress(item)}</td>
                        <td className="max-w-[280px] px-3 py-2 align-middle">
                          <div className="line-clamp-2 text-xs leading-5">{item.scopeDescription || '-'}</div>
                        </td>
                        <td className="px-3 py-2 align-middle whitespace-nowrap font-medium">{getStatusLabel(item)}</td>
                        <td className="px-3 py-2 align-middle whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1">
                            {item.hasReadyPdf ? (
                              <PdfDownloadActionButton inspectionId={item.inspectionId} />
                            ) : null}
                            {item.reportLockedAt ? (
                              <UnlockInvestigationActionButton
                                onClick={() => openUnlockDialog(item)}
                                disabled={unlockSubmitting}
                                busy={unlockSubmitting && unlockTarget?.inspectionId === item.inspectionId}
                              />
                            ) : null}
                            <button
                              type="button"
                              onClick={(event) => {
                                event.preventDefault()
                                event.stopPropagation()
                                void deleteInvestigation(item)
                              }}
                              disabled={deletingId === item.inspectionId}
                              title={item.reportLockedAt ? 'Låsta utlåtanden kan inte raderas' : 'Radera utlåtande'}
                              aria-label={item.reportLockedAt ? 'Låsta utlåtanden kan inte raderas' : 'Radera utlåtande'}
                              className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-rose-200 bg-white/95 text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
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

          {unlockTarget ? (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
              role="dialog"
              aria-modal="true"
              aria-labelledby="tuUnlockDialogTitle"
            >
              <div className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-4 shadow-xl">
                <h2 id="tuUnlockDialogTitle" className="text-base font-semibold text-gray-900">
                  Lås upp TU-utlåtande
                </h2>
                <p className="mt-1 text-sm text-gray-600">
                  Ange anledning till upplåsning (minst 10 tecken).
                </p>

                <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  Publicerad digital version och PDF ligger kvar tills en ny version publiceras.
                </div>

                <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
                  <div>
                    <span className="font-medium">Utlåtande:</span> {unlockTarget.title}
                  </div>
                  <div className="mt-1">
                    <span className="font-medium">Adress:</span> {getAddress(unlockTarget)}
                  </div>
                  {unlockTarget.customerName || unlockTarget.customerEmail ? (
                    <div className="mt-1">
                      <span className="font-medium">Kund:</span>{' '}
                      {unlockTarget.customerName || unlockTarget.customerEmail}
                    </div>
                  ) : null}
                </div>

                <label className="mt-3 block text-xs font-medium text-gray-700" htmlFor="tuUnlockReason">
                  Anledning
                </label>
                <textarea
                  id="tuUnlockReason"
                  value={unlockReason}
                  onChange={(event) => setUnlockReason(event.target.value)}
                  rows={4}
                  autoFocus
                  disabled={unlockSubmitting}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 disabled:cursor-not-allowed disabled:bg-gray-100"
                  placeholder="Exempel: Beställaren har inkommit med ändringar efter utskick."
                />

                <div className="mt-1 flex items-center justify-between gap-3">
                  <div className="text-xs text-rose-700">{unlockError}</div>
                  <div className="shrink-0 text-xs text-gray-500">{unlockReason.trim().length}/10 tecken</div>
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
