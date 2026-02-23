'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useParams } from 'next/navigation'

type AcceptState = 'open' | 'used' | 'expired' | 'revoked' | 'outdated'
type OrdererRole = 'buyer' | 'seller' | 'apartment' | ''

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type AssignmentSummary = {
  id: string
  status: string
  assignment_type: string
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
  orderer_role: string | null
  accepted_at: string | null
}

type TermsDocument = {
  hash: string
  text: string
  templateId: string
}

type AcceptReadResponse = {
  state: AcceptState
  expiresAt: string | null
  usedAt: string | null
  assignment: AssignmentSummary
  terms: {
    version: string
    documents: {
      seller: TermsDocument
      buyer: TermsDocument
      apartment: TermsDocument
    }
  }
}

type FormState = {
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
  termsAccepted: boolean
}

function normalizeRole(value: string | null): OrdererRole {
  if (!value) return ''
  const lowered = value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

  if (lowered.includes('buy') || lowered.includes('kop')) return 'buyer'
  if (lowered.includes('apt') || lowered.includes('apartment') || lowered.includes('lagenhet')) {
    return 'apartment'
  }
  if (lowered.includes('sell') || lowered.includes('salj')) return 'seller'
  return ''
}

function toFormState(assignment: AssignmentSummary): FormState {
  const role = normalizeRole(assignment.orderer_role)
  return {
    cadastralId: assignment.cadastral_id ?? '',
    propertyAddress: assignment.property_address ?? assignment.preliminary_address ?? '',
    propertyMunicipality: assignment.property_municipality ?? assignment.property_city ?? '',
    propertyOwnerName: assignment.property_owner_name ?? '',
    customerName: assignment.customer_name ?? '',
    customerAddress: assignment.customer_address ?? '',
    customerPhone: assignment.customer_phone ?? '',
    customerEmail: assignment.customer_email ?? '',
    ordererRole: role || 'seller',
    preferredDate: assignment.preferred_date ?? '',
    preferredTime: assignment.preferred_time ?? '',
    priceAmount: assignment.price_amount !== null ? String(assignment.price_amount) : '',
    termsAccepted: false,
  }
}

function roleToPayloadValue(role: OrdererRole) {
  if (role === 'buyer') return 'Köpare'
  if (role === 'apartment') return 'Lägenhet'
  if (role === 'seller') return 'Säljare'
  return ''
}

function roleToLabel(role: OrdererRole) {
  if (role === 'buyer') return 'Köpare'
  if (role === 'apartment') return 'Lägenhet'
  if (role === 'seller') return 'Säljare'
  return ''
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
    if (data.state === 'outdated') {
      return 'Villkoren har uppdaterats. Be besiktningsföretaget skicka en ny länk.'
    }
    return ''
  }, [data])

  const activeTerms = useMemo(() => {
    if (!data || !form) return null
    if (form.ordererRole === 'buyer') return data.terms.documents.buyer
    if (form.ordererRole === 'apartment') return data.terms.documents.apartment
    return data.terms.documents.seller
  }, [data, form])

  const updateField = (key: keyof FormState, value: string | boolean) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev))
  }

  const handleSubmit = async () => {
    if (!form || !data || !canSubmit || !activeTerms) return

    if (!form.termsAccepted) {
      setError(`Du måste acceptera villkoren (version ${data.terms.version}) för att fortsätta.`)
      return
    }

    const requiredFieldMissing =
      !form.cadastralId.trim() ||
      !form.propertyAddress.trim() ||
      !form.propertyMunicipality.trim() ||
      !form.propertyOwnerName.trim() ||
      !form.customerName.trim() ||
      !form.customerAddress.trim() ||
      !form.customerPhone.trim() ||
      !form.customerEmail.trim() ||
      !form.preferredDate.trim() ||
      !form.preferredTime.trim() ||
      !form.priceAmount.trim() ||
      !form.ordererRole

    if (requiredFieldMissing) {
      setError('Fyll i alla obligatoriska fält.')
      return
    }

    if (!EMAIL_REGEX.test(form.customerEmail.trim())) {
      setError('Ange en giltig e-postadress.')
      return
    }

    const numericPrice = Number(form.priceAmount.replace(',', '.'))
    if (!Number.isFinite(numericPrice) || numericPrice < 0) {
      setError('Ange ett giltigt pris.')
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
          assignmentId: data.assignment.id,
          cadastralId: form.cadastralId,
          propertyAddress: form.propertyAddress,
          propertyMunicipality: form.propertyMunicipality,
          propertyOwnerName: form.propertyOwnerName,
          customerName: form.customerName,
          customerAddress: form.customerAddress,
          customerPhone: form.customerPhone,
          customerEmail: form.customerEmail,
          ordererRole: roleToPayloadValue(form.ordererRole),
          preferredDate: form.preferredDate,
          preferredTime: form.preferredTime,
          priceAmount: numericPrice,
          termsAccepted: form.termsAccepted,
          termsVersion: data.terms.version,
          termsDocumentHash: activeTerms.hash,
        }),
      })

      const payload = (await response.json().catch(() => ({}))) as { error?: string }

      if (!response.ok) {
        throw new Error(payload.error ?? 'Kunde inte acceptera uppdraget.')
      }

      setSuccess(
        `Tack. Uppdragsbekräftelsen är registrerad (${data.terms.version}, ${roleToLabel(form.ordererRole)}).`
      )
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
      <div className="relative mx-auto w-full max-w-5xl p-4 md:p-8">
        <section className="rounded-2xl border border-indigo-100 bg-white/95 p-5 shadow-xl backdrop-blur-sm md:p-7">
          <h1 className="text-2xl font-semibold text-gray-900">Uppdragsbekräftelse</h1>
          <p className="mt-2 text-sm text-gray-600">Fyll i uppgifterna och godkänn villkoren.</p>

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

              <ReadOnly label="Typ" value={data.assignment.assignment_type} />

              <div className="grid gap-4 md:grid-cols-2">
                <SectionCard title="Objekt">
                  <Field
                    label="Fastighetsbeteckning *"
                    value={form.cadastralId}
                    onChange={(value) => updateField('cadastralId', value)}
                    disabled={!canSubmit}
                  />
                  <Field
                    label="Adress *"
                    value={form.propertyAddress}
                    onChange={(value) => updateField('propertyAddress', value)}
                    disabled={!canSubmit}
                  />
                  <Field
                    label="Kommun *"
                    value={form.propertyMunicipality}
                    onChange={(value) => updateField('propertyMunicipality', value)}
                    disabled={!canSubmit}
                  />
                  <Field
                    label="Fastighetsägare *"
                    value={form.propertyOwnerName}
                    onChange={(value) => updateField('propertyOwnerName', value)}
                    disabled={!canSubmit}
                  />
                </SectionCard>

                <SectionCard title="Uppdragsgivare">
                  <Field
                    label="Namn *"
                    value={form.customerName}
                    onChange={(value) => updateField('customerName', value)}
                    disabled={!canSubmit}
                  />
                  <Field
                    label="Adress *"
                    value={form.customerAddress}
                    onChange={(value) => updateField('customerAddress', value)}
                    disabled={!canSubmit}
                  />
                  <Field
                    label="Telefon *"
                    value={form.customerPhone}
                    onChange={(value) => updateField('customerPhone', value)}
                    disabled={!canSubmit}
                    type="tel"
                  />
                  <Field
                    label="E-post *"
                    value={form.customerEmail}
                    onChange={(value) => updateField('customerEmail', value)}
                    disabled={!canSubmit}
                    type="email"
                  />
                  <div className="space-y-1">
                    <span className="block text-xs font-medium text-gray-600">Jag är... *</span>
                    <div className="flex flex-wrap gap-2">
                      <RoleChip
                        active={form.ordererRole === 'seller'}
                        onClick={() => updateField('ordererRole', 'seller')}
                        disabled={!canSubmit}
                        label="Säljare"
                      />
                      <RoleChip
                        active={form.ordererRole === 'buyer'}
                        onClick={() => updateField('ordererRole', 'buyer')}
                        disabled={!canSubmit}
                        label="Köpare"
                      />
                      <RoleChip
                        active={form.ordererRole === 'apartment'}
                        onClick={() => updateField('ordererRole', 'apartment')}
                        disabled={!canSubmit}
                        label="Lägenhet"
                      />
                    </div>
                  </div>
                </SectionCard>
              </div>

              <SectionCard title="Besiktningsdag">
                <div className="grid gap-3 md:grid-cols-3">
                  <Field
                    label="Datum *"
                    value={form.preferredDate}
                    onChange={(value) => updateField('preferredDate', value)}
                    disabled={!canSubmit}
                    type="date"
                  />
                  <Field
                    label="Tid *"
                    value={form.preferredTime}
                    onChange={(value) => updateField('preferredTime', value)}
                    disabled={!canSubmit}
                    type="time"
                  />
                  <Field
                    label="Pris (SEK) *"
                    value={form.priceAmount}
                    onChange={(value) => updateField('priceAmount', value)}
                    disabled={!canSubmit}
                    type="number"
                    step="0.01"
                    min="0"
                  />
                </div>
              </SectionCard>

              <SectionCard title={`Villkor (${data.terms.version})`}>
                <div className="rounded-lg border border-gray-200 bg-white p-3">
                  <pre className="max-h-[24rem] overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-gray-700">
                    {activeTerms?.text ?? ''}
                  </pre>
                </div>
              </SectionCard>

              <label className="mt-1 flex items-start gap-2 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={form.termsAccepted}
                  onChange={(event) => updateField('termsAccepted', event.target.checked)}
                  disabled={!canSubmit}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300"
                />
                <span>Jag har läst och godkänner villkoren (version {data.terms.version}).</span>
              </label>

              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={!canSubmit || saving || !form.termsAccepted}
                className="inline-flex h-10 items-center justify-center rounded-lg bg-indigo-600 px-5 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
              >
                {saving ? 'Sparar...' : 'Godkänn villkor och skicka uppdrag'}
              </button>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  )
}

function SectionCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
      {children}
    </section>
  )
}

function RoleChip({
  active,
  onClick,
  disabled,
  label,
}: {
  active: boolean
  onClick: () => void
  disabled?: boolean
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        'inline-flex h-9 items-center rounded-full border px-4 text-sm transition',
        active
          ? 'border-indigo-600 bg-indigo-600 text-white'
          : 'border-gray-300 bg-white text-gray-700 hover:border-indigo-400 hover:text-indigo-700',
        disabled ? 'cursor-not-allowed opacity-60 hover:border-gray-300 hover:text-gray-700' : '',
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
  disabled = false,
  step,
  min,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'date' | 'time' | 'email' | 'tel' | 'number'
  disabled?: boolean
  step?: string
  min?: string
}) {
  return (
    <label className="space-y-1">
      <span className="block text-xs font-medium text-gray-600">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        step={step}
        min={min}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-gray-100 disabled:text-gray-500"
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
