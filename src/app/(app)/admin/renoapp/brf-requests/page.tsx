'use client'

import Link from 'next/link'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronUp, Mail, RotateCw, X } from 'lucide-react'

type RequestItem = {
  id: string
  name: string
  orgNumber: string | null
  address: string | null
  contactName: string
  contactEmail: string
  contactPhone: string | null
  message: string | null
  status: 'pending' | 'approved' | 'rejected'
  reviewNote: string | null
  externalMessage: string | null
  reviewedAt: string | null
  approvedBrfId: string | null
  createdAt: string
}

type ReviewResult = {
  request: RequestItem
  brf: {
    id: string
    name: string
    slug: string
  } | null
  invite: {
    email: string
    role: 'board'
    expiresAt: string
    inviteUrl: string
    emailSent: boolean
    emailError: string | null
  } | null
  decisionEmail: {
    emailSent: boolean
    emailError: string | null
  } | null
}

type DraftState = {
  reviewNote: string
  externalMessage: string
}

type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected'
type SortField = 'name' | 'status' | 'created' | 'reviewed'
type SortDirection = 'asc' | 'desc'

const PAGE_SIZE_OPTIONS = [10, 25, 50]
const DEFAULT_PAGE_SIZE = 25
const COLLATOR = new Intl.Collator('sv', { sensitivity: 'base', numeric: true })

const STATUS_TABS: Array<{ key: StatusFilter; label: string }> = [
  { key: 'all', label: 'Alla' },
  { key: 'pending', label: 'Väntande' },
  { key: 'approved', label: 'Godkända' },
  { key: 'rejected', label: 'Avslagna' },
]

const STATUS_LABELS: Record<Exclude<StatusFilter, 'all'>, string> = {
  pending: 'Väntande',
  approved: 'Godkänd',
  rejected: 'Avslagen',
}

function formatDate(value: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('sv-SE')
}

function formatDateTime(value: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

function getStatusRank(status: RequestItem['status']) {
  if (status === 'pending') return 0
  if (status === 'rejected') return 1
  return 2
}

function getStatusRowClass(status: RequestItem['status']) {
  if (status === 'pending') return 'bg-[#FEF3C7] text-[#111827] hover:bg-[#FDE68A]'
  if (status === 'approved') return 'bg-emerald-50 text-slate-950 hover:bg-emerald-100'
  return 'bg-rose-50 text-slate-950 hover:bg-rose-100'
}

function getStatusTabClass(key: StatusFilter, active: boolean) {
  if (active) {
    if (key === 'pending') return 'border-[#FACC15] bg-[#FACC15] text-[#111827]'
    if (key === 'approved') return 'border-[#15803D] bg-[#15803D] text-white'
    if (key === 'rejected') return 'border-[#BE123C] bg-[#BE123C] text-white'
    return 'border-slate-900 bg-slate-900 text-white'
  }

  if (key === 'pending') return 'border-[#FDE68A] bg-[#FEF3C7] text-[#92400E] hover:bg-[#FDE68A]'
  if (key === 'approved') return 'border-[#86EFAC] bg-[#DCFCE7] text-[#14532D] hover:bg-[#BBF7D0]'
  if (key === 'rejected') return 'border-[#FDA4AF] bg-[#FFE4E6] text-[#881337] hover:bg-[#FECDD3]'
  return 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
}

function getSortIndicator(active: boolean, direction: SortDirection) {
  if (!active) return '↕'
  return direction === 'asc' ? '↑' : '↓'
}

export default function RenoAppAdminBrfRequestsPage() {
  const [items, setItems] = useState<RequestItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submittingId, setSubmittingId] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, DraftState>>({})
  const [resultById, setResultById] = useState<Record<string, ReviewResult>>({})
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending')
  const [sortField, setSortField] = useState<SortField>('created')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [currentPage, setCurrentPage] = useState(1)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const loadItems = async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/renoapp/admin/brf-requests', { cache: 'no-store' })
      const payload = (await response.json().catch(() => ({}))) as {
        items?: RequestItem[]
        error?: string
      }

      if (!response.ok) {
        throw new Error(payload.error ?? 'Kunde inte läsa BRF-intresseanmälningar.')
      }

      const nextItems = payload.items ?? []
      setItems(nextItems)
      setDrafts((current) => {
        const nextDrafts = { ...current }
        for (const item of nextItems) {
          if (!nextDrafts[item.id]) {
            nextDrafts[item.id] = {
              reviewNote: item.reviewNote ?? '',
              externalMessage: item.externalMessage ?? '',
            }
          }
        }
        return nextDrafts
      })
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Kunde inte läsa BRF-intresseanmälningar.'
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadItems()
  }, [])

  const updateDraft = (id: string, patch: Partial<DraftState>) => {
    setDrafts((current) => ({
      ...current,
      [id]: { ...current[id], ...patch },
    }))
  }

  const handleAction = async (id: string, action: 'approve' | 'reject' | 'resend_decision') => {
    setSubmittingId(id)
    setError(null)

    try {
      const response = await fetch(`/api/renoapp/admin/brf-requests/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          reviewNote: drafts[id]?.reviewNote?.trim() ?? '',
          externalMessage: drafts[id]?.externalMessage ?? '',
        }),
      })
      const payload = (await response.json().catch(() => ({}))) as ReviewResult & {
        error?: string
      }

      if (!response.ok) {
        throw new Error(payload.error ?? 'Kunde inte hantera intresseanmälan.')
      }

      setItems((current) => current.map((item) => (item.id === id ? payload.request : item)))
      setDrafts((current) => ({
        ...current,
        [id]: {
          reviewNote: payload.request.reviewNote ?? '',
          externalMessage: payload.request.externalMessage ?? '',
        },
      }))
      setResultById((current) => ({ ...current, [id]: payload }))
      setExpandedId(id)
      setStatusFilter(payload.request.status)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Kunde inte hantera intresseanmälan.')
    } finally {
      setSubmittingId(null)
    }
  }

  const statusCounts = useMemo(() => ({
    all: items.length,
    pending: items.filter((item) => item.status === 'pending').length,
    approved: items.filter((item) => item.status === 'approved').length,
    rejected: items.filter((item) => item.status === 'rejected').length,
  }), [items])

  const filteredAndSorted = useMemo(() => {
    const query = search.trim().toLowerCase()
    const filtered = items.filter((item) => {
      if (statusFilter !== 'all' && item.status !== statusFilter) return false
      if (!query) return true

      return [
        item.name,
        item.orgNumber ?? '',
        item.address ?? '',
        item.contactName,
        item.contactEmail,
        item.contactPhone ?? '',
        item.message ?? '',
        STATUS_LABELS[item.status],
      ].join(' ').toLowerCase().includes(query)
    })

    return [...filtered].sort((a, b) => {
      let comparison = 0
      if (sortField === 'name') comparison = COLLATOR.compare(a.name, b.name)
      if (sortField === 'status') comparison = getStatusRank(a.status) - getStatusRank(b.status)
      if (sortField === 'created') comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      if (sortField === 'reviewed') comparison = new Date(a.reviewedAt ?? 0).getTime() - new Date(b.reviewedAt ?? 0).getTime()
      return sortDirection === 'asc' ? comparison : -comparison
    })
  }, [items, search, sortDirection, sortField, statusFilter])

  const totalItems = filteredAndSorted.length
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  const safePage = Math.min(currentPage, totalPages)
  const pagedRows = useMemo(() => {
    const start = (safePage - 1) * pageSize
    return filteredAndSorted.slice(start, start + pageSize)
  }, [filteredAndSorted, pageSize, safePage])

  useEffect(() => {
    setCurrentPage(1)
  }, [pageSize, search, sortDirection, sortField, statusFilter])

  const hasActiveFilters =
    search.trim().length > 0 ||
    statusFilter !== 'pending' ||
    sortField !== 'created' ||
    sortDirection !== 'desc' ||
    pageSize !== DEFAULT_PAGE_SIZE

  const resetView = () => {
    setSearch('')
    setStatusFilter('pending')
    setSortField('created')
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
    setSortDirection(field === 'created' || field === 'reviewed' ? 'desc' : 'asc')
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
                <h1 className="mt-2 text-2xl font-semibold text-slate-950">Intresseanmälningar</h1>
              </div>

              <button
                type="button"
                onClick={() => void loadItems()}
                disabled={loading}
                aria-label="Uppdatera listan med intresseanmälningar"
                title="Uppdatera listan"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RotateCw size={15} className={loading ? 'animate-spin' : ''} />
              </button>
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
                    className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium ${getStatusTabClass(tab.key, active)}`}
                  >
                    <span>{tab.label}</span>
                    <span className={active ? 'rounded-full bg-white/20 px-1.5 py-0 text-[10px]' : 'rounded-full bg-black/5 px-1.5 py-0 text-[10px]'}>
                      {statusCounts[tab.key]}
                    </span>
                  </button>
                )
              })}

              <div className="ml-auto flex shrink-0 items-center gap-1">
                <label className="text-[10px] text-gray-600" htmlFor="requestPageSize">
                  Rader/sida
                </label>
                <select
                  id="requestPageSize"
                  value={pageSize}
                  onChange={(event) => setPageSize(Number(event.target.value))}
                  className="rounded-md border border-gray-300 bg-white px-1.5 py-0.5 text-[11px] text-gray-700"
                >
                  {PAGE_SIZE_OPTIONS.map((option) => (
                    <option key={option} value={option}>{option}</option>
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

          {loading ? <div className="text-sm text-slate-600">Laddar intresseanmälningar...</div> : null}
          {error && !loading ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>
          ) : null}

          {!loading && totalItems === 0 ? (
            <div className="rounded-md border border-dashed border-slate-300 bg-white/75 p-4 text-sm text-gray-700">
              Inga intresseanmälningar i denna vy.
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
                      <th className="px-3 py-2">
                        <button type="button" onClick={() => handleSort('created')} className="inline-flex items-center gap-1 font-semibold hover:text-gray-900">
                          Inkommen <span>{getSortIndicator(sortField === 'created', sortDirection)}</span>
                        </button>
                      </th>
                      <th className="px-3 py-2">
                        <button type="button" onClick={() => handleSort('reviewed')} className="inline-flex items-center gap-1 font-semibold hover:text-gray-900">
                          Hanterad <span>{getSortIndicator(sortField === 'reviewed', sortDirection)}</span>
                        </button>
                      </th>
                      <th className="px-3 py-2 text-right font-semibold">Åtgärder</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedRows.map((item) => {
                      const isExpanded = expandedId === item.id
                      const result = resultById[item.id]
                      const rowClass = getStatusRowClass(item.status)

                      return (
                        <Fragment key={item.id}>
                          <tr className={`border-b last:border-b-0 ${rowClass}`}>
                            <td className="px-3 py-2 align-middle">
                              {item.approvedBrfId ? (
                                <Link href={`/admin/renoapp/brf/${item.approvedBrfId}`} className="font-medium underline-offset-4 hover:underline">
                                  {item.name}
                                </Link>
                              ) : (
                                <div className="font-medium">{item.name}</div>
                              )}
                              <div className="mt-0.5 text-xs text-gray-700">
                                {[item.orgNumber, item.address].filter(Boolean).join(' · ') || 'Uppgifter saknas'}
                              </div>
                            </td>
                            <td className="px-3 py-2 align-middle">
                              <div>{item.contactName}</div>
                              <div className="mt-0.5 text-xs text-gray-700">{item.contactEmail}</div>
                              {item.contactPhone ? <div className="mt-0.5 text-xs text-gray-700">{item.contactPhone}</div> : null}
                            </td>
                            <td className="px-3 py-2 align-middle whitespace-nowrap">
                              <span className="font-medium">{STATUS_LABELS[item.status]}</span>
                            </td>
                            <td className="px-3 py-2 align-middle whitespace-nowrap">{formatDate(item.createdAt)}</td>
                            <td className="px-3 py-2 align-middle whitespace-nowrap">{formatDate(item.reviewedAt)}</td>
                            <td className="px-3 py-2 align-middle whitespace-nowrap">
                              <div className="flex justify-end gap-1">
                                {item.status !== 'approved' ? (
                                  <button
                                    type="button"
                                    onClick={() => void handleAction(item.id, 'approve')}
                                    disabled={submittingId !== null}
                                    className="inline-flex h-7 items-center gap-1 rounded-md border border-emerald-300 bg-white/95 px-2 text-xs font-medium text-emerald-800 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    <Check size={13} />
                                    {submittingId === item.id ? 'Sparar...' : 'Godkänn'}
                                  </button>
                                ) : null}
                                {item.status === 'pending' ? (
                                  <button
                                    type="button"
                                    onClick={() => void handleAction(item.id, 'reject')}
                                    disabled={submittingId !== null}
                                    className="inline-flex h-7 items-center gap-1 rounded-md border border-rose-300 bg-white/95 px-2 text-xs font-medium text-rose-800 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    <X size={13} />
                                    Avslå
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  onClick={() => setExpandedId((current) => (current === item.id ? null : item.id))}
                                  aria-label={isExpanded ? `Dölj detaljer för ${item.name}` : `Visa detaljer för ${item.name}`}
                                  title={isExpanded ? 'Dölj detaljer' : 'Visa detaljer'}
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-300 bg-white/95 text-gray-700 transition hover:bg-gray-100"
                                >
                                  {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                                </button>
                              </div>
                            </td>
                          </tr>

                          {isExpanded ? (
                            <tr className="border-b border-gray-200 bg-white">
                              <td colSpan={6} className="px-3 py-4">
                                <div className="grid gap-5 lg:grid-cols-2">
                                  <section>
                                    <h3 className="text-xs font-semibold uppercase text-slate-700">Anmälan</h3>
                                    <dl className="mt-2 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[110px_1fr]">
                                      <dt className="text-slate-500">Kontaktperson</dt>
                                      <dd className="text-slate-900">{item.contactName}</dd>
                                      <dt className="text-slate-500">E-post</dt>
                                      <dd className="break-all text-slate-900">{item.contactEmail}</dd>
                                      <dt className="text-slate-500">Telefon</dt>
                                      <dd className="text-slate-900">{item.contactPhone ?? 'Saknas'}</dd>
                                      <dt className="text-slate-500">Adress</dt>
                                      <dd className="text-slate-900">{item.address ?? 'Saknas'}</dd>
                                      <dt className="text-slate-500">Meddelande</dt>
                                      <dd className="whitespace-pre-wrap text-slate-900">{item.message ?? 'Inget meddelande'}</dd>
                                    </dl>
                                  </section>

                                  <section className="border-t border-slate-200 pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
                                    <label className="block text-xs font-semibold text-slate-700">
                                      Intern anteckning · endast HusHub
                                      <textarea
                                        disabled={item.status !== 'pending' || submittingId !== null}
                                        value={drafts[item.id]?.reviewNote ?? ''}
                                        onChange={(event) => updateDraft(item.id, { reviewNote: event.target.value })}
                                        className="mt-2 min-h-24 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900 disabled:bg-slate-100 disabled:text-slate-600"
                                        placeholder="Intern anteckning"
                                      />
                                    </label>
                                    <label className="mt-3 block text-xs font-semibold text-slate-700">
                                      Meddelande till föreningen · skickas med beslutet
                                      <textarea
                                        disabled={item.status !== 'pending' || submittingId !== null}
                                        value={drafts[item.id]?.externalMessage ?? ''}
                                        onChange={(event) => updateDraft(item.id, { externalMessage: event.target.value })}
                                        className="mt-2 min-h-24 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900 disabled:bg-slate-100 disabled:text-slate-600"
                                      />
                                    </label>
                                  </section>
                                </div>

                                {item.status !== 'pending' ? (
                                  <div className="mt-4 flex flex-col gap-2 border-t border-slate-200 pt-3 text-sm text-slate-700 md:flex-row md:items-center md:justify-between">
                                    <div>
                                      <span className="font-medium">Hanterad:</span> {formatDateTime(item.reviewedAt)}
                                      <span className="mx-2 text-slate-300">|</span>
                                      <span className="font-medium">Kommentar:</span> {item.reviewNote ?? 'Ingen kommentar sparad.'}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                      {item.approvedBrfId ? (
                                        <Link href={`/admin/renoapp/brf/${item.approvedBrfId}`} className="font-semibold text-emerald-800 underline">
                                          Öppna föreningen
                                        </Link>
                                      ) : null}
                                      {item.status === 'rejected' ? (
                                        <button
                                          type="button"
                                          disabled={submittingId !== null}
                                          onClick={() => void handleAction(item.id, 'resend_decision')}
                                          className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-300 bg-white px-2 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                                        >
                                          <Mail size={13} />
                                          Skicka avslagsmejl igen
                                        </button>
                                      ) : null}
                                    </div>
                                  </div>
                                ) : null}

                                {result ? (
                                  <div className={`mt-4 rounded-md border p-3 text-sm ${result.request.status === 'approved' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>
                                    {result.request.status === 'approved' ? (
                                      <>
                                        <p className="font-semibold">BRF skapades och aktiveringslänk genererades.</p>
                                        {result.invite ? <p className="mt-1 break-all">Länk: {result.invite.inviteUrl}</p> : null}
                                        {result.invite?.emailSent ? <p className="mt-1">Godkännande- och invite-mejlet skickades.</p> : null}
                                        {result.invite?.emailError ? <p className="mt-1 text-amber-900">Mejlet kunde inte skickas: {result.invite.emailError}</p> : null}
                                      </>
                                    ) : (
                                      <>
                                        <p className="font-semibold">Intresseanmälan markerades som avslagen.</p>
                                        {result.decisionEmail?.emailSent ? <p className="mt-1">Avslagsmejl skickades till kontaktpersonen.</p> : null}
                                        {result.decisionEmail?.emailError ? <p className="mt-1 text-amber-900">Avslagsmejl kunde inte skickas: {result.decisionEmail.emailError}</p> : null}
                                      </>
                                    )}
                                  </div>
                                ) : null}
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      )
                    })}
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
                    onClick={() => setCurrentPage((current) => Math.max(1, current - 1))}
                    disabled={safePage <= 1}
                    className="rounded-md border border-gray-300 px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Föregående
                  </button>
                  <span>Sida {safePage} av {totalPages}</span>
                  <button
                    type="button"
                    onClick={() => setCurrentPage((current) => Math.min(totalPages, current + 1))}
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
