'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'

type AcceptState = 'open' | 'used' | 'expired' | 'revoked'

type AssignmentSummary = {
  id: string
  status: string
  assignment_type: string
  customer_name: string | null
  customer_email: string
  customer_phone: string | null
  preliminary_address: string | null
  preferred_date: string | null
  preferred_time: string | null
  property_address: string | null
  property_postal_code: string | null
  property_city: string | null
  accepted_at: string | null
}

type AcceptReadResponse = {
  state: AcceptState
  expiresAt: string | null
  usedAt: string | null
  assignment: AssignmentSummary
}

type FormState = {
  customerName: string
  customerPhone: string
  propertyAddress: string
  propertyPostalCode: string
  propertyCity: string
  cadastralId: string
  invoiceName: string
  invoiceAddress: string
  ordererRole: string
  personalIdentityNumber: string
  termsAccepted: boolean
}

function toFormState(assignment: AssignmentSummary): FormState {
  return {
    customerName: assignment.customer_name ?? '',
    customerPhone: assignment.customer_phone ?? '',
    propertyAddress: assignment.property_address ?? assignment.preliminary_address ?? '',
    propertyPostalCode: assignment.property_postal_code ?? '',
    propertyCity: assignment.property_city ?? '',
    cadastralId: '',
    invoiceName: '',
    invoiceAddress: '',
    ordererRole: '',
    personalIdentityNumber: '',
    termsAccepted: false,
  }
}

export default function AssignmentAcceptPage() {
  const params = useParams<{ token: string }>()
  const token = params.token

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [data, setData] = useState<AcceptReadResponse | null>(null)
  const [form, setForm] = useState<FormState | null>(null)

  const canSubmit = data?.state === 'open'

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true)
        setError(null)

        const response = await fetch(`/api/assignments/accept/${token}`, { cache: 'no-store' })
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string
        } & Partial<AcceptReadResponse>

        if (!response.ok) {
          throw new Error(payload.error ?? 'Kunde inte läsa uppdragslänken.')
        }

        const resolved = payload as AcceptReadResponse
        setData(resolved)
        setForm(toFormState(resolved.assignment))
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Kunde inte läsa uppdragslänken.')
      } finally {
        setLoading(false)
      }
    }

    void load()
  }, [token])

  const stateText = useMemo(() => {
    if (!data) return ''
    if (data.state === 'used') return 'Den här länken är redan använd.'
    if (data.state === 'expired') return 'Den här länken har gått ut.'
    if (data.state === 'revoked') return 'Den här länken är inte längre aktiv.'
    return ''
  }, [data])

  const updateField = (key: keyof FormState, value: string | boolean) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev))
  }

  const handleSubmit = async () => {
    if (!form || !canSubmit) return
    if (!form.termsAccepted) {
      setError('Du måste acceptera villkoren för att fortsätta.')
      return
    }
    if (!form.propertyAddress.trim() || !form.propertyPostalCode.trim() || !form.propertyCity.trim()) {
      setError('Adress, postnummer och ort är obligatoriska.')
      return
    }

    try {
      setSaving(true)
      setError(null)
      setSuccess(null)

      const response = await fetch(`/api/assignments/accept/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: form.customerName,
          customerPhone: form.customerPhone,
          propertyAddress: form.propertyAddress,
          propertyPostalCode: form.propertyPostalCode,
          propertyCity: form.propertyCity,
          cadastralId: form.cadastralId,
          invoiceName: form.invoiceName,
          invoiceAddress: form.invoiceAddress,
          ordererRole: form.ordererRole,
          personalIdentityNumber: form.personalIdentityNumber,
          termsAccepted: form.termsAccepted,
          termsVersion: 'v1',
        }),
      })

      const payload = (await response.json().catch(() => ({}))) as { error?: string }

      if (!response.ok) {
        throw new Error(payload.error ?? 'Kunde inte acceptera uppdraget.')
      }

      setSuccess('Tack. Uppdragsbekräftelsen är registrerad.')
      setData((prev) => (prev ? { ...prev, state: 'used' } : prev))
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Kunde inte acceptera uppdraget.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(100% 70% at 50% 0%, rgba(219,234,254,0.6) 0%, rgba(219,234,254,0) 60%), linear-gradient(145deg, #f4f7ff 0%, #eef4ff 42%, #f6f8ff 100%)',
        }}
      />
      <div className="relative mx-auto w-full max-w-3xl p-4 md:p-8">
        <section className="rounded-2xl border border-indigo-100 bg-white/95 p-5 shadow-xl backdrop-blur-sm md:p-7">
          <h1 className="text-2xl font-semibold text-gray-900">Uppdragsbekräftelse</h1>
          <p className="mt-2 text-sm text-gray-600">
            Fyll i uppgifterna nedan och bekräfta att du accepterar villkoren.
          </p>

          {loading ? <p className="mt-4 text-sm text-gray-600">Laddar uppdrag...</p> : null}
          {error ? <p className="mt-4 rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
          {success ? (
            <p className="mt-4 rounded-md bg-emerald-50 p-3 text-sm text-emerald-700">{success}</p>
          ) : null}

          {!loading && data && form ? (
            <div className="mt-5 space-y-4">
              {stateText ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  {stateText}
                </div>
              ) : null}

              <div className="grid gap-3 md:grid-cols-2">
                <ReadOnly label="Typ" value={data.assignment.assignment_type} />
                <ReadOnly label="Kundmejl" value={data.assignment.customer_email} />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <Field
                  label="Namn"
                  value={form.customerName}
                  onChange={(value) => updateField('customerName', value)}
                  disabled={!canSubmit}
                />
                <Field
                  label="Telefon"
                  value={form.customerPhone}
                  onChange={(value) => updateField('customerPhone', value)}
                  disabled={!canSubmit}
                />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <Field
                  label="Adress *"
                  value={form.propertyAddress}
                  onChange={(value) => updateField('propertyAddress', value)}
                  disabled={!canSubmit}
                />
                <Field
                  label="Fastighetsbeteckning"
                  value={form.cadastralId}
                  onChange={(value) => updateField('cadastralId', value)}
                  disabled={!canSubmit}
                />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <Field
                  label="Postnummer *"
                  value={form.propertyPostalCode}
                  onChange={(value) => updateField('propertyPostalCode', value)}
                  disabled={!canSubmit}
                />
                <Field
                  label="Ort *"
                  value={form.propertyCity}
                  onChange={(value) => updateField('propertyCity', value)}
                  disabled={!canSubmit}
                />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <Field
                  label="Fakturanamn"
                  value={form.invoiceName}
                  onChange={(value) => updateField('invoiceName', value)}
                  disabled={!canSubmit}
                />
                <Field
                  label="Fakturaadress"
                  value={form.invoiceAddress}
                  onChange={(value) => updateField('invoiceAddress', value)}
                  disabled={!canSubmit}
                />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <Field
                  label="Beställarroll"
                  value={form.ordererRole}
                  onChange={(value) => updateField('ordererRole', value)}
                  disabled={!canSubmit}
                />
                <Field
                  label="Personnummer"
                  value={form.personalIdentityNumber}
                  onChange={(value) => updateField('personalIdentityNumber', value)}
                  disabled={!canSubmit}
                />
              </div>

              <label className="mt-1 flex items-start gap-2 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={form.termsAccepted}
                  onChange={(event) => updateField('termsAccepted', event.target.checked)}
                  disabled={!canSubmit}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300"
                />
                <span>
                  Jag accepterar villkoren för uppdraget och godkänner att uppgifterna sparas för
                  administration av besiktningen.
                </span>
              </label>

              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={!canSubmit || saving}
                className="inline-flex h-10 items-center justify-center rounded-lg bg-indigo-600 px-5 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
              >
                {saving ? 'Sparar...' : 'Acceptera uppdrag'}
              </button>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  )
}

function Field({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  return (
    <label className="space-y-1">
      <span className="block text-xs font-medium text-gray-600">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:bg-gray-100"
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
