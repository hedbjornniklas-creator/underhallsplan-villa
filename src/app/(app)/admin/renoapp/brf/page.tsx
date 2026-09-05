'use client'

import Link from 'next/link'
import { getBrfVisibilityLabel } from '@/lib/renoapp/brfLifecycle'
import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, Plus, RotateCw } from 'lucide-react'

type BrfItem = {
  id: string
  name: string
  slug: string
  orgNumber: string | null
  propertyDesignation: string | null
  address: string | null
  addressLine2: string | null
  postalCode: string | null
  city: string | null
  generalEmail: string | null
  brfPhone: string | null
  primaryContactName: string | null
  primaryContactEmail: string | null
  primaryContactPhone: string | null
  unitCount: number | null
  isPublicApplyEnabled: boolean
  isPublicApplyListed: boolean
  onboardingCompletedAt: string | null
  createdAt: string | null
  caseCount: number
  memberCount: number
  pendingInviteCount: number
  followUpInviteCount: number
}

type ListResponse = {
  items?: BrfItem[]
  error?: string
}

type StatusFilter = 'all' | 'completed' | 'pending' | 'listed' | 'direct_link'
type SortField = 'name' | 'created' | 'status' | 'cases' | 'members'
type SortDirection = 'asc' | 'desc'

const PAGE_SIZE_OPTIONS = [10, 25, 50]
const DEFAULT_PAGE_SIZE = 25
const COLLATOR = new Intl.Collator('sv', { sensitivity: 'base', numeric: true })

const STATUS_TABS: Array<{ key: StatusFilter; label: string }> = [
  { key: 'all', label: 'Alla' },
  { key: 'completed', label: 'Aktiva BRF:er' },
  { key: 'pending', label: 'Väntar på aktivering' },
  { key: 'listed', label: 'Publik lista' },
  { key: 'direct_link', label: 'Direktlänk' },
]

function formatDate(raw: string | null) {
  if (!raw) return '-'
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  return date.toLocaleDateString('sv-SE')
}

function getAddress(item: BrfItem) {
  const postalCity = [item.postalCode, item.city].filter(Boolean).join(' ')
  return [item.address, postalCity].filter(Boolean).join(', ') || 'Adress saknas'
}

function getStatusFilter(item: BrfItem): Exclude<StatusFilter, 'all'> {
  if (!item.onboardingCompletedAt) return 'pending'
  return 'completed'
}

function getStatusLabel(item: BrfItem) {
  return item.onboardingCompletedAt ? 'Aktiv BRF' : 'Väntar på aktivering'
}

function getStatusRank(item: BrfItem) {
  const status = getStatusFilter(item)
  if (status === 'pending') return 0
  if (status === 'listed') return 1
  if (status === 'direct_link') return 2
  return 3
}

function getStatusRowClass(item: BrfItem) {
  const status = getStatusFilter(item)
  if (status === 'pending') return 'bg-[#FEF3C7] text-[#111827] hover:bg-[#FDE68A]'
  return 'bg-emerald-50 text-slate-950 hover:bg-emerald-100'
}

function getStatusTabClass(key: StatusFilter, active: boolean) {
  if (active) {
    if (key === 'pending') return 'border-[#FACC15] bg-[#FACC15] text-[#111827]'
    if (key === 'listed') return 'border-[#15803D] bg-[#15803D] text-white'
    if (key === 'direct_link') return 'border-[#2563EB] bg-[#2563EB] text-white'
    return 'border-slate-900 bg-slate-900 text-white'
  }

  if (key === 'pending') return 'border-[#FDE68A] bg-[#FEF3C7] text-[#92400E] hover:bg-[#FDE68A]'
  if (key === 'listed') return 'border-[#86EFAC] bg-[#DCFCE7] text-[#14532D] hover:bg-[#BBF7D0]'
  if (key === 'direct_link') return 'border-[#93C5FD] bg-[#DBEAFE] text-[#1E3A8A] hover:bg-[#BFDBFE]'
  return 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
}

function getSortIndicator(active: boolean, direction: SortDirection) {
  if (!active) return '↕'
  return direction === 'asc' ? '↑' : '↓'
}

export default function RenoAppAdminBrfPage() {
  const [items, setItems] = useState<BrfItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [currentPage, setCurrentPage] = useState(1)

  const loadItems = async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await fetch('/api/renoapp/admin/brf', { cache: 'no-store' })
      const payload = (await response.json().catch(() => ({}))) as ListResponse

      if (!response.ok) {
        throw new Error(payload.error ?? 'Kunde inte hämta BRF:er.')
      }

      setItems(payload.items ?? [])
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Kunde inte hämta BRF:er.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadItems()
  }, [])

  const statusCounts = useMemo(() => {
    const counts: Record<StatusFilter, number> = {
      all: items.length,
      completed: 0,
      pending: 0,
      listed: 0,
      direct_link: 0,
    }

    for (const item of items) {
      counts[getStatusFilter(item)] += 1
      if (item.isPublicApplyEnabled) counts[item.isPublicApplyListed ? 'listed' : 'direct_link'] += 1
    }

    return counts
  }, [items])

  const filteredAndSorted = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = items.filter((item) => {
      if (statusFilter === 'listed' && !(item.isPublicApplyEnabled && item.isPublicApplyListed)) return false
      if (statusFilter === 'direct_link' && !(item.isPublicApplyEnabled && !item.isPublicApplyListed)) return false
      if ((statusFilter === 'completed' || statusFilter === 'pending') && getStatusFilter(item) !== statusFilter) return false
      if (!q) return true

      const searchable = [
        item.name,
        item.slug,
        item.orgNumber ?? '',
        item.propertyDesignation ?? '',
        getAddress(item),
        item.primaryContactName ?? '',
        item.primaryContactEmail ?? '',
        item.generalEmail ?? '',
        getStatusLabel(item),
      ]
        .join(' ')
        .toLowerCase()

      return searchable.includes(q)
    })

    return [...filtered].sort((a, b) => {
      let comparison = 0
      if (sortField === 'name') comparison = COLLATOR.compare(a.name, b.name)
      if (sortField === 'created') {
        comparison = new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime()
      }
      if (sortField === 'status') comparison = getStatusRank(a) - getStatusRank(b)
      if (sortField === 'cases') comparison = a.caseCount - b.caseCount
      if (sortField === 'members') comparison = a.memberCount - b.memberCount

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
    setCurrentPage(1)
  }, [search, statusFilter, sortField, sortDirection, pageSize])

  const hasActiveFilters =
    search.trim().length > 0 ||
    statusFilter !== 'all' ||
    sortField !== 'name' ||
    sortDirection !== 'asc' ||
    pageSize !== DEFAULT_PAGE_SIZE

  const resetView = () => {
    setSearch('')
    setStatusFilter('all')
    setSortField('name')
    setSortDirection('asc')
    setPageSize(DEFAULT_PAGE_SIZE)
    setCurrentPage(1)
  }

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
      return
    }

    setSortField(field)
    setSortDirection(field === 'created' || field === 'cases' || field === 'members' ? 'desc' : 'asc')
  }

  return (
    <main className="relative min-h-full overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: 'linear-gradient(135deg, #f7fbff 0%, #ffffff 52%, #f3f9ff 100%)',
        }}
      />

      <div className="relative mx-auto w-full max-w-7xl space-y-4 p-4 md:p-6">
        <header className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm backdrop-blur-sm md:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                RenoApp admin
              </p>
              <h1 className="mt-2 text-2xl font-semibold text-slate-950">BRF:er</h1>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void loadItems()}
                disabled={loading}
                aria-label="Uppdatera BRF-listan"
                title="Uppdatera BRF-listan"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RotateCw size={15} className={loading ? 'animate-spin' : ''} />
              </button>
              <Link
                href="/admin/renoapp/brf/create"
                className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 transition hover:bg-slate-50"
              >
                <Plus size={14} strokeWidth={2.3} />
                Skapa BRF
              </Link>
            </div>
          </div>
        </header>

        <section className="rounded-xl border border-white/30 bg-white/90 p-2 shadow-sm backdrop-blur md:p-3">
          <div className="flex items-center gap-1 overflow-x-auto whitespace-nowrap pb-0.5">
            <div className="w-[260px] shrink-0">
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Sök på BRF, org.nr, adress eller kontakt"
                className="w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-[11px] text-gray-900 placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            {STATUS_TABS.map((tab) => {
              const active = statusFilter === tab.key
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setStatusFilter(tab.key)}
                  className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium ${getStatusTabClass(
                    tab.key,
                    active
                  )}`}
                >
                  <span>{tab.label}</span>
                  <span className={active ? 'rounded-full bg-white/20 px-1.5 py-0 text-[10px]' : 'rounded-full bg-black/5 px-1.5 py-0 text-[10px]'}>
                    {statusCounts[tab.key]}
                  </span>
                </button>
              )
            })}

            <div className="ml-auto flex shrink-0 items-center gap-1">
              <label className="text-[10px] text-gray-600" htmlFor="brfPageSize">
                Rader/sida
              </label>
              <select
                id="brfPageSize"
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

        {loading ? <div className="text-sm text-slate-600">Laddar BRF:er...</div> : null}
        {error && !loading ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>
        ) : null}

        {!loading && totalItems === 0 ? (
          <div className="rounded-md border border-dashed border-slate-300 bg-white/75 p-4 text-sm text-gray-700">
            Inga BRF:er i denna vy.
          </div>
        ) : null}

        {!loading && totalItems > 0 ? (
          <>
            <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
              <table className="min-w-full text-left text-sm text-gray-900">
                <thead className="border-b bg-gray-50 text-xs uppercase text-gray-700">
                  <tr>
                    <th className="px-3 py-2">
                      <button type="button" onClick={() => handleSort('name')} className="inline-flex items-center gap-1 font-semibold hover:text-gray-900">
                        BRF <span>{getSortIndicator(sortField === 'name', sortDirection)}</span>
                      </button>
                    </th>
                    <th className="px-3 py-2">Kontakt</th>
                    <th className="px-3 py-2">
                      <button type="button" onClick={() => handleSort('status')} className="inline-flex items-center gap-1 font-semibold hover:text-gray-900">
                        Status <span>{getSortIndicator(sortField === 'status', sortDirection)}</span>
                      </button>
                    </th>
                    <th className="px-3 py-2 text-right">
                      <button type="button" onClick={() => handleSort('members')} className="inline-flex items-center gap-1 font-semibold hover:text-gray-900">
                        Medlemmar <span>{getSortIndicator(sortField === 'members', sortDirection)}</span>
                      </button>
                    </th>
                    <th className="px-3 py-2 text-right">
                      <button type="button" onClick={() => handleSort('cases')} className="inline-flex items-center gap-1 font-semibold hover:text-gray-900">
                        Ärenden <span>{getSortIndicator(sortField === 'cases', sortDirection)}</span>
                      </button>
                    </th>
                    <th className="px-3 py-2">
                      <button type="button" onClick={() => handleSort('created')} className="inline-flex items-center gap-1 font-semibold hover:text-gray-900">
                        Skapad <span>{getSortIndicator(sortField === 'created', sortDirection)}</span>
                      </button>
                    </th>
                    <th className="px-3 py-2 text-right font-semibold">Länkar</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedRows.map((item) => (
                    <tr key={item.id} className={`border-b last:border-b-0 ${getStatusRowClass(item)}`}>
                      <td className="px-3 py-2 align-middle">
                        <Link href={`/admin/renoapp/brf/${item.id}`} className="font-medium underline-offset-4 hover:underline">{item.name}</Link>
                        <div className="mt-0.5 text-xs text-gray-700">{[item.orgNumber, getAddress(item)].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td className="px-3 py-2 align-middle">
                        <div>{item.primaryContactName || '-'}</div>
                        <div className="mt-0.5 text-xs text-gray-700">{item.primaryContactEmail || item.generalEmail || '-'}</div>
                      </td>
                      <td className="px-3 py-2 align-middle whitespace-nowrap">
                        <div className="flex flex-wrap items-center gap-1">
                          <span className="font-medium">{getStatusLabel(item)}</span>
                          {item.pendingInviteCount > 0 ? (
                            <span className="rounded-full bg-white/75 px-2 py-0.5 text-[10px] font-semibold text-gray-800">
                              {item.pendingInviteCount} väntar på accept
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 text-xs text-slate-600">{getBrfVisibilityLabel(item)}</div>
                        {item.followUpInviteCount > 0 && <Link href={`/admin/renoapp/brf/${item.id}`} className="mt-1 block text-xs font-semibold text-red-800 underline">{item.followUpInviteCount} inbjudningar att följa upp</Link>}
                      </td>
                      <td className="px-3 py-2 text-right align-middle whitespace-nowrap">{item.memberCount}</td>
                      <td className="px-3 py-2 text-right align-middle whitespace-nowrap">{item.caseCount}</td>
                      <td className="px-3 py-2 align-middle whitespace-nowrap">{formatDate(item.createdAt)}</td>
                      <td className="px-3 py-2 align-middle whitespace-nowrap">
                        <div className="flex justify-end gap-1">
                          {item.isPublicApplyEnabled ? (
                            <Link
                              href={`/renoapp/brf/${item.slug}/apply`}
                              target="_blank"
                              aria-label={`Öppna ansökningssida för ${item.name}`}
                              title="Öppna ansökningssida"
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-300 bg-white/95 text-gray-700 transition hover:bg-gray-100"
                            >
                              <ExternalLink size={13} />
                            </Link>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700 md:flex-row md:items-center md:justify-between">
              <div>
                Visar {(safePage - 1) * pageSize + 1}-{Math.min(safePage * pageSize, totalItems)} av {totalItems}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                  disabled={safePage <= 1}
                  className="rounded-md border border-gray-300 px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Föregående
                </button>
                <span>
                  Sida {safePage} av {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                  disabled={safePage >= totalPages}
                  className="rounded-md border border-gray-300 px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Nästa
                </button>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </main>
  )
}
