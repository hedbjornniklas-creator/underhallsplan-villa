'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Loader2, Mail, Plus, Send } from 'lucide-react'
import Protected from '@/components/Protected'

type AssignmentItem = {
  id: string
  org_id: string
  status: 'draft' | 'sent' | 'booked' | 'completed' | 'expired' | 'cancelled'
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

type Scope = 'upcoming' | 'done'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function getStatusLabel(status: AssignmentItem['status']) {
  switch (status) {
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

function isUpcoming(item: AssignmentItem) {
  return item.status !== 'completed'
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

export default function ObAssignmentsPage() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<AssignmentItem[]>([])
  const [scope, setScope] = useState<Scope>('upcoming')
  const [quickEmail, setQuickEmail] = useState('')
  const [quickSending, setQuickSending] = useState(false)
  const [quickError, setQuickError] = useState<string | null>(null)
  const [quickSuccess, setQuickSuccess] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

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

  const visibleItems = useMemo(() => {
    const filtered = scope === 'upcoming' ? items.filter(isUpcoming) : items.filter((item) => !isUpcoming(item))
    return [...filtered].sort((a, b) => {
      const dateA = new Date(a.preferred_date ?? a.created_at).getTime()
      const dateB = new Date(b.preferred_date ?? b.created_at).getTime()
      return dateA - dateB
    })
  }, [items, scope])

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

  const handleConvert = async (id: string) => {
    try {
      setBusyId(id)
      setError(null)
      const response = await fetch(`/api/ob/assignments/${id}/convert`, {
        method: 'POST',
      })
      const body = (await response.json().catch(() => ({}))) as {
        error?: string
        propertyId?: string
        inspectionId?: string
      }

      if (!response.ok || !body.propertyId || !body.inspectionId) {
        throw new Error(body.error ?? 'Kunde inte starta besiktning.')
      }

      router.push(`/properties/${body.propertyId}/ob/${body.inspectionId}`)
    } catch (convertError) {
      setError(
        convertError instanceof Error ? convertError.message : 'Kunde inte starta besiktning.'
      )
    } finally {
      setBusyId(null)
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

          <section className="rounded-2xl border border-white/30 bg-white/90 p-3 shadow-sm backdrop-blur md:p-4">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setScope('upcoming')}
                className={
                  scope === 'upcoming'
                    ? 'rounded-md border border-indigo-600 bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white'
                    : 'rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50'
                }
              >
                Bokade / Aktiva
              </button>
              <button
                type="button"
                onClick={() => setScope('done')}
                className={
                  scope === 'done'
                    ? 'rounded-md border border-indigo-600 bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white'
                    : 'rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50'
                }
              >
                Avklarade
              </button>
            </div>
          </section>

          {loading ? <div className="text-sm text-blue-100">Laddar uppdragsbekräftelser...</div> : null}
          {error && !loading ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>
          ) : null}

          {!loading && visibleItems.length === 0 ? (
            <div className="rounded-md border border-dashed border-white/40 bg-white/75 p-4 text-sm text-gray-700">
              Inga uppdragsbekräftelser i denna vy.
            </div>
          ) : null}

          {!loading && visibleItems.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-3 py-2">Datum</th>
                    <th className="px-3 py-2">Typ</th>
                    <th className="px-3 py-2">Kund</th>
                    <th className="px-3 py-2">Adress</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2 text-right">Åtgärder</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleItems.map((item) => {
                    const canConvert = item.status === 'booked' && !item.inspection_id
                    const canResend = item.status === 'draft' || item.status === 'sent'
                    const isBusy = busyId === item.id

                    return (
                      <tr key={item.id} className="border-b last:border-b-0 hover:bg-indigo-50/40">
                        <td className="px-3 py-2 align-top whitespace-nowrap">{formatDate(item)}</td>
                        <td className="px-3 py-2 align-top">{formatType(item.assignment_type)}</td>
                        <td className="px-3 py-2 align-top">
                          <div className="text-gray-900">{item.customer_name || 'Namn saknas'}</div>
                          <div className="text-xs text-gray-500">{item.customer_email}</div>
                        </td>
                        <td className="px-3 py-2 align-top text-gray-900">{getAddress(item)}</td>
                        <td className="px-3 py-2 align-top">
                          <span className="inline-flex rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
                            {getStatusLabel(item.status)}
                          </span>
                        </td>
                        <td className="px-3 py-2 align-top">
                          <div className="flex justify-end gap-2">
                            <Link
                              href={`/ob/assignments/${item.id}`}
                              className="rounded-md border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50"
                            >
                              Öppna
                            </Link>
                            {canResend ? (
                              <button
                                type="button"
                                onClick={() => void handleResend(item.id)}
                                disabled={isBusy}
                                className="rounded-md border border-indigo-300 px-2.5 py-1 text-xs text-indigo-700 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {isBusy ? 'Skickar...' : 'Skicka igen'}
                              </button>
                            ) : null}
                            {canConvert ? (
                              <button
                                type="button"
                                onClick={() => void handleConvert(item.id)}
                                disabled={isBusy}
                                className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
                              >
                                {isBusy ? 'Startar...' : 'Starta besiktning'}
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </main>
    </Protected>
  )
}
