'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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

type AssignmentAddonOrder = {
  id: string
  assignment_id: string
  org_id: string
  addon_service_id: string | null
  addon_key: string
  addon_name_snapshot: string
  price_amount_snapshot: number
  currency_snapshot: string
  created_at: string
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

function assignmentStatusToLabel(status: AssignmentStatus) {
  switch (status) {
    case 'draft':
      return 'Utkast'
    case 'sent':
      return 'Skickad'
    case 'booked':
      return 'Bokad'
    case 'completed':
      return 'Konverterad'
    case 'expired':
      return 'Utg\u00e5ngen'
    case 'cancelled':
      return 'Avbruten'
    default:
      return status
  }
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

function formFingerprint(form: FormState) {
  return JSON.stringify(form)
}

export default function AssignmentDetailsPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const id = params.id

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [sending, setSending] = useState(false)
  const [converting, setConverting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [assignment, setAssignment] = useState<AssignmentDetails | null>(null)
  const [addonOrders, setAddonOrders] = useState<AssignmentAddonOrder[]>([])
  const [form, setForm] = useState<FormState | null>(null)
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedFingerprintRef = useRef<string>('')

  const canSend = assignment?.status !== 'completed'
  const canConvert = assignment?.status === 'booked' && !assignment.inspection_id
  const isBookedLocked = assignment?.status === 'booked'

  const loadAssignment = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      setSuccess(null)
      setAddonOrders([])

      const response = await fetch(`/api/ob/assignments/${id}`, { cache: 'no-store' })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(jsonToErrorMessage(payload, 'Kunde inte hämta uppdraget.'))
      }

      const typedPayload = payload as {
        assignment: AssignmentDetails
        addonOrders?: AssignmentAddonOrder[]
      }
      const row = typedPayload.assignment
      const nextForm = toFormState(row)
      setAssignment(row)
      setAddonOrders(typedPayload.addonOrders ?? [])
      setForm(nextForm)
      lastSavedFingerprintRef.current = formFingerprint(nextForm)
      setSaveState('idle')
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

  const addonSummary = useMemo(() => {
    const total = addonOrders.reduce((sum, row) => sum + row.price_amount_snapshot, 0)
    const currency = addonOrders[0]?.currency_snapshot || 'SEK'
    return {
      count: addonOrders.length,
      total: Number(total.toFixed(2)),
      currency,
    }
  }, [addonOrders])

  const updateField = (key: keyof FormState, value: string) => {
    if (isBookedLocked) return
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev))
  }

  const saveForm = useCallback(
    async (nextForm: FormState, options?: { silentValidation?: boolean }) => {
      if (isBookedLocked) return false
      const silentValidation = options?.silentValidation ?? false
      if (!EMAIL_REGEX.test(nextForm.customerEmail.trim())) {
        if (!silentValidation) setError('Ange en giltig kundmejl.')
        return false
      }

      const parsedPrice =
        nextForm.priceAmount.trim().length > 0
          ? Number(nextForm.priceAmount.trim().replace(',', '.'))
          : null
      if (parsedPrice !== null && (!Number.isFinite(parsedPrice) || parsedPrice < 0)) {
        if (!silentValidation) setError('Ange ett giltigt pris.')
        return false
      }

      try {
        setSaving(true)
        setSaveState('saving')
        setError(null)

        const response = await fetch(`/api/ob/assignments/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            assignment_type: nextForm.assignmentType,
            status: nextForm.status,
            customer_name: nextForm.customerName,
            customer_email: nextForm.customerEmail,
            customer_phone: nextForm.customerPhone,
            customer_address: nextForm.customerAddress,
            property_address: nextForm.propertyAddress,
            preliminary_address: nextForm.propertyAddress,
            property_municipality: nextForm.propertyMunicipality,
            property_owner_name: nextForm.propertyOwnerName,
            cadastral_id: nextForm.cadastralId,
            preferred_date: nextForm.preferredDate,
            preferred_time: nextForm.preferredTime,
            price_amount: parsedPrice,
            currency: 'SEK',
            orderer_role: roleToLabel(nextForm.ordererRole),
            invoice_name: nextForm.invoiceName,
            invoice_address: nextForm.invoiceAddress,
            personal_identity_number: nextForm.personalIdentityNumber,
            notes_internal: nextForm.notesInternal,
          }),
        })

        const payload = await response.json().catch(() => null)
        if (!response.ok) {
          throw new Error(jsonToErrorMessage(payload, 'Kunde inte spara uppdraget.'))
        }

        const updated = (payload as { assignment: AssignmentDetails }).assignment
        const updatedForm = toFormState(updated)
        setAssignment(updated)
        setForm(updatedForm)
        lastSavedFingerprintRef.current = formFingerprint(updatedForm)
        setSaveState('saved')
        return true
      } catch (saveError) {
        setSaveState('idle')
        setError(saveError instanceof Error ? saveError.message : 'Kunde inte spara uppdraget.')
        return false
      } finally {
        setSaving(false)
      }
    },
    [id, isBookedLocked]
  )

  useEffect(() => {
    if (loading || !form || isBookedLocked) return

    const nextFingerprint = formFingerprint(form)
    if (nextFingerprint === lastSavedFingerprintRef.current) return

    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current)
    }

    setSaveState('idle')
    autosaveTimerRef.current = setTimeout(() => {
      void saveForm(form, { silentValidation: true })
    }, 650)

    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current)
        autosaveTimerRef.current = null
      }
    }
  }, [form, loading, saveForm, isBookedLocked])

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
                <span className="px-2 text-xs font-medium text-white/95">
                  {isBookedLocked
                    ? 'Låst'
                    : saveState === 'saving'
                      ? 'Sparar...'
                      : saveState === 'saved'
                        ? 'Sparat'
                        : ''}
                </span>
                <button
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={!canSend || sending || saving || loading}
                  className="rounded-lg border border-white/60 bg-white/15 px-3 py-2 text-sm font-medium text-white transition hover:bg-white/25 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {sending ? 'Skickar...' : 'Skicka uppdragsbekraftelse'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleConvert()}
                  disabled={!canConvert || converting || saving || loading}
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
          {isBookedLocked ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              Uppdragsbekräftelsen är bokad och låst för redigering. Starta besiktning för att gå vidare.
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
                  <ReadOnly label="Status" value={assignmentStatusToLabel(assignment.status)} />
                  <ReadOnly label="Skickad" value={summary?.sentAt ?? '-'} />
                  <ReadOnly label="Accepterad" value={summary?.acceptedAt ?? '-'} />
                </div>
                <fieldset
                  className="space-y-4 border-0 p-0"
                  disabled={isBookedLocked}
                  aria-label="Uppdragsdata"
                >
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
                </fieldset>

                <SectionCard title="Beställda tilläggsuppdrag">
                  {addonOrders.length === 0 ? (
                    <p className="text-sm text-gray-600">Inga tilläggsuppdrag är valda ännu.</p>
                  ) : (
                    <div className="space-y-3">
                      <div className="overflow-hidden rounded-lg border border-gray-200">
                        <table className="min-w-full text-sm">
                          <thead>
                            <tr className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-600">
                              <th className="px-3 py-2">Tjänst</th>
                              <th className="px-3 py-2">Pris</th>
                            </tr>
                          </thead>
                          <tbody>
                            {addonOrders.map((order) => (
                              <tr key={order.id} className="border-t border-gray-100">
                                <td className="px-3 py-2 text-gray-900">{order.addon_name_snapshot}</td>
                                <td className="px-3 py-2 text-gray-800">
                                  {order.price_amount_snapshot.toLocaleString('sv-SE', {
                                    minimumFractionDigits: 0,
                                    maximumFractionDigits: 2,
                                  })}{' '}
                                  {order.currency_snapshot}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <div className="rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-sm text-indigo-900">
                        Valda tilläggsuppdrag: <strong>{addonSummary.count}</strong>
                        {' · '}
                        Summa:{' '}
                        <strong>
                          {addonSummary.total.toLocaleString('sv-SE', {
                            minimumFractionDigits: 0,
                            maximumFractionDigits: 2,
                          })}{' '}
                          {addonSummary.currency}
                        </strong>
                      </div>
                    </div>
                  )}
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
