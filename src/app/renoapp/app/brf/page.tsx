'use client'

import { useEffect, useState } from 'react'

type BrfItem = {
  id: string
  name: string
  slug: string
  orgNumber: string | null
  propertyDesignation: string | null
  address: string | null
  addressLine2: string | null
  postalCode: string | null
  city: string | null
  generalEmail: string | null
  brfPhone: string | null
  invoiceAddress: string | null
  invoiceEmail: string | null
  invoiceReference: string | null
  primaryContactName: string | null
  primaryContactEmail: string | null
  primaryContactPhone: string | null
  unitCount: number | null
  technicalContact: string | null
  applyIntroText: string | null
  isPublicApplyEnabled: boolean
  isPublicApplyListed: boolean
  onboardingCompletedAt: string | null
}

type BrfFormState = {
  brfId: string
  name: string
  orgNumber: string
  propertyDesignation: string
  address: string
  addressLine2: string
  postalCode: string
  city: string
  generalEmail: string
  brfPhone: string
  invoiceAddress: string
  invoiceEmail: string
  invoiceReference: string
  primaryContactName: string
  primaryContactEmail: string
  primaryContactPhone: string
  unitCount: string
  technicalContact: string
  applyIntroText: string
  isPublicApplyEnabled: boolean
  isPublicApplyListed: boolean
}

function toFormState(item: BrfItem): BrfFormState {
  return {
    brfId: item.id,
    name: item.name,
    orgNumber: item.orgNumber ?? '',
    propertyDesignation: item.propertyDesignation ?? '',
    address: item.address ?? '',
    addressLine2: item.addressLine2 ?? '',
    postalCode: item.postalCode ?? '',
    city: item.city ?? '',
    generalEmail: item.generalEmail ?? '',
    brfPhone: item.brfPhone ?? '',
    invoiceAddress: item.invoiceAddress ?? '',
    invoiceEmail: item.invoiceEmail ?? '',
    invoiceReference: item.invoiceReference ?? '',
    primaryContactName: item.primaryContactName ?? '',
    primaryContactEmail: item.primaryContactEmail ?? '',
    primaryContactPhone: item.primaryContactPhone ?? '',
    unitCount: item.unitCount ? String(item.unitCount) : '',
    technicalContact: item.technicalContact ?? '',
    applyIntroText: item.applyIntroText ?? '',
    isPublicApplyEnabled: item.isPublicApplyEnabled,
    isPublicApplyListed: item.isPublicApplyListed,
  }
}

function formatDateTime(value: string | null) {
  if (!value) return 'Inte slutförd ännu'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

function InputField({
  label,
  value,
  onChange,
  required = false,
  type = 'text',
  inputMode,
  placeholder,
  readOnly = false,
  className = '',
}: {
  label: string
  value: string
  onChange?: (value: string) => void
  required?: boolean
  type?: string
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']
  placeholder?: string
  readOnly?: boolean
  className?: string
}) {
  return (
    <label className={`block ${className}`.trim()}>
      <span className="mb-2 block text-sm font-semibold text-stone-800">
        {label}
        {required ? ' *' : ''}
      </span>
      <input
        value={value}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
        type={type}
        readOnly={readOnly}
        inputMode={inputMode}
        placeholder={placeholder}
        className={`w-full rounded-2xl border px-4 py-3 text-sm ${
          readOnly
            ? 'border-stone-200 bg-stone-100 text-stone-600'
            : 'border-stone-300 bg-white text-stone-900'
        }`}
      />
    </label>
  )
}

function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold text-stone-800">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={4}
        className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
      />
    </label>
  )
}

export default function RenoAppBrfPage() {
  const [items, setItems] = useState<BrfItem[]>([])
  const [formsById, setFormsById] = useState<Record<string, BrfFormState>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingBrfId, setSavingBrfId] = useState<string | null>(null)
  const [successBrfId, setSuccessBrfId] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    const loadBrfs = async () => {
      setLoading(true)
      setError(null)

      try {
        const response = await fetch('/api/renoapp/app/brf', { cache: 'no-store' })
        const payload = (await response.json().catch(() => ({}))) as { items?: BrfItem[]; error?: string }

        if (!response.ok) {
          throw new Error(payload.error ?? 'Kunde inte läsa BRF-information.')
        }

        if (!active) return

        const nextItems = payload.items ?? []
        setItems(nextItems)
        setFormsById(
          Object.fromEntries(nextItems.map((item) => [item.id, toFormState(item)]))
        )
      } catch (fetchError) {
        if (active) {
          setError(fetchError instanceof Error ? fetchError.message : 'Kunde inte läsa BRF-information.')
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void loadBrfs()

    return () => {
      active = false
    }
  }, [])

  const updateField = <K extends keyof BrfFormState>(brfId: string, field: K, value: BrfFormState[K]) => {
    setFormsById((current) => ({
      ...current,
      [brfId]: {
        ...current[brfId],
        [field]: value,
      },
    }))
  }

  const handleTogglePublicApply = (brfId: string, checked: boolean) => {
    setFormsById((current) => ({
      ...current,
      [brfId]: {
        ...current[brfId],
        isPublicApplyEnabled: checked,
        isPublicApplyListed: checked ? current[brfId].isPublicApplyListed : false,
      },
    }))
  }

  const handleSave = async (brfId: string) => {
    const form = formsById[brfId]
    if (!form) return

    setSavingBrfId(brfId)
    setSuccessBrfId(null)
    setError(null)

    try {
      const response = await fetch('/api/renoapp/app/brf', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const payload = (await response.json().catch(() => ({}))) as { item?: BrfItem; error?: string }

      if (!response.ok || !payload.item) {
        throw new Error(payload.error ?? 'Kunde inte spara BRF-information.')
      }

      setItems((current) => current.map((item) => (item.id === brfId ? payload.item! : item)))
      setFormsById((current) => ({
        ...current,
        [brfId]: toFormState(payload.item!),
      }))
      setSuccessBrfId(brfId)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Kunde inte spara BRF-information.')
    } finally {
      setSavingBrfId(null)
    }
  }

  return (
    <div className="grid gap-6">
      <section className="rounded-[32px] border border-stone-200/80 bg-white/85 p-8 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">BRF</p>
        <h2 className="mt-4 text-4xl font-semibold tracking-tight text-stone-900">BRF-information</h2>
        <p className="mt-4 max-w-3xl text-base leading-8 text-stone-700">
          Här kan du redigera BRF:ens uppgifter, kontaktinformation och hur den publika ansökan ska fungera.
        </p>
        {error ? <p className="mt-4 text-sm text-rose-700">{error}</p> : null}
      </section>

      {loading ? (
        <section className="rounded-[32px] border border-stone-200/80 bg-white/85 p-8 text-sm text-stone-600 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
          Laddar BRF-information...
        </section>
      ) : items.length === 0 ? (
        <section className="rounded-[32px] border border-stone-200/80 bg-white/85 p-8 text-sm text-stone-600 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
          Ingen BRF hittades för den inloggade användaren.
        </section>
      ) : (
        <section className="grid gap-5">
          {items.map((item) => {
            const form = formsById[item.id]
            if (!form) return null

            return (
              <article
                key={item.id}
                className="rounded-[28px] border border-stone-200/80 bg-white/85 p-6 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">{item.slug}</p>
                    <h3 className="mt-2 text-2xl font-semibold text-stone-900">{item.name}</h3>
                    <p className="mt-2 text-sm text-stone-600">
                      Onboarding slutförd: {formatDateTime(item.onboardingCompletedAt)}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700">
                    <p className="font-semibold text-stone-900">Ansökningslänk</p>
                    <p className="mt-1 break-all">/renoapp/brf/{item.slug}/apply</p>
                  </div>
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-2">
                  <InputField
                    label="BRF-namn"
                    required
                    value={form.name}
                    onChange={(value) => updateField(item.id, 'name', value)}
                  />
                  <InputField label="Slug" value={item.slug} readOnly />
                  <InputField
                    label="Organisationsnummer"
                    required
                    value={form.orgNumber}
                    onChange={(value) => updateField(item.id, 'orgNumber', value)}
                    placeholder="XXXXXX-XXXX"
                  />
                  <InputField
                    label="Fastighetsbeteckning"
                    required
                    value={form.propertyDesignation}
                    onChange={(value) => updateField(item.id, 'propertyDesignation', value)}
                  />
                  <InputField
                    label="Gatuadress"
                    required
                    value={form.address}
                    onChange={(value) => updateField(item.id, 'address', value)}
                    className="md:col-span-2"
                  />
                  <InputField
                    label="Adressrad 2"
                    value={form.addressLine2}
                    onChange={(value) => updateField(item.id, 'addressLine2', value)}
                    className="md:col-span-2"
                    placeholder="C/o eller adressrad 2"
                  />
                  <InputField
                    label="Postnummer"
                    required
                    value={form.postalCode}
                    onChange={(value) => updateField(item.id, 'postalCode', value)}
                    inputMode="numeric"
                    placeholder="123 45"
                  />
                  <InputField
                    label="Ort"
                    required
                    value={form.city}
                    onChange={(value) => updateField(item.id, 'city', value)}
                  />
                  <InputField
                    label="Allmän BRF-e-post"
                    value={form.generalEmail}
                    onChange={(value) => updateField(item.id, 'generalEmail', value)}
                    type="email"
                  />
                  <InputField
                    label="BRF-telefon"
                    value={form.brfPhone}
                    onChange={(value) => updateField(item.id, 'brfPhone', value)}
                  />
                  <InputField
                    label="Fakturaadress"
                    required
                    value={form.invoiceAddress}
                    onChange={(value) => updateField(item.id, 'invoiceAddress', value)}
                    className="md:col-span-2"
                  />
                  <InputField
                    label="Faktura-e-post"
                    required
                    value={form.invoiceEmail}
                    onChange={(value) => updateField(item.id, 'invoiceEmail', value)}
                    type="email"
                  />
                  <InputField
                    label="Fakturareferens"
                    value={form.invoiceReference}
                    onChange={(value) => updateField(item.id, 'invoiceReference', value)}
                  />
                  <InputField
                    label="Kontaktperson namn"
                    required
                    value={form.primaryContactName}
                    onChange={(value) => updateField(item.id, 'primaryContactName', value)}
                  />
                  <InputField
                    label="Kontaktperson e-post"
                    required
                    value={form.primaryContactEmail}
                    onChange={(value) => updateField(item.id, 'primaryContactEmail', value)}
                    type="email"
                  />
                  <InputField
                    label="Kontaktperson telefon"
                    required
                    value={form.primaryContactPhone}
                    onChange={(value) => updateField(item.id, 'primaryContactPhone', value)}
                  />
                  <InputField
                    label="Antal lägenheter"
                    value={form.unitCount}
                    onChange={(value) => updateField(item.id, 'unitCount', value)}
                    inputMode="numeric"
                  />
                  <InputField
                    label="Teknisk förvaltare eller extern kontakt"
                    value={form.technicalContact}
                    onChange={(value) => updateField(item.id, 'technicalContact', value)}
                    className="md:col-span-2"
                  />
                  <div className="md:col-span-2">
                    <TextAreaField
                      label="Text på ansökningssidan"
                      value={form.applyIntroText}
                      onChange={(value) => updateField(item.id, 'applyIntroText', value)}
                      placeholder="Kort text som visas för boende på ansökningssidan."
                    />
                  </div>
                </div>

                <div className="mt-6 grid gap-3 rounded-3xl border border-stone-200 bg-stone-50 p-5">
                  <p className="text-sm font-semibold text-stone-900">Publik ansökan</p>

                  <label className="flex items-start gap-3 rounded-2xl border border-stone-200 bg-white px-4 py-4 text-sm text-stone-700">
                    <input
                      type="checkbox"
                      checked={form.isPublicApplyEnabled}
                      onChange={(event) => handleTogglePublicApply(item.id, event.target.checked)}
                      className="mt-1"
                    />
                    <div>
                      <p className="font-semibold text-stone-900">Publik ansökan aktiv</p>
                      <p className="mt-1 leading-6 text-stone-600">
                        När detta är aktivt kan boende skicka in ansökningar till BRF:en via RenoApp.
                      </p>
                    </div>
                  </label>

                  <label className="flex items-start gap-3 rounded-2xl border border-stone-200 bg-white px-4 py-4 text-sm text-stone-700">
                    <input
                      type="checkbox"
                      checked={form.isPublicApplyListed}
                      onChange={(event) => updateField(item.id, 'isPublicApplyListed', event.target.checked)}
                      disabled={!form.isPublicApplyEnabled}
                      className="mt-1"
                    />
                    <div>
                      <p className="font-semibold text-stone-900">Synlig i öppen BRF-lista</p>
                      <p className="mt-1 leading-6 text-stone-600">
                        När detta är aktivt visas BRF:en i den öppna listan på <span className="font-medium">/renoapp/apply</span>.
                      </p>
                    </div>
                  </label>
                </div>

                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void handleSave(item.id)}
                    disabled={savingBrfId === item.id}
                    className="rounded-full bg-stone-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {savingBrfId === item.id ? 'Sparar...' : 'Spara BRF-information'}
                  </button>
                  {successBrfId === item.id ? (
                    <p className="text-sm text-emerald-700">Ändringarna är sparade.</p>
                  ) : null}
                </div>
              </article>
            )
          })}
        </section>
      )}
    </div>
  )
}
