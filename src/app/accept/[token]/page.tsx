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
  brf_name: string | null
  apartment_number: string | null
  apartment_holder_name: string | null
  orderer_role: string | null
  accepted_at: string | null
}

type TermsDocument = {
  hash: string
  text: string
  templateId: string
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

type AddonOffer = {
  addon_service_id: string
  key: string
  name: string
  description: string | null
  price_amount: number
  currency: string
}

type AcceptReadResponse = {
  state: AcceptState
  expiresAt: string | null
  usedAt: string | null
  assignment: AssignmentSummary
  inspector: InspectorProfile | null
  addonOffers: AddonOffer[]
  selectedAddonServiceIds?: string[]
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
  brfName: string
  apartmentNumber: string
  apartmentHolderName: string
  customerName: string
  customerAddress: string
  customerPhone: string
  customerEmail: string
  ordererRole: OrdererRole
  preferredDate: string
  preferredTime: string
  priceAmount: string
  selectedAddonServiceIds: string[]
  termsAccepted: boolean
}

const INSPECTOR_FALLBACK = {
  name: 'Besiktningsman',
  sbrLine1: 'Information visas av besiktningsföretaget',
  sbrLine2: '',
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

function toFormState(
  assignment: AssignmentSummary,
  addonOffers: AddonOffer[],
  selectedAddonServiceIds: string[] = []
): FormState {
  const role = normalizeRole(assignment.orderer_role)
  const availableAddonIds = new Set(addonOffers.map((offer) => offer.addon_service_id))
  const normalizedSelectedAddons = selectedAddonServiceIds.filter((id) => availableAddonIds.has(id))
  return {
    cadastralId: assignment.cadastral_id ?? '',
    propertyAddress: assignment.property_address ?? assignment.preliminary_address ?? '',
    propertyMunicipality: assignment.property_municipality ?? assignment.property_city ?? '',
    propertyOwnerName: assignment.property_owner_name ?? '',
    brfName: assignment.brf_name ?? '',
    apartmentNumber: assignment.apartment_number ?? '',
    apartmentHolderName: assignment.apartment_holder_name ?? '',
    customerName: assignment.customer_name ?? '',
    customerAddress: assignment.customer_address ?? '',
    customerPhone: assignment.customer_phone ?? '',
    customerEmail: assignment.customer_email ?? '',
    ordererRole: role,
    preferredDate: assignment.preferred_date ?? '',
    preferredTime: assignment.preferred_time ?? '',
    priceAmount: assignment.price_amount !== null ? String(assignment.price_amount) : '',
    selectedAddonServiceIds: [...new Set(normalizedSelectedAddons)],
    termsAccepted: false,
  }
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
  const [inspectorAvatarLoadError, setInspectorAvatarLoadError] = useState(false)

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
        setForm(
          toFormState(
            resolved.assignment,
            resolved.addonOffers ?? [],
            resolved.selectedAddonServiceIds ?? []
          )
        )
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Kunde inte läsa uppdragslänken.')
      } finally {
        setLoading(false)
      }
    }

    void load()
  }, [token])

  useEffect(() => {
    setInspectorAvatarLoadError(false)
  }, [data?.inspector?.avatar_path])

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

  const lockedOrdererRole = useMemo<OrdererRole>(() => {
    if (!data) return ''
    return normalizeRole(data.assignment.orderer_role)
  }, [data])

  const activeTerms = useMemo(() => {
    if (!data) return null
    if (lockedOrdererRole === 'buyer') return data.terms.documents.buyer
    if (lockedOrdererRole === 'apartment') return data.terms.documents.apartment
    if (lockedOrdererRole === 'seller') return data.terms.documents.seller
    return null
  }, [data, lockedOrdererRole])

  const inspectorName = data?.inspector?.full_name || INSPECTOR_FALLBACK.name
  const inspectorSbrLine1 = data?.inspector?.sbr_group || INSPECTOR_FALLBACK.sbrLine1
  const inspectorSbrLine2 = data?.inspector?.sbr_status || INSPECTOR_FALLBACK.sbrLine2
  const inspectorMemberNumber = data?.inspector?.membership_number || INSPECTOR_FALLBACK.memberNumber
  const inspectorCertificationNumber =
    data?.inspector?.certification_number ?? INSPECTOR_FALLBACK.certificationNumber
  const inspectorPhone = data?.inspector?.phone || INSPECTOR_FALLBACK.phone
  const inspectorEmail = data?.inspector?.email || INSPECTOR_FALLBACK.email
  const inspectorCompany = data?.inspector?.company_name || INSPECTOR_FALLBACK.company
  const inspectorOrgNumber = data?.inspector?.company_orgno || INSPECTOR_FALLBACK.orgNumber
  const inspectorAddressLine =
    data?.inspector?.company_address
      ? [
          data.inspector.company_address,
          [data.inspector.company_postal_code, data.inspector.company_city].filter(Boolean).join(' '),
        ]
          .filter(Boolean)
          .join(', ')
      : INSPECTOR_FALLBACK.addressLine
  const inspectorAvatarSrc = resolvePublicMediaUrl(data?.inspector?.avatar_path)

  const updateField = (key: keyof FormState, value: string | boolean) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev))
  }

  const updateAddonSelection = (addonServiceId: string, checked: boolean) => {
    setForm((prev) => {
      if (!prev) return prev
      const nextIds = checked
        ? [...prev.selectedAddonServiceIds, addonServiceId]
        : prev.selectedAddonServiceIds.filter((id) => id !== addonServiceId)
      return {
        ...prev,
        selectedAddonServiceIds: [...new Set(nextIds)],
      }
    })
  }

  const selectedAddonLookup = useMemo(() => {
    if (!form) return new Set<string>()
    return new Set(form.selectedAddonServiceIds)
  }, [form])

  const selectedAddonSummary = useMemo(() => {
    if (!data || !form) return { count: 0, total: 0, currency: 'SEK' }

    const selectedOffers = data.addonOffers.filter((offer) =>
      form.selectedAddonServiceIds.includes(offer.addon_service_id)
    )
    const total = selectedOffers.reduce((sum, offer) => sum + offer.price_amount, 0)
    const currency = selectedOffers[0]?.currency || data.addonOffers[0]?.currency || 'SEK'

    return {
      count: selectedOffers.length,
      total: Number(total.toFixed(2)),
      currency,
    }
  }, [data, form])

  const handleSubmit = async () => {
    if (!form || !data || !canSubmit) return

    if (!form.termsAccepted) {
      setError(`Du måste acceptera villkoren (version ${data.terms.version}) för att fortsätta.`)
      return
    }

    const requiresApartmentObjectFields = lockedOrdererRole === 'apartment'
    const missingObjectFields = requiresApartmentObjectFields
      ? !form.brfName.trim() || !form.apartmentNumber.trim() || !form.apartmentHolderName.trim()
      : !form.cadastralId.trim() || !form.propertyOwnerName.trim()

    const requiredFieldMissing =
      !form.propertyAddress.trim() ||
      !form.propertyMunicipality.trim() ||
      missingObjectFields ||
      !form.customerName.trim() ||
      !form.customerAddress.trim() ||
      !form.customerPhone.trim() ||
      !form.customerEmail.trim() ||
      !form.preferredDate.trim() ||
      !form.preferredTime.trim()

    if (requiredFieldMissing) {
      setError('Fyll i alla obligatoriska fält.')
      return
    }

    if (!activeTerms) {
      setError('Uppdraget saknar fastställd uppdragsgivare. Kontakta besiktningsföretaget.')
      return
    }

    if (!EMAIL_REGEX.test(form.customerEmail.trim())) {
      setError('Ange en giltig e-postadress.')
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
          brfName: form.brfName,
          apartmentNumber: form.apartmentNumber,
          apartmentHolderName: form.apartmentHolderName,
          preferredDate: form.preferredDate,
          preferredTime: form.preferredTime,
          selectedAddonServiceIds: form.selectedAddonServiceIds,
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
        `Tack. Uppdragsbekräftelsen är registrerad (${data.terms.version}, ${roleToLabel(lockedOrdererRole)}).`
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
            'radial-gradient(100% 70% at 50% 0%, rgba(219,234,254,0.5) 0%, rgba(219,234,254,0) 60%), linear-gradient(135deg, #1e3a8a 0%, #1d4ed8 42%, #60a5fa 100%)',
        }}
      />
      <div className="pointer-events-none absolute inset-0 bg-white/10 backdrop-blur-[1px]" />

      <div className="relative mx-auto w-full max-w-6xl space-y-4 p-4 md:p-6">
        <header className="rounded-2xl border border-white/30 bg-white/10 p-4 shadow-sm backdrop-blur-sm md:p-5">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-white drop-shadow-sm">UPPDRAGSBEKRÄFTELSE</h1>
          </div>
          <p className="mt-2 text-sm text-white/90">Fyll i uppgifterna och godkänn villkoren.</p>
        </header>

        {loading ? (
          <div className="rounded-md border border-white/30 bg-white/90 p-3 text-sm text-gray-700">
            Laddar uppdrag...
          </div>
        ) : null}
        {error ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>
        ) : null}
        {success ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
            {success}
          </div>
        ) : null}

        {!loading && data && form ? (
          <>
            {stateText ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                {stateText}
              </div>
            ) : null}

            <section className="space-y-4 rounded-2xl border border-white/30 bg-white/90 p-4 shadow-sm backdrop-blur md:p-5">
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-sky-50 px-4 py-3 shadow-sm md:gap-3">
                <p className="pr-1 text-base font-bold uppercase tracking-wide text-indigo-900 md:text-lg">
                  ÖVERLÅTELSEBESIKTNING FÖR
                </p>
                <RoleChip
                  label="Säljare"
                  active={lockedOrdererRole === 'seller'}
                  onClick={() => undefined}
                  disabled
                />
                <RoleChip
                  label="Köpare"
                  active={lockedOrdererRole === 'buyer'}
                  onClick={() => undefined}
                  disabled
                />
                <RoleChip
                  label="Lägenhet"
                  active={lockedOrdererRole === 'apartment'}
                  onClick={() => undefined}
                  disabled
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <SectionCard title="Objekt">
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
                  {lockedOrdererRole === 'apartment' ? (
                    <>
                      <Field
                        label="Bostadsrättsförening *"
                        value={form.brfName}
                        onChange={(value) => updateField('brfName', value)}
                        disabled={!canSubmit}
                      />
                      <Field
                        label="Lägenhetsnummer *"
                        value={form.apartmentNumber}
                        onChange={(value) => updateField('apartmentNumber', value)}
                        disabled={!canSubmit}
                      />
                      <Field
                        label="Bostadsrättsinnehavare *"
                        value={form.apartmentHolderName}
                        onChange={(value) => updateField('apartmentHolderName', value)}
                        disabled={!canSubmit}
                      />
                    </>
                  ) : (
                    <>
                      <Field
                        label="Fastighetsbeteckning *"
                        value={form.cadastralId}
                        onChange={(value) => updateField('cadastralId', value)}
                        disabled={!canSubmit}
                      />
                      <Field
                        label="Fastighetsägare *"
                        value={form.propertyOwnerName}
                        onChange={(value) => updateField('propertyOwnerName', value)}
                        disabled={!canSubmit}
                      />
                    </>
                  )}
                </SectionCard>

                <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                  <h3 className="text-sm font-semibold text-gray-900">Uppdragsgivare</h3>
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
                    type="tel"
                    disabled={!canSubmit}
                  />
                  <Field
                    label="E-post *"
                    value={form.customerEmail}
                    onChange={(value) => updateField('customerEmail', value)}
                    type="email"
                    disabled={!canSubmit}
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
                      {inspectorSbrLine2 ? (
                        <div className="text-xs text-gray-600">{inspectorSbrLine2}</div>
                      ) : null}
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
                        label="Datum *"
                        type="date"
                        value={form.preferredDate}
                        onChange={(value) => updateField('preferredDate', value)}
                        disabled={!canSubmit}
                      />
                      <div className="space-y-2 pt-5">
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-700">Kostnad</p>
                        <Field
                          label="Pris (SEK) *"
                          type="number"
                          step="0.01"
                          min="0"
                          value={form.priceAmount}
                          onChange={(value) => updateField('priceAmount', value)}
                          disabled
                        />
                      </div>
                    </div>
                    <Field
                      label="Tid *"
                      type="time"
                      value={form.preferredTime}
                      onChange={(value) => updateField('preferredTime', value)}
                      disabled={!canSubmit}
                    />
                  </div>
                </SectionCard>
              </div>

              {data.addonOffers.length > 0 ? (
                <SectionCard title="Tilläggsuppdrag">
                  <p className="text-xs text-gray-600">
                    Välj eventuella tilläggsuppdrag utöver överlåtelsebesiktningen.
                  </p>

                  <div className="space-y-2">
                    {data.addonOffers.map((offer) => (
                      <label
                        key={offer.addon_service_id}
                        className="flex items-start justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2"
                      >
                        <div className="flex min-w-0 items-start gap-2">
                          <input
                            type="checkbox"
                            className="mt-1 h-4 w-4 rounded border-gray-300"
                            checked={selectedAddonLookup.has(offer.addon_service_id)}
                            onChange={(event) =>
                              updateAddonSelection(offer.addon_service_id, event.target.checked)
                            }
                            disabled={!canSubmit}
                          />
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-gray-900">{offer.name}</span>
                            {offer.description ? (
                              <span className="mt-0.5 block text-xs text-gray-600">{offer.description}</span>
                            ) : null}
                          </span>
                        </div>
                        <span className="whitespace-nowrap text-sm font-medium text-gray-800">
                          {offer.price_amount.toLocaleString('sv-SE', {
                            minimumFractionDigits: 0,
                            maximumFractionDigits: 2,
                          })}{' '}
                          {offer.currency}
                        </span>
                      </label>
                    ))}
                  </div>

                  <div className="rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-sm text-indigo-900">
                    Valda tilläggsuppdrag: <strong>{selectedAddonSummary.count}</strong>
                    {' · '}
                    Summa:{' '}
                    <strong>
                      {selectedAddonSummary.total.toLocaleString('sv-SE', {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 2,
                      })}{' '}
                      {selectedAddonSummary.currency}
                    </strong>
                  </div>
                </SectionCard>
              ) : null}
            </section>

            <section className="space-y-4 rounded-2xl border border-white/30 bg-white/90 p-4 shadow-sm backdrop-blur md:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700">
                  Villkor för besiktning
                </h2>
                <span className="text-xs font-medium text-gray-500">Version {data.terms.version}</span>
              </div>

              <label className="mt-1 flex items-start gap-2 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={form.termsAccepted}
                  onChange={(event) => updateField('termsAccepted', event.target.checked)}
                  disabled={!canSubmit}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300"
                />
                <span>Jag har läst och godkänner villkoren nedan (version {data.terms.version}). *</span>
              </label>

              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={!canSubmit || saving || !form.termsAccepted}
                className="inline-flex h-10 items-center justify-center rounded-lg bg-indigo-600 px-5 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
              >
                {saving ? 'Sparar...' : 'Godkänn villkor och skicka uppdrag'}
              </button>

              <div className="rounded-xl border border-gray-200 bg-white p-3">
                <pre className="max-h-[36rem] overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-gray-700">
                  {activeTerms?.text ?? 'Uppdraget saknar fastställd uppdragsgivare. Kontakta besiktningsföretaget.'}
                </pre>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </main>
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
  disabled,
}: {
  label: string
  active: boolean
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        'inline-flex h-8 items-center rounded-full border px-4 text-sm font-semibold leading-none transition-colors',
        active
          ? 'border-indigo-700 bg-indigo-700 text-white shadow-sm'
          : 'border-indigo-200 bg-white text-indigo-900 hover:border-indigo-400 hover:bg-indigo-50',
        disabled ? 'cursor-not-allowed opacity-60' : '',
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
