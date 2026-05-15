'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ChevronsLeft, Loader2, Save, Send } from 'lucide-react'
import Protected from '@/components/Protected'
import { supabase } from '@/lib/supabaseClient'
import { resolveInspectorCertificationSummary } from '@/lib/certifications/profileResolver'

type AssignmentType = 'OB' | 'STATUS' | 'UHP' | 'EB'
type OrdererRole = 'buyer' | 'seller' | 'apartment' | ''

type NewAssignmentClientProps = {
  sellerTemplate: string
  buyerTemplate: string
  apartmentTemplate: string
}

type InspectorProfile = {
  full_name: string | null
  sbr_group: string | null
  sbr_status: string | null
  membership_number: string | null
  certification_number: string | null
  phone: string | null
  email: string | null
  company_name: string | null
  company_orgno: string | null
  company_address: string | null
  company_postal_code: string | null
  company_city: string | null
  avatar_path: string | null
}

type FormState = {
  assignmentType: AssignmentType
  cadastralId: string
  brfName: string
  apartmentNumber: string
  apartmentHolderName: string
  propertyAddress: string
  propertyPostalCode: string
  propertyCity: string
  propertyMunicipality: string
  propertyOwnerName: string
  customerName: string
  customerAddress: string
  customerPostalCode: string
  customerCity: string
  customerPhone: string
  customerEmail: string
  ordererRole: OrdererRole
  preferredDate: string
  preferredTime: string
  priceAmount: string
  notesInternal: string
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const INITIAL_FORM: FormState = {
  assignmentType: 'OB',
  cadastralId: '',
  brfName: '',
  apartmentNumber: '',
  apartmentHolderName: '',
  propertyAddress: '',
  propertyPostalCode: '',
  propertyCity: '',
  propertyMunicipality: '',
  propertyOwnerName: '',
  customerName: '',
  customerAddress: '',
  customerPostalCode: '',
  customerCity: '',
  customerPhone: '',
  customerEmail: '',
  ordererRole: '',
  preferredDate: '',
  preferredTime: '',
  priceAmount: '',
  notesInternal: '',
}

const INSPECTOR_FALLBACK = {
  name: 'Ej angivet',
  sbrLine1: 'SBR-grupp saknas',
  sbrLine2: 'SBR-status saknas',
  memberNumber: '-',
  certificationNumber: null as string | null,
  phone: '-',
  email: '-',
  company: '-',
  orgNumber: '-',
  addressLine: '-',
}

function resolvePublicMediaUrl(path: string | null | undefined) {
  if (!path) return null
  if (path.startsWith('http://') || path.startsWith('https://')) return path

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!base) return null

  if (path.startsWith('/storage/')) return `${base}${path}`
  if (path.startsWith('storage/')) return `${base}/${path}`
  if (path.startsWith('/')) return path
  return `${base}/storage/v1/object/public/property-media/${path}`
}

function roleToLabel(role: OrdererRole) {
  if (role === 'buyer') return 'Köpare'
  if (role === 'seller') return 'Säljare'
  if (role === 'apartment') return 'Lägenhet'
  return ''
}

export default function NewAssignmentClient({
  sellerTemplate,
  buyerTemplate,
  apartmentTemplate,
}: NewAssignmentClientProps) {
  const router = useRouter()
  const [form, setForm] = useState<FormState>(INITIAL_FORM)
  const [savingDraft, setSavingDraft] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inspectorProfile, setInspectorProfile] = useState<InspectorProfile | null>(null)
  const [inspectorAvatarLoadError, setInspectorAvatarLoadError] = useState(false)

  const activeTemplate =
    form.ordererRole === 'buyer'
      ? buyerTemplate
      : form.ordererRole === 'apartment'
        ? apartmentTemplate
        : form.ordererRole === 'seller'
          ? sellerTemplate
          : ''
  const trimmedEmail = form.customerEmail.trim().toLowerCase()
  const canCreate = useMemo(() => EMAIL_REGEX.test(trimmedEmail), [trimmedEmail])
  const isBusy = savingDraft || sending

  useEffect(() => {
    let cancelled = false

    const loadInspectorProfile = async () => {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user || cancelled) return

      const { data, error: profileError } = await supabase
        .from('profiles')
        .select(
          'full_name,phone,email,company_name,company_orgno,company_address,company_postal_code,company_city,avatar_path'
        )
        .eq('id', user.id)
        .maybeSingle()

      if (profileError || !data || cancelled) return

      const { summary } = await resolveInspectorCertificationSummary(supabase, {
        profileId: user.id,
      })

      if (cancelled) return
      setInspectorProfile({
        full_name: data.full_name ?? null,
        sbr_group: summary.sbr_group,
        sbr_status: summary.sbr_status,
        membership_number: summary.membership_number,
        certification_number: summary.certification_number,
        phone: data.phone ?? null,
        email: data.email ?? null,
        company_name: data.company_name ?? null,
        company_orgno: data.company_orgno ?? null,
        company_address: data.company_address ?? null,
        company_postal_code: data.company_postal_code ?? null,
        company_city: data.company_city ?? null,
        avatar_path: data.avatar_path ?? null,
      })
      setInspectorAvatarLoadError(false)
    }

    void loadInspectorProfile()

    return () => {
      cancelled = true
    }
  }, [])

  const inspectorName = inspectorProfile?.full_name || INSPECTOR_FALLBACK.name
  const inspectorSbrLine1 = inspectorProfile?.sbr_group || INSPECTOR_FALLBACK.sbrLine1
  const inspectorSbrLine2 = inspectorProfile?.sbr_status || INSPECTOR_FALLBACK.sbrLine2
  const inspectorMemberNumber = inspectorProfile?.membership_number || INSPECTOR_FALLBACK.memberNumber
  const inspectorCertificationNumber =
    inspectorProfile?.certification_number ?? INSPECTOR_FALLBACK.certificationNumber
  const inspectorPhone = inspectorProfile?.phone || INSPECTOR_FALLBACK.phone
  const inspectorEmail = inspectorProfile?.email || INSPECTOR_FALLBACK.email
  const inspectorCompany = inspectorProfile?.company_name || INSPECTOR_FALLBACK.company
  const inspectorOrgNumber = inspectorProfile?.company_orgno || INSPECTOR_FALLBACK.orgNumber
  const inspectorAddressLine =
    inspectorProfile?.company_address
      ? [
          inspectorProfile.company_address,
          [inspectorProfile.company_postal_code, inspectorProfile.company_city]
            .filter(Boolean)
            .join(' '),
        ]
          .filter(Boolean)
          .join(', ')
      : INSPECTOR_FALLBACK.addressLine
  const inspectorAvatarSrc = resolvePublicMediaUrl(inspectorProfile?.avatar_path)

  const updateField = (key: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const parsePriceAmount = () => {
    const raw = form.priceAmount.trim()
    if (raw.length === 0) return null

    const parsed = Number(raw.replace(',', '.'))
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error('Ange ett giltigt pris.')
    }

    return parsed
  }

  const buildAssignmentPayload = () => ({
    assignmentType: form.assignmentType,
    customerName: form.customerName.trim(),
    customerPostalCode: form.customerPostalCode.trim(),
    customerCity: form.customerCity.trim(),
    customerEmail: trimmedEmail,
    customerPhone: form.customerPhone.trim(),
    customerAddress: form.customerAddress.trim(),
    propertyAddress: form.propertyAddress.trim(),
    propertyPostalCode: form.propertyPostalCode.trim(),
    propertyCity: form.propertyCity.trim(),
    propertyMunicipality: form.propertyMunicipality.trim(),
    propertyOwnerName: form.propertyOwnerName.trim(),
    cadastralId: form.cadastralId.trim(),
    brfName: form.brfName.trim(),
    apartmentNumber: form.apartmentNumber.trim(),
    apartmentHolderName: form.apartmentHolderName.trim(),
    ordererRole: roleToLabel(form.ordererRole),
    preferredDate: form.preferredDate,
    preferredTime: form.preferredTime,
    priceAmount: parsePriceAmount(),
    preliminaryAddress: form.propertyAddress.trim(),
    notesInternal: form.notesInternal.trim(),
  })

  const createAssignmentDraft = async () => {
    const response = await fetch('/api/ob/assignments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildAssignmentPayload()),
    })

    const payload = (await response.json().catch(() => ({}))) as {
      error?: string
      assignment?: { id?: string }
    }

    if (!response.ok || !payload.assignment?.id) {
      throw new Error(payload.error ?? 'Kunde inte skapa uppdrag.')
    }

    return payload.assignment.id
  }

  const handleSaveDraft = async () => {
    if (!canCreate) {
      setError('Ange en giltig kundmejl innan du sparar utkastet.')
      return
    }

    try {
      setSavingDraft(true)
      setError(null)
      const assignmentId = await createAssignmentDraft()
      router.push(`/ob/assignments/${assignmentId}`)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Kunde inte spara utkast.')
    } finally {
      setSavingDraft(false)
    }
  }

  const handleSend = async () => {
    if (!canCreate) {
      setError('Ange en giltig kundmejl innan du skickar uppdraget.')
      return
    }
    if (!form.ordererRole) {
      setError('Välj uppdragsgivare (Säljare, Köpare eller Lägenhet) innan du skickar.')
      return
    }

    try {
      setSending(true)
      setError(null)

      const response = await fetch('/api/ob/assignments/quick-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildAssignmentPayload()),
      })

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string
        assignmentId?: string
      }

      if (!response.ok || !payload.assignmentId) {
        throw new Error(payload.error ?? 'Kunde inte skapa och skicka uppdrag.')
      }

      router.push(`/ob/assignments/${payload.assignmentId}`)
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Kunde inte skapa och skicka uppdrag.')
    } finally {
      setSending(false)
    }
  }

  return (
    <Protected>
      <main className="relative min-h-full overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'linear-gradient(135deg, #f7fbff 0%, #ffffff 52%, #f3f9ff 100%)',
          }}
        />
        <div className="pointer-events-none absolute inset-0 bg-transparent" />

        <div className="relative mx-auto w-full max-w-6xl space-y-4 p-4 md:p-6">
          <header className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm backdrop-blur-sm md:p-5">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => router.push('/ob')}
                aria-label="Till huvudsidan"
                title="Till huvudsidan"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
              >
                <ChevronsLeft size={15} strokeWidth={2.2} />
              </button>
              <button
                type="button"
                onClick={() => router.push('/ob/assignments')}
                aria-label="Tillbaka"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
              >
                <ArrowLeft size={16} strokeWidth={2} />
              </button>
              <h1 className="text-2xl font-semibold text-slate-950">UPPDRAGSBEKRÄFTELSE</h1>
              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleSaveDraft()}
                  disabled={isBusy || !canCreate}
                  aria-label="Spara utkast"
                  title="Spara utkast"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-white/15"
                >
                  {savingDraft ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Save size={16} />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={isBusy || !canCreate || !form.ordererRole}
                  aria-label="Skicka"
                  title="Skicka"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-indigo-600 bg-indigo-600 text-white shadow-sm transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:cursor-not-allowed disabled:border-indigo-200 disabled:bg-indigo-50 disabled:text-indigo-700 disabled:shadow-none disabled:hover:bg-indigo-50"
                >
                  {sending ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Send size={16} />
                  )}
                </button>
              </div>
            </div>
          </header>

          {error ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>
          ) : null}

          <section className="space-y-4 rounded-2xl border border-white/30 bg-white/90 p-4 shadow-sm backdrop-blur md:p-5">
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-sky-50 px-4 py-3 shadow-sm md:gap-3">
              <p className="pr-1 text-base font-bold uppercase tracking-wide text-indigo-900 md:text-lg">
                ÖVERLÅTELSEBESIKTNING FÖR *
              </p>
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
              <RoleChip
                label="Lägenhet"
                active={form.ordererRole === 'apartment'}
                onClick={() => updateField('ordererRole', 'apartment')}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <SectionCard title="Objekt">
                {form.ordererRole === 'apartment' ? (
                  <>
                    <Field
                      label="Bostadsrättsförening"
                      value={form.brfName}
                      onChange={(value) => updateField('brfName', value)}
                    />
                    <Field
                      label="Lägenhetsnummer"
                      value={form.apartmentNumber}
                      onChange={(value) => updateField('apartmentNumber', value)}
                    />
                    <Field
                      label="Bostadsrättsinnehavare"
                      value={form.apartmentHolderName}
                      onChange={(value) => updateField('apartmentHolderName', value)}
                    />
                    <Field
                      label="Adress"
                      value={form.propertyAddress}
                      onChange={(value) => updateField('propertyAddress', value)}
                    />
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
                    <Field
                      label="Kommun"
                      value={form.propertyMunicipality}
                      onChange={(value) => updateField('propertyMunicipality', value)}
                    />
                  </>
                ) : (
                  <>
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
                  </>
                )}
              </SectionCard>

              <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <h3 className="text-sm font-semibold text-gray-900">Uppdragsgivare</h3>
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
                <div className="grid gap-3 md:grid-cols-2">
                  <Field
                    label="Postnummer"
                    value={form.customerPostalCode}
                    onChange={(value) => updateField('customerPostalCode', value)}
                  />
                  <Field
                    label="Ort"
                    value={form.customerCity}
                    onChange={(value) => updateField('customerCity', value)}
                  />
                </div>
                <Field
                  label="Telefon"
                  value={form.customerPhone}
                  onChange={(value) => updateField('customerPhone', value)}
                  type="tel"
                />
                <Field
                  label="E-post *"
                  value={form.customerEmail}
                  onChange={(value) => updateField('customerEmail', value)}
                  type="email"
                />
              </section>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <SectionCard title="Besiktningsman">
                <div className="flex flex-wrap items-start gap-4">
                  {inspectorAvatarSrc && !inspectorAvatarLoadError ? (
                    <img
                      src={inspectorAvatarSrc}
                      alt="Profilbild"
                      className="h-20 w-20 rounded-full border border-gray-300 object-cover"
                      onError={() => setInspectorAvatarLoadError(true)}
                    />
                  ) : (
                    <div className="flex h-20 w-20 items-center justify-center rounded-full border border-gray-300 bg-gray-100 text-xs text-gray-500">
                      Ingen bild
                    </div>
                  )}

                  <div className="min-w-0 space-y-1 text-sm text-gray-800">
                    <div className="font-semibold">{inspectorName}</div>
                    <div className="text-xs text-gray-600">{inspectorSbrLine1}</div>
                    <div className="text-xs text-gray-600">{inspectorSbrLine2}</div>
                    <div className="pt-1 text-xs text-gray-600">Medlemsnummer: {inspectorMemberNumber}</div>
                    {inspectorCertificationNumber ? (
                      <div className="text-xs text-gray-600">
                        Certifieringsnummer: {inspectorCertificationNumber}
                      </div>
                    ) : null}
                    <div className="text-xs text-gray-600">Telefon: {inspectorPhone}</div>
                    <div className="text-xs text-gray-600">E-post: {inspectorEmail}</div>
                    <div className="pt-1 text-xs text-gray-600">{inspectorCompany}</div>
                    <div className="text-xs text-gray-600">Org.nr: {inspectorOrgNumber}</div>
                    <div className="text-xs text-gray-600">{inspectorAddressLine}</div>
                  </div>
                </div>
              </SectionCard>

              <SectionCard title="Besiktningsdag">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-3">
                    <Field
                      label="Datum"
                      type="date"
                      value={form.preferredDate}
                      onChange={(value) => updateField('preferredDate', value)}
                    />
                    <div className="space-y-2 pt-5">
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-700">Kostnad</p>
                      <Field
                        label="Pris (SEK)"
                        type="number"
                        step="0.01"
                        min="0"
                        value={form.priceAmount}
                        onChange={(value) => updateField('priceAmount', value)}
                      />
                    </div>
                  </div>
                  <Field
                    label="Tid"
                    type="time"
                    value={form.preferredTime}
                    onChange={(value) => updateField('preferredTime', value)}
                  />
                </div>
              </SectionCard>
            </div>
          </section>

          <section className="space-y-4 rounded-2xl border border-white/30 bg-white/90 p-4 shadow-sm backdrop-blur md:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700">Villkor för besiktning</h2>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-3">
              <pre className="max-h-[36rem] overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-gray-700">
                {activeTemplate || 'Välj uppdragsgivare för att visa villkorstexten.'}
              </pre>
            </div>
          </section>
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
        'inline-flex h-8 items-center rounded-full border px-4 text-sm font-semibold leading-none transition-colors',
        active
          ? 'border-indigo-700 bg-indigo-700 text-white shadow-sm'
          : 'border-indigo-200 bg-white text-indigo-900 hover:border-indigo-400 hover:bg-indigo-50',
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



