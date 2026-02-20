'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import Protected from '@/components/Protected'

type AssignmentStatus = 'draft' | 'sent' | 'booked' | 'completed' | 'expired' | 'cancelled'
type AssignmentType = 'OB' | 'STATUS' | 'UHP'

type AssignmentDetails = {
  id: string
  org_id: string
  status: AssignmentStatus
  assignment_type: AssignmentType
  responsible_profile_id: string
  customer_name: string | null
  customer_email: string
  customer_phone: string | null
  preliminary_address: string | null
  preferred_date: string | null
  preferred_time: string | null
  property_address: string | null
  property_postal_code: string | null
  property_city: string | null
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
  price_amount: number | null
  currency: string
}

type FormState = {
  customerName: string
  customerEmail: string
  customerPhone: string
  preliminaryAddress: string
  preferredDate: string
  preferredTime: string
  propertyAddress: string
  propertyPostalCode: string
  propertyCity: string
  cadastralId: string
  invoiceName: string
  invoiceAddress: string
  ordererRole: string
  personalIdentityNumber: string
  notesInternal: string
  assignmentType: AssignmentType
  status: AssignmentStatus
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function jsonToErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string') {
    return payload.error
  }
  return fallback
}

function toFormState(assignment: AssignmentDetails): FormState {
  return {
    customerName: assignment.customer_name ?? '',
    customerEmail: assignment.customer_email ?? '',
    customerPhone: assignment.customer_phone ?? '',
    preliminaryAddress: assignment.preliminary_address ?? '',
    preferredDate: assignment.preferred_date ?? '',
    preferredTime: assignment.preferred_time ?? '',
    propertyAddress: assignment.property_address ?? '',
    propertyPostalCode: assignment.property_postal_code ?? '',
    propertyCity: assignment.property_city ?? '',
    cadastralId: assignment.cadastral_id ?? '',
    invoiceName: assignment.invoice_name ?? '',
    invoiceAddress: assignment.invoice_address ?? '',
    ordererRole: assignment.orderer_role ?? '',
    personalIdentityNumber: assignment.personal_identity_number ?? '',
    notesInternal: assignment.notes_internal ?? '',
    assignmentType: assignment.assignment_type,
    status: assignment.status,
  }
}

export default function AssignmentDetailsPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const id = params.id

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [converting, setConverting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [assignment, setAssignment] = useState<AssignmentDetails | null>(null)
  const [form, setForm] = useState<FormState | null>(null)

  const canSend = assignment?.status !== 'completed'
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

    try {
      setSaving(true)
      setError(null)
      setSuccess(null)

      const response = await fetch(`/api/ob/assignments/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_name: form.customerName,
          customer_email: form.customerEmail,
          customer_phone: form.customerPhone,
          preliminary_address: form.preliminaryAddress,
          preferred_date: form.preferredDate,
          preferred_time: form.preferredTime,
          property_address: form.propertyAddress,
          property_postal_code: form.propertyPostalCode,
          property_city: form.propertyCity,
          cadastral_id: form.cadastralId,
          invoice_name: form.invoiceName,
          invoice_address: form.invoiceAddress,
          orderer_role: form.ordererRole,
          personal_identity_number: form.personalIdentityNumber,
          notes_internal: form.notesInternal,
          assignment_type: form.assignmentType,
          status: form.status,
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
        sendError instanceof Error
          ? sendError.message
          : 'Kunde inte skicka uppdragsbekräftelsen.'
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
              <h1 className="text-2xl font-semibold text-white drop-shadow-sm">
                Uppdragsbekräftelse
              </h1>
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
                  {sending ? 'Skickar...' : 'Skicka uppdragsbekräftelse'}
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
            <section className="space-y-4 rounded-2xl border border-white/30 bg-white/90 p-4 shadow-sm backdrop-blur md:p-5">
              <div className="grid gap-3 md:grid-cols-3">
                <ReadOnly label="Status" value={assignment.status} />
                <ReadOnly label="Skickad" value={summary?.sentAt ?? '-'} />
                <ReadOnly label="Accepterad" value={summary?.acceptedAt ?? '-'} />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <Field
                  label="Kundnamn"
                  value={form.customerName}
                  onChange={(value) => updateField('customerName', value)}
                />
                <Field
                  label="Kundmejl"
                  value={form.customerEmail}
                  onChange={(value) => updateField('customerEmail', value)}
                  required
                />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <Field
                  label="Kundtelefon"
                  value={form.customerPhone}
                  onChange={(value) => updateField('customerPhone', value)}
                />
                <Field
                  label="Preliminär adress"
                  value={form.preliminaryAddress}
                  onChange={(value) => updateField('preliminaryAddress', value)}
                />
              </div>

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
                <SelectField
                  label="Typ"
                  value={form.assignmentType}
                  onChange={(value) => updateField('assignmentType', value as AssignmentType)}
                  options={[
                    { value: 'OB', label: 'ÖB' },
                    { value: 'STATUS', label: 'Status' },
                    { value: 'UHP', label: 'UHP' },
                  ]}
                />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <Field
                  label="Fastighetsadress"
                  value={form.propertyAddress}
                  onChange={(value) => updateField('propertyAddress', value)}
                />
                <Field
                  label="Fastighetsbeteckning"
                  value={form.cadastralId}
                  onChange={(value) => updateField('cadastralId', value)}
                />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <Field
                  label="Postnummer"
                  value={form.propertyPostalCode}
                  onChange={(value) => updateField('propertyPostalCode', value)}
                />
                <Field
                  label="Ort"
                  value={form.propertyCity}
                  onChange={(value) => updateField('propertyCity', value)}
                />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <Field
                  label="Fakturanamn"
                  value={form.invoiceName}
                  onChange={(value) => updateField('invoiceName', value)}
                />
                <Field
                  label="Fakturaadress"
                  value={form.invoiceAddress}
                  onChange={(value) => updateField('invoiceAddress', value)}
                />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <Field
                  label="Beställarroll"
                  value={form.ordererRole}
                  onChange={(value) => updateField('ordererRole', value)}
                />
                <Field
                  label="Personnummer"
                  value={form.personalIdentityNumber}
                  onChange={(value) => updateField('personalIdentityNumber', value)}
                />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <SelectField
                  label="Status"
                  value={form.status}
                  onChange={(value) => updateField('status', value as AssignmentStatus)}
                  options={[
                    { value: 'draft', label: 'Utkast' },
                    { value: 'sent', label: 'Skickad' },
                    { value: 'booked', label: 'Bokad' },
                    { value: 'completed', label: 'Avklarad' },
                    { value: 'expired', label: 'Utgången' },
                    { value: 'cancelled', label: 'Avbruten' },
                  ]}
                />
                <Field
                  label="Intern anteckning"
                  value={form.notesInternal}
                  onChange={(value) => updateField('notesInternal', value)}
                />
              </div>
            </section>
          )}
        </div>
      </main>
    </Protected>
  )
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  required = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'date' | 'time'
  required?: boolean
}) {
  return (
    <label className="space-y-1">
      <span className="block text-xs font-medium text-gray-600">
        {label}
        {required ? ' *' : ''}
      </span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
    </label>
  )
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <label className="space-y-1">
      <span className="block text-xs font-medium text-gray-600">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
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
