'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Mail } from 'lucide-react'
import Protected from '@/components/Protected'

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

type StatusFilter = 'pending' | 'approved' | 'rejected' | 'all'

const FILTER_LABELS: Record<StatusFilter, string> = {
  pending: 'Väntande',
  approved: 'Godkända',
  rejected: 'Avslagna',
  all: 'Alla',
}

function formatDateTime(value: string | null) {
  if (!value) return '-'
  return new Date(value).toLocaleString('sv-SE')
}

export default function RenoAppAdminBrfRequestsPage() {
  const [items, setItems] = useState<RequestItem[]>([])
  const [pageLoading, setPageLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submittingId, setSubmittingId] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, DraftState>>({})
  const [resultById, setResultById] = useState<Record<string, ReviewResult>>({})
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    const loadItems = async () => {
      setPageLoading(true)
      setError(null)

      try {
        const response = await fetch('/api/renoapp/admin/brf-requests', { cache: 'no-store' })
        const payload = (await response.json().catch(() => ({}))) as { items?: RequestItem[]; error?: string }

        if (!response.ok) {
          throw new Error(payload.error ?? 'Kunde inte läsa BRF-intresseanmälningar.')
        }

        if (active) {
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
        }
      } catch (fetchError) {
        if (active) {
          setError(
            fetchError instanceof Error
              ? fetchError.message
              : 'Kunde inte läsa BRF-intresseanmälningar.'
          )
        }
      } finally {
        if (active) setPageLoading(false)
      }
    }

    void loadItems()

    return () => {
      active = false
    }
  }, [])

  const updateDraft = (id: string, reviewNote: string) => {
    setDrafts((current) => ({
      ...current,
      [id]: { ...current[id], reviewNote },
    }))
  }

  const handleAction = async (id: string, action: 'approve' | 'reject' | 'resend_decision') => {
    const reviewNote = drafts[id]?.reviewNote?.trim() ?? ''

    setSubmittingId(id)
    setError(null)

    try {
      const response = await fetch(`/api/renoapp/admin/brf-requests/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          reviewNote,
          externalMessage: drafts[id]?.externalMessage ?? '',
        }),
      })
      const payload = (await response.json().catch(() => ({}))) as ReviewResult & { error?: string }

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
      setStatusFilter(payload.request.status === 'pending' ? 'pending' : payload.request.status)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Kunde inte hantera intresseanmälan.')
    } finally {
      setSubmittingId(null)
    }
  }

  const counts = {
    pending: items.filter((item) => item.status === 'pending').length,
    approved: items.filter((item) => item.status === 'approved').length,
    rejected: items.filter((item) => item.status === 'rejected').length,
    all: items.length,
  }

  const filteredItems = items.filter((item) => statusFilter === 'all' || item.status === statusFilter)

  return (
    <Protected>
      <main className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6 md:py-10">
        <section className="rounded-[32px] border border-stone-200/80 bg-white/90 p-8 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">RenoApp Admin</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-stone-900">Intresseanmälningar</h1>
          <p className="mt-4 max-w-3xl text-base leading-8 text-stone-700">
            Väntande ansökningar är arbetskön. Godkända och avslagna ansökningar ligger kvar som historik.
          </p>
        </section>

        {pageLoading ? (
          <div className="mt-6 rounded-3xl border border-stone-200 bg-white/85 p-6 text-sm text-stone-600">
            Laddar intresseanmälningar...
          </div>
        ) : (
          <>
            {error ? (
              <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                {error}
              </div>
            ) : null}

            <section className="mt-6 rounded-[28px] border border-stone-200/80 bg-white/90 p-4 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)] md:p-5">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-stone-900">Granskningskö</h2>
                  <p className="mt-1 text-sm leading-6 text-stone-600">
                    Ett godkännande skickar en kombinerad länk för aktivering och slutförande av BRF-anslutningen.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(['pending', 'approved', 'rejected', 'all'] as StatusFilter[]).map((filterKey) => {
                    const active = statusFilter === filterKey
                    return (
                      <button
                        key={filterKey}
                        type="button"
                        onClick={() => setStatusFilter(filterKey)}
                        className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                          active
                            ? 'bg-stone-900 text-white'
                            : 'border border-stone-300 bg-white text-stone-700 hover:bg-stone-100'
                        }`}
                      >
                        {FILTER_LABELS[filterKey]} ({counts[filterKey]})
                      </button>
                    )
                  })}
                </div>
              </div>
            </section>

            <section className="mt-6 grid gap-3">
              {filteredItems.length === 0 ? (
                <article className="rounded-[28px] border border-stone-200/80 bg-white/85 p-6 text-sm text-stone-700 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
                  Inga BRF-intresseanmälningar hittades i den här vyn.
                </article>
              ) : (
                filteredItems.map((item) => {
                  const reviewNote = drafts[item.id]?.reviewNote ?? ''
                  const result = resultById[item.id]
                  const isExpanded = expandedId === item.id
                  const statusTone =
                    item.status === 'pending'
                      ? 'border-amber-200 bg-amber-50 text-amber-900'
                      : item.status === 'approved'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                        : 'border-rose-200 bg-rose-50 text-rose-900'

                  return (
                    <article
                      key={item.id}
                      className="rounded-[24px] border border-stone-200/80 bg-white/92 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]"
                    >
                      <div className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between md:p-5">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-lg font-semibold text-stone-900 md:text-xl">{item.name}</h2>
                            <span
                              className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${statusTone}`}
                            >
                              {FILTER_LABELS[item.status as Exclude<StatusFilter, 'all'>]}
                            </span>
                          </div>
                          <div className="mt-2 flex flex-col gap-1 text-sm text-stone-600 md:flex-row md:flex-wrap md:gap-x-4">
                            <span>{item.orgNumber ?? 'Org.nr saknas'}</span>
                            <span>{item.contactName}</span>
                            <span className="break-all">{item.contactEmail}</span>
                            <span>{item.contactPhone ?? 'Ingen telefon'}</span>
                          </div>
                        </div>

                        <div className="flex flex-col items-start gap-3 md:items-end">
                          <div className="text-sm text-stone-500">{formatDateTime(item.createdAt)}</div>
                          <div className="flex flex-wrap gap-2">
                            {item.status !== 'approved' ? (
                              <button
                                type="button"
                                onClick={() => void handleAction(item.id, 'approve')}
                                disabled={submittingId !== null}
                                className="rounded-full bg-stone-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {submittingId === item.id ? 'Sparar...' : 'Godkänn'}
                              </button>
                            ) : null}
                            {item.status === 'pending' ? (
                                <button
                                  type="button"
                                  onClick={() => void handleAction(item.id, 'reject')}
                                  disabled={submittingId !== null}
                                  className="rounded-full border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-800 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  Avslå
                                </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => setExpandedId((current) => (current === item.id ? null : item.id))}
                              className="rounded-full border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-100"
                            >
                              {isExpanded ? 'Dölj detaljer' : 'Visa mer'}
                            </button>
                          </div>
                        </div>
                      </div>

                      {isExpanded ? (
                        <div className="border-t border-stone-200/80 px-4 py-4 md:px-5">
                          <div className="grid gap-4 md:grid-cols-[1.15fr_0.85fr]">
                            <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4 text-sm text-stone-700">
                              <p>
                                <strong>Kontaktperson:</strong> {item.contactName}
                              </p>
                              <p className="mt-1 break-all">
                                <strong>E-post:</strong> {item.contactEmail}
                              </p>
                              <p className="mt-1">
                                <strong>Telefon:</strong> {item.contactPhone ?? 'Saknas'}
                              </p>
                              <p className="mt-1">
                                <strong>Adress:</strong> {item.address ?? 'Saknas'}
                              </p>
                              <p className="mt-1">
                                <strong>Meddelande:</strong> {item.message ?? 'Inget meddelande'}
                              </p>
                            </div>

                            <div className="rounded-2xl border border-stone-200 bg-white p-4">
                              <label className="block text-sm font-semibold text-stone-900">
                                Intern anteckning · endast HusHub
                                <textarea
                                  disabled={item.status !== 'pending' || submittingId !== null}
                                  value={reviewNote}
                                  onChange={(event) => updateDraft(item.id, event.target.value)}
                                  className="mt-3 min-h-[120px] w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
                                  placeholder="Intern anteckning"
                                />
                              </label>
                              <label className="mt-4 block text-sm font-semibold text-stone-900">
                                Meddelande till föreningen · skickas med beslutet
                                <textarea
                                  disabled={item.status !== 'pending' || submittingId !== null}
                                  value={drafts[item.id]?.externalMessage ?? ''}
                                  onChange={event => setDrafts(current => ({ ...current, [item.id]: { ...current[item.id], externalMessage: event.target.value } }))}
                                  className="mt-2 min-h-[100px] w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
                                />
                              </label>
                            </div>
                          </div>

                          {item.status !== 'pending' ? (
                            <div className="mt-4 rounded-2xl border border-stone-200 bg-stone-50 p-4 text-sm text-stone-700">
                              <p>
                                <strong>Hanterad:</strong> {formatDateTime(item.reviewedAt)}
                              </p>
                              <p className="mt-1">
                                <strong>Kommentar:</strong> {item.reviewNote ?? 'Ingen kommentar sparad.'}
                              </p>
                              {item.approvedBrfId ? (
                                <p className="mt-1">
                                  <Link href={`/admin/renoapp/brf/${item.approvedBrfId}`} className="font-semibold text-emerald-800 underline">Öppna föreningens administration</Link>
                                </p>
                              ) : null}
                              {item.status === 'rejected' && <button type="button" disabled={submittingId !== null} onClick={() => void handleAction(item.id, 'resend_decision')} className="mt-3 inline-flex items-center gap-2 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-medium disabled:opacity-50"><Mail size={16} />Skicka avslagsmejl igen</button>}
                            </div>
                          ) : null}

                          {result ? (
                            <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                              {result.request.status === 'approved' ? (
                                <>
                                  <p className="font-semibold">BRF skapades och aktiveringslänk genererades.</p>
                                  {result.invite ? <p className="mt-1 break-all">Länk: {result.invite.inviteUrl}</p> : null}
                                  {result.invite?.emailSent ? (
                                    <p className="mt-1">Det kombinerade godkännande- och invite-mejlet skickades.</p>
                                  ) : null}
                                  {result.invite?.emailError ? (
                                    <p className="mt-1 text-amber-900">
                                      Mejlet kunde inte skickas: {result.invite.emailError}
                                    </p>
                                  ) : null}
                                </>
                              ) : (
                                <>
                                  <p className="font-semibold">Intresseanmälan markerades som avslagen.</p>
                                  {result.decisionEmail?.emailSent ? (
                                    <p className="mt-1">Avslagsmejl skickades till kontaktpersonen.</p>
                                  ) : null}
                                  {result.decisionEmail?.emailError ? (
                                    <p className="mt-1 text-amber-900">
                                      Avslagsmejl kunde inte skickas: {result.decisionEmail.emailError}
                                    </p>
                                  ) : null}
                                </>
                              )}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </article>
                  )
                })
              )}
            </section>

            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/admin/renoapp/brf/create"
                className="rounded-full border border-stone-300 px-4 py-3 text-sm font-semibold text-stone-800 transition hover:bg-stone-100"
              >
                Skapa BRF manuellt
              </Link>
            </div>
          </>
        )}
      </main>
    </Protected>
  )
}
