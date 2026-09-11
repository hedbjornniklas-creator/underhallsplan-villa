'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowLeft,
  CalendarDays,
  CircleDollarSign,
  ExternalLink,
  FileText,
  Mail,
  MapPin,
  ShieldCheck,
  UserRound,
} from 'lucide-react'
import Protected from '@/components/Protected'
import type { AssignmentDetails } from '@/lib/assignments/server'

type DetailResponse = {
  assignment: AssignmentDetails
  customerType: 'consumer' | 'business' | null
  currentTerms: {
    version: string
    documentHash: string
    text: string
    matchesAcceptedVersion: boolean
  }
  withdrawal: {
    requestedAt: string
    receiptEmail: string
    receiptSentAt: string | null
    status: 'received' | 'resolved' | 'rejected'
    resolvedAt: string | null
    resolutionNote: string | null
  } | null
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Utkast',
  sent: 'Skickad',
  ordered: 'Godkänd',
  booked: 'Bokad',
  completed: 'Startad',
  expired: 'Utgången länk',
  cancelled: 'Avbruten',
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'Ej angivet'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('sv-SE')
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'Ej registrerat'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

function display(value: string | null | undefined) {
  return value?.trim() || 'Ej angivet'
}

function address(parts: Array<string | null | undefined>) {
  return parts.filter((part): part is string => Boolean(part?.trim())).join(', ') || 'Ej angivet'
}

function money(value: number | null, currency: string, customerType: DetailResponse['customerType']) {
  if (value === null || !Number.isFinite(value)) return 'Ej angivet'
  const formatted = `${value.toLocaleString('sv-SE', { maximumFractionDigits: 2 })} ${currency || 'SEK'}`
  return customerType === 'consumer' ? `${formatted} inklusive moms` : formatted
}

function organizationUrl(path: string, organizationId: string) {
  const separator = path.includes('?') ? '&' : '?'
  return `${path}${separator}orgId=${encodeURIComponent(organizationId)}`
}

export default function TuAssignmentDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const organizationId = searchParams.get('orgId')
  const [data, setData] = useState<DetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      if (!organizationId) return
      try {
        setLoading(true)
        setError(null)
        setData(null)
        const response = await fetch(
          organizationUrl(`/api/tu/assignments/${encodeURIComponent(params.id)}`, organizationId),
          { cache: 'no-store', signal: controller.signal }
        )
        const payload = (await response.json().catch(() => ({}))) as Partial<DetailResponse> & {
          error?: string
        }
        if (!response.ok || !payload.assignment || !payload.currentTerms) {
          throw new Error(payload.error ?? 'Kunde inte hämta uppdragsbekräftelsen.')
        }
        if (payload.assignment.org_id !== organizationId) {
          throw new Error('Uppdraget tillhör inte den valda organisationen.')
        }
        if (!controller.signal.aborted) setData(payload as DetailResponse)
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Kunde inte hämta uppdragsbekräftelsen.'
          )
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void load()
    return () => controller.abort()
  }, [organizationId, params.id])

  const assignment = data?.assignment
  const isApartment = Boolean(assignment?.brf_name || assignment?.apartment_number)

  return (
    <Protected>
      <main className="min-h-full bg-gradient-to-br from-slate-50 via-white to-violet-50/60">
        <div className="mx-auto w-full max-w-6xl space-y-4 p-4 md:p-6">
          <header className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm md:p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={() =>
                  router.push(
                    organizationId
                      ? organizationUrl('/tu/assignments', organizationId)
                      : '/tu/assignments'
                  )
                }
                aria-label="Till uppdragsbekräftelser"
                title="Till uppdragsbekräftelser"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
              >
                <ArrowLeft size={17} aria-hidden />
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase text-violet-700">Teknisk utredning</p>
                <h1 className="mt-1 text-2xl font-semibold text-slate-950">Uppdragsbekräftelse</h1>
                {assignment ? (
                  <p className="mt-1 break-words text-sm text-slate-600">
                    {display(assignment.customer_name)} ·{' '}
                    {address([
                      assignment.property_address ?? assignment.preliminary_address,
                      assignment.property_city,
                    ])}
                  </p>
                ) : null}
              </div>
              {assignment ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-900">
                    {STATUS_LABELS[assignment.status] ?? assignment.status}
                  </span>
                  {assignment.inspection_id ? (
                    <button
                      type="button"
                      onClick={() =>
                        router.push(
                          organizationId
                            ? organizationUrl(
                                `/tu/investigations/${assignment.inspection_id}`,
                                organizationId
                              )
                            : `/tu/investigations/${assignment.inspection_id}`
                        )
                      }
                      className="inline-flex h-10 items-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
                    >
                      <ExternalLink size={16} aria-hidden />
                      Öppna utredning
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </header>

          {loading ? (
            <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600">
              Laddar uppdragsbekräftelsen...
            </div>
          ) : null}
          {error ? (
            <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
              {error}
            </div>
          ) : null}

          {assignment && data ? (
            <>
              <section className="grid gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 sm:grid-cols-2 lg:grid-cols-4">
                <SummaryCell label="Skapad" value={formatDateTime(assignment.created_at)} />
                <SummaryCell label="Senast skickad" value={formatDateTime(assignment.last_sent_at)} />
                <SummaryCell label="Godkänd" value={formatDateTime(assignment.accepted_at)} />
                <SummaryCell
                  label="Beställartyp"
                  value={data.customerType === 'consumer' ? 'Privatperson' : 'Företag/organisation'}
                />
              </section>

              {data.withdrawal ? (
                <section className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
                  <h2 className="font-semibold">Begäran att frånträda avtalet är registrerad</h2>
                  <p className="mt-1 leading-6">
                    Mottagen {formatDateTime(data.withdrawal.requestedAt)}. Bekräftelse:{' '}
                    {data.withdrawal.receiptSentAt
                      ? `skickad till ${data.withdrawal.receiptEmail}`
                      : `inte skickad till ${data.withdrawal.receiptEmail}`}.
                  </p>
                  {data.withdrawal.resolutionNote ? (
                    <p className="mt-2 whitespace-pre-wrap">{data.withdrawal.resolutionNote}</p>
                  ) : null}
                </section>
              ) : null}

              <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                <DetailSection icon={<MapPin size={18} aria-hidden />} title="Objekt">
                  <FactGrid>
                    <Fact label="Adress" value={address([assignment.property_address ?? assignment.preliminary_address, assignment.property_postal_code, assignment.property_city])} />
                    <Fact label="Kommun" value={display(assignment.property_municipality)} />
                    {isApartment ? (
                      <>
                        <Fact label="Bostadsrättsförening" value={display(assignment.brf_name)} />
                        <Fact label="Lägenhetsnummer" value={display(assignment.apartment_number)} />
                        <Fact label="Bostadsrättsinnehavare" value={display(assignment.apartment_holder_name)} />
                      </>
                    ) : (
                      <>
                        <Fact label="Fastighetsbeteckning" value={display(assignment.cadastral_id)} />
                        <Fact label="Fastighetsägare" value={display(assignment.property_owner_name)} />
                      </>
                    )}
                  </FactGrid>
                </DetailSection>

                <DetailSection icon={<UserRound size={18} aria-hidden />} title="Beställare">
                  <FactGrid>
                    <Fact label="Namn" value={display(assignment.customer_name)} />
                    <Fact label="E-post" value={assignment.customer_email} breakAll />
                    <Fact label="Telefon" value={display(assignment.customer_phone)} />
                    <Fact label="Adress" value={address([assignment.customer_address, assignment.customer_postal_code, assignment.customer_city])} />
                  </FactGrid>
                </DetailSection>

                <DetailSection icon={<CalendarDays size={18} aria-hidden />} title="Tid och pris">
                  <FactGrid>
                    <Fact label="Datum" value={formatDate(assignment.preferred_date)} />
                    <Fact label="Tid" value={display(assignment.preferred_time)} />
                    <Fact label="Pris" value={money(assignment.price_amount, assignment.currency, data.customerType)} />
                  </FactGrid>
                </DetailSection>

                <DetailSection icon={<FileText size={18} aria-hidden />} title="Utredningens omfattning">
                  <p className="whitespace-pre-wrap text-sm leading-6 text-slate-800 [overflow-wrap:anywhere]">
                    {display(assignment.scope_description)}
                  </p>
                </DetailSection>

                <DetailSection icon={<CircleDollarSign size={18} aria-hidden />} title="Fakturering">
                  <FactGrid>
                    <Fact label="Fakturanamn" value={display(assignment.invoice_name)} />
                    <Fact label="Faktura-e-post" value={display(assignment.invoice_email)} breakAll />
                    <Fact label="Fakturaadress" value={display(assignment.invoice_address)} />
                    <Fact label="Person-/organisationsnummer" value={display(assignment.personal_identity_number)} />
                  </FactGrid>
                </DetailSection>

                {assignment.notes_internal ? (
                  <DetailSection icon={<Mail size={18} aria-hidden />} title="Intern anteckning">
                    <p className="whitespace-pre-wrap text-sm leading-6 text-slate-800 [overflow-wrap:anywhere]">
                      {assignment.notes_internal}
                    </p>
                  </DetailSection>
                ) : null}

                <DetailSection icon={<ShieldCheck size={18} aria-hidden />} title="Villkor och godkännande">
                  <FactGrid>
                    <Fact label="Villkorsversion" value={display(assignment.terms_version ?? data.currentTerms.version)} />
                    <Fact label="Dokumentfingeravtryck" value={display(assignment.terms_document_hash ?? data.currentTerms.documentHash)} breakAll />
                  </FactGrid>
                  {!data.currentTerms.matchesAcceptedVersion ? (
                    <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">
                      Bekräftelsen godkändes med en äldre villkorsversion. Den nuvarande texten visas därför inte som om den vore den godkända versionen.
                    </p>
                  ) : (
                    <details className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <summary className="cursor-pointer text-sm font-semibold text-slate-800">
                        Visa villkorstexten
                      </summary>
                      <pre className="mt-3 max-h-[32rem] overflow-auto whitespace-pre-wrap text-xs leading-6 text-slate-700 [overflow-wrap:anywhere]">
                        {data.currentTerms.text}
                      </pre>
                    </details>
                  )}
                </DetailSection>
              </section>
            </>
          ) : null}
        </div>
      </main>
    </Protected>
  )
}

function SummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 bg-white px-4 py-3">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-slate-900">{value}</p>
    </div>
  )
}

function DetailSection({
  icon,
  title,
  children,
}: {
  icon: ReactNode
  title: string
  children: ReactNode
}) {
  return (
    <section className="border-b border-slate-200 p-4 last:border-b-0 md:p-5">
      <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-slate-950">
        <span className="text-violet-700">{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  )
}

function FactGrid({ children }: { children: ReactNode }) {
  return <dl className="grid gap-x-6 gap-y-4 md:grid-cols-2">{children}</dl>
}

function Fact({ label, value, breakAll = false }: { label: string; value: string; breakAll?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className={`mt-1 text-sm text-slate-900 ${breakAll ? 'break-all' : 'break-words'}`}>
        {value}
      </dd>
    </div>
  )
}
