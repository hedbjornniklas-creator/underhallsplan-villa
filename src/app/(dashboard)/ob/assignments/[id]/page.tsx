'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import Protected from '@/components/Protected'

type AssignmentStatus = 'draft' | 'sent' | 'booked' | 'completed' | 'expired' | 'cancelled'
type AssignmentType = 'OB' | 'STATUS' | 'UHP'
type OrdererRole = 'buyer' | 'seller' | ''

type AssignmentDetails = {
  id: string
  org_id: string
  status: AssignmentStatus
  assignment_type: AssignmentType
  responsible_profile_id: string
  customer_name: string | null
  customer_email: string
  customer_phone: string | null
  customer_address: string | null
  preliminary_address: string | null
  preferred_date: string | null
  preferred_time: string | null
  price_amount: number | null
  currency: string
  property_address: string | null
  property_postal_code: string | null
  property_city: string | null
  property_municipality: string | null
  property_owner_name: string | null
  cadastral_id: string | null
  invoice_name: string | null
  invoice_address: string | null
  orderer_role: string | null
  personal_identity_number: string | null
  notes_internal: string | null
  terms_version: string | null
  accepted_at: string | null
  property_id: string | null
  inspection_id: string | null
  converted_at: string | null
  created_at: string
  updated_at: string
  last_sent_at: string | null
}

type FormState = {
  assignmentType: AssignmentType
  status: AssignmentStatus
  cadastralId: string
  propertyAddress: string
  propertyMunicipality: string
  propertyOwnerName: string
  customerName: string
  customerAddress: string
  customerPhone: string
  customerEmail: string
  ordererRole: OrdererRole
  preferredDate: string
  preferredTime: string
  priceAmount: string
  invoiceName: string
  invoiceAddress: string
  personalIdentityNumber: string
  notesInternal: string
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function jsonToErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string') {
    return payload.error
  }
  return fallback
}

function normalizeRole(value: string | null): OrdererRole {
  if (!value) return ''
  const lowered = value.toLowerCase()
  if (lowered.includes('köp') || lowered.includes('kop') || lowered.includes('buy')) return 'buyer'
  if (lowered.includes('sälj') || lowered.includes('salj') || lowered.includes('sell')) return 'seller'
  return ''
}

function roleToLabel(role: OrdererRole) {
  if (role === 'buyer') return 'Köpare'
  if (role === 'seller') return 'Säljare'
  return ''
}

function toFormState(assignment: AssignmentDetails): FormState {
  return {
    assignmentType: assignment.assignment_type,
    status: assignment.status,
    cadastralId: assignment.cadastral_id ?? '',
    propertyAddress: assignment.property_address ?? assignment.preliminary_address ?? '',
    propertyMunicipality: assignment.property_municipality ?? assignment.property_city ?? '',
    propertyOwnerName: assignment.property_owner_name ?? '',
    customerName: assignment.customer_name ?? '',
    customerAddress: assignment.customer_address ?? '',
    customerPhone: assignment.customer_phone ?? '',
    customerEmail: assignment.customer_email ?? '',
    ordererRole: normalizeRole(assignment.orderer_role),
    preferredDate: assignment.preferred_date ?? '',
    preferredTime: assignment.preferred_time ?? '',
    priceAmount: assignment.price_amount !== null ? String(assignment.price_amount) : '',
    invoiceName: assignment.invoice_name ?? '',
    invoiceAddress: assignment.invoice_address ?? '',
    personalIdentityNumber: assignment.personal_identity_number ?? '',
    notesInternal: assignment.notes_internal ?? '',
  }
}

export default function AssignmentDetailsPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const id = params.id

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendingCompleted, setSendingCompleted] = useState(false)
  const [converting, setConverting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [assignment, setAssignment] = useState<AssignmentDetails | null>(null)
  const [form, setForm] = useState<FormState | null>(null)

  const canSend = assignment?.status !== 'completed'
  const canSendCompleted = assignment?.status === 'completed'
  const canConvert = assignment?.status === 'booked' && !assignment.inspection_id

  const loadAssignment = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      setSuccess(null)

      const response = await fetch(`/api/ob/assignments/${id}`, { cache: 'no-store' })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(jsonToErrorMessage(payload, 'Kunde inte hämta uppdraget.'))
      }

      const row = (payload as { assignment: AssignmentDetails }).assignment
      setAssignment(row)
      setForm(toFormState(row))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Kunde inte hämta uppdraget.')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void loadAssignment()
  }, [loadAssignment])

  const summary = useMemo(() => {
    if (!assignment) return null
    const acceptedAt = assignment.accepted_at
      ? new Date(assignment.accepted_at).toLocaleString('sv-SE')
      : 'Inte accepterad'
    const sentAt = assignment.last_sent_at
      ? new Date(assignment.last_sent_at).toLocaleString('sv-SE')
      : 'Ej skickad'
    return { acceptedAt, sentAt }
  }, [assignment])

  const updateField = (key: keyof FormState, value: string) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev))
  }

  const handleSave = async () => {
    if (!form) return
    if (!EMAIL_REGEX.test(form.customerEmail.trim())) {
      setError('Ange en giltig kundmejl.')
      return
    }

    const parsedPrice =
      form.priceAmount.trim().length > 0 ? Number(form.priceAmount.trim().replace(',', '.')) : null
    if (parsedPrice !== null && (!Number.isFinite(parsedPrice) || parsedPrice < 0)) {
      setError('Ange ett giltigt pris.')
      return
    }

    try {
      setSaving(true)
      setError(null)
      setSuccess(null)

      const response = await fetch(`/api/ob/assignments/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignment_type: form.assignmentType,
          status: form.status,
          customer_name: form.customerName,
          customer_email: form.customerEmail,
          customer_phone: form.customerPhone,
          customer_address: form.customerAddress,
          property_address: form.propertyAddress,
          preliminary_address: form.propertyAddress,
          property_municipality: form.propertyMunicipality,
          property_owner_name: form.propertyOwnerName,
          cadastral_id: form.cadastralId,
          preferred_date: form.preferredDate,
          preferred_time: form.preferredTime,
          price_amount: parsedPrice,
          currency: 'SEK',
          orderer_role: roleToLabel(form.ordererRole),
          invoice_name: form.invoiceName,
          invoice_address: form.invoiceAddress,
          personal_identity_number: form.personalIdentityNumber,
          notes_internal: form.notesInternal,
        }),
      })

      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(jsonToErrorMessage(payload, 'Kunde inte spara uppdraget.'))
      }

      const updated = (payload as { assignment: AssignmentDetails }).assignment
      setAssignment(updated)
      setForm(toFormState(updated))
      setSuccess('Uppdraget sparades.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Kunde inte spara uppdraget.')
    } finally {
      setSaving(false)
    }
  }

  const handleSend = async () => {
    try {
      setSending(true)
      setError(null)
      setSuccess(null)
      const response = await fetch(`/api/ob/assignments/${id}/send`, { method: 'POST' })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(jsonToErrorMessage(payload, 'Kunde inte skicka uppdragsbekräftelsen.'))
      }
      await loadAssignment()
      setSuccess('Uppdragsbekräftelse skickad.')
    } catch (sendError) {
      setError(
        sendError instanceof Error ? sendError.message : 'Kunde inte skicka uppdragsbekräftelsen.'
      )
    } finally {
      setSending(false)
    }
  }

  const handleConvert = async () => {
    try {
      setConverting(true)
      setError(null)
      setSuccess(null)
      const response = await fetch(`/api/ob/assignments/${id}/convert`, { method: 'POST' })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(jsonToErrorMessage(payload, 'Kunde inte starta besiktning.'))
      }
      const body = payload as { propertyId?: string; inspectionId?: string }
      if (!body.propertyId || !body.inspectionId) {
        throw new Error('Konvertering saknar property/inspection-id.')
      }
      router.push(`/properties/${body.propertyId}/ob/${body.inspectionId}`)
    } catch (convertError) {
      setError(convertError instanceof Error ? convertError.message : 'Kunde inte starta besiktning.')
    } finally {
      setConverting(false)
    }
  }

  const handleSendCompleted = async () => {
    try {
      setSendingCompleted(true)
      setError(null)
      setSuccess(null)
      const response = await fetch(`/api/ob/assignments/${id}/send-completed`, { method: 'POST' })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(jsonToErrorMessage(payload, 'Kunde inte skicka slutmejl.'))
      }
      await loadAssignment()
      setSuccess('Slutmejl skickat.')
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Kunde inte skicka slutmejl.')
    } finally {
      setSendingCompleted(false)
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

        <div className="relative mx-auto w-full max-w-6xl space-y-4 p-4 md:p-6">
          <header className="rounded-2xl border border-white/30 bg-white/10 p-4 shadow-sm backdrop-blur-sm md:p-5">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => router.push('/ob/assignments')}
                aria-label="Tillbaka"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/50 bg-white/15 text-white transition hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
              >
                <ArrowLeft size={16} strokeWidth={2} />
              </button>
              <h1 className="text-2xl font-semibold text-white drop-shadow-sm">Uppdragsbekräftelse</h1>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving || loading || !form}
                  className="rounded-lg bg-white/95 px-3 py-2 text-sm font-medium text-gray-800 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? 'Sparar...' : 'Spara'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={!canSend || sending || loading}
                  className="rounded-lg border border-white/60 bg-white/15 px-3 py-2 text-sm font-medium text-white transition hover:bg-white/25 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {sending ? 'Skickar...' : 'Skicka uppdragsbekraftelse'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleSendCompleted()}
                  disabled={!canSendCompleted || sendingCompleted || loading}
                  className="rounded-lg border border-emerald-300 bg-emerald-500/20 px-3 py-2 text-sm font-medium text-white transition hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {sendingCompleted ? 'Skickar...' : 'Skicka klar-mejl'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleConvert()}
                  disabled={!canConvert || converting || loading}
                  className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
                >
                  {converting ? 'Startar...' : 'Starta besiktning'}
                </button>
              </div>
            </div>
          </header>

          {error ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>
          ) : null}
          {success ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
              {success}
            </div>
          ) : null}

          {loading || !form || !assignment ? (
            <div className="rounded-2xl border border-white/30 bg-white/85 p-5 text-sm text-gray-700">
              Laddar uppdrag...
            </div>
          ) : (
            <>
              <section className="space-y-4 rounded-2xl border border-white/30 bg-white/90 p-4 shadow-sm backdrop-blur md:p-5">
                <div className="grid gap-3 md:grid-cols-3">
                  <ReadOnly label="Status" value={assignment.status} />
                  <ReadOnly label="Skickad" value={summary?.sentAt ?? '-'} />
                  <ReadOnly label="Accepterad" value={summary?.acceptedAt ?? '-'} />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <SectionCard title="Objekt">
                    <Field
                      label="Fastighetsbeteckning"
                      value={form.cadastralId}
                      onChange={(value) => updateField('cadastralId', value)}
                    />
                    <Field
                      label="Adress"
                      value={form.propertyAddress}
                      onChange={(value) => updateField('propertyAddress', value)}
                    />
                    <Field
                      label="Kommun"
                      value={form.propertyMunicipality}
                      onChange={(value) => updateField('propertyMunicipality', value)}
                    />
                    <Field
                      label="Fastighetsägare"
                      value={form.propertyOwnerName}
                      onChange={(value) => updateField('propertyOwnerName', value)}
                    />
                  </SectionCard>

                  <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-gray-900">Uppdragsgivare</h3>
                      <div className="flex items-center gap-2">
                        <RoleChip
                          label="Säljare"
                          active={form.ordererRole === 'seller'}
                          onClick={() => updateField('ordererRole', 'seller')}
                        />
                        <RoleChip
                          label="Köpare"
                          active={form.ordererRole === 'buyer'}
                          onClick={() => updateField('ordererRole', 'buyer')}
                        />
                      </div>
                    </div>
                    <Field
                      label="Namn"
                      value={form.customerName}
                      onChange={(value) => updateField('customerName', value)}
                    />
                    <Field
                      label="Adress"
                      value={form.customerAddress}
                      onChange={(value) => updateField('customerAddress', value)}
                    />
                    <Field
                      label="Telefon"
                      value={form.customerPhone}
                      onChange={(value) => updateField('customerPhone', value)}
                      type="tel"
                    />
                    <Field
                      label="E-post"
                      value={form.customerEmail}
                      onChange={(value) => updateField('customerEmail', value)}
                      type="email"
                    />
                  </section>
                </div>

                <SectionCard title="Besiktningsdag">
                  <div className="grid gap-3 md:grid-cols-3">
                    <Field
                      label="Datum"
                      value={form.preferredDate}
                      onChange={(value) => updateField('preferredDate', value)}
                      type="date"
                    />
                    <Field
                      label="Tid"
                      value={form.preferredTime}
                      onChange={(value) => updateField('preferredTime', value)}
                      type="time"
                    />
                    <Field
                      label="Pris (SEK)"
                      value={form.priceAmount}
                      onChange={(value) => updateField('priceAmount', value)}
                      type="number"
                      step="0.01"
                      min="0"
                    />
                  </div>
                </SectionCard>
              </section>

            </>
          )}
        </div>
      </main>
    </Protected>
  )
}

function SectionCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      {children}
    </section>
  )
}

function RoleChip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'inline-flex h-[18px] items-center rounded-full border px-3 text-[11px] leading-none transition',
        active
          ? 'border-indigo-600 bg-indigo-600 text-white'
          : 'border-gray-300 bg-white text-gray-700 hover:border-indigo-400 hover:text-indigo-700',
      ].join(' ')}
    >
      {label}
    </button>
  )
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  step,
  min,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'date' | 'time' | 'email' | 'tel' | 'number'
  step?: string
  min?: string
}) {
  return (
    <label className="space-y-1">
      <span className="block text-xs font-medium text-gray-600">{label}</span>
      <input
        type={type}
        value={value}
        step={step}
        min={min}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
    </label>
  )
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
      <div className="text-xs font-medium text-gray-500">{label}</div>
      <div className="mt-0.5 text-sm text-gray-900">{value}</div>
    </div>
  )
}
