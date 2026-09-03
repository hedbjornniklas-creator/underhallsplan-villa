'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { FileCheck2, Loader2, Mail, RotateCcw, Save, X } from 'lucide-react'
import { useEbToast } from '@/components/eb/EbToastProvider'
import type {
  EbAssignmentConfirmationForm,
  EbAssignmentConfirmationSummary,
  EbAssignmentDetails,
} from '@/lib/eb/assignmentConfirmationTypes'
import type { EbInspectionSummary, EbProjectListItem } from '@/lib/eb/server'

type Props = {
  open: boolean
  project: EbProjectListItem
  inspection: EbInspectionSummary | null
  onClose: () => void
  onUpdated: (summary: EbAssignmentConfirmationSummary) => void
}

type ApiResponse = {
  confirmation?: EbAssignmentConfirmationForm
  acceptUrl?: string
  error?: string
}

const inputClass =
  'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-600'

const BUSINESS_CONTRACTS = ['AB 04', 'ABT 06']
const CONSUMER_OFFER_CONTRACT = 'Konsumententreprenad – godkänd offert eller annat avtal'
const CONSUMER_CONTRACTS = [
  'ABS 18',
  'Hantverkarformuläret 17',
  CONSUMER_OFFER_CONTRACT,
]

function statusLabel(status: EbAssignmentConfirmationForm['status']) {
  if (status === 'not_created') return 'Inte skapad'
  if (status === 'draft') return 'Utkast'
  if (status === 'sent') return 'Skickad – inväntar godkännande'
  if (status === 'ordered' || status === 'booked') return 'Godkänd'
  if (status === 'cancelled') return 'Ersatt eller avbruten'
  if (status === 'expired') return 'Utgången'
  if (status === 'completed') return 'Slutförd'
  return status
}

function toSummary(form: EbAssignmentConfirmationForm): EbAssignmentConfirmationSummary | null {
  if (!form.assignmentId || form.status === 'not_created') return null
  return {
    assignmentId: form.assignmentId,
    inspectionId: '',
    versionNo: form.versionNo,
    status: form.status,
    acceptedAt: form.acceptedAt,
    lastSentAt: form.lastSentAt,
    customerEmail: form.customerEmail,
    priceAmount: form.priceAmount,
    currency: form.currency,
    pricingModel: form.details.pricingModel,
  }
}

function payload(form: EbAssignmentConfirmationForm) {
  return {
    customerName: form.customerName,
    customerEmail: form.customerEmail,
    customerPhone: form.customerPhone,
    customerAddress: form.customerAddress,
    customerPostalCode: form.customerPostalCode,
    customerCity: form.customerCity,
    propertyAddress: form.propertyAddress,
    propertyPostalCode: form.propertyPostalCode,
    propertyCity: form.propertyCity,
    propertyMunicipality: form.propertyMunicipality,
    propertyDesignation: form.propertyDesignation,
    propertyOwnerName: form.propertyOwnerName,
    scopeDescription: form.scopeDescription,
    preferredDate: form.preferredDate,
    preferredTime: form.preferredTime,
    priceAmount: form.priceAmount,
    currency: form.currency,
    invoiceName: form.invoiceName,
    invoiceOrgNo: form.invoiceOrgNo,
    invoiceEmail: form.invoiceEmail,
    invoiceAddress: form.invoiceAddress,
    details: form.details,
  }
}

function money(value: number | null, currency: string) {
  if (value === null) return 'Ej angivet'
  return `${value.toLocaleString('sv-SE', { maximumFractionDigits: 2 })} ${currency}`
}

export default function EbAssignmentConfirmationDialog({
  open,
  project,
  inspection,
  onClose,
  onUpdated,
}: Props) {
  const { showError } = useEbToast()
  const [form, setForm] = useState<EbAssignmentConfirmationForm | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<'save' | 'send' | 'reissue' | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const operationRef = useRef(false)
  const endpoint = inspection
    ? `/api/eb/projects/${project.id}/inspections/${inspection.inspectionId}/assignment-confirmation`
    : ''

  useEffect(() => {
    if (!open || !inspection) return
    let cancelled = false
    const load = async () => {
      try {
        setLoading(true)
        setMessage(null)
        const response = await fetch(endpoint, { cache: 'no-store' })
        const result = (await response.json().catch(() => ({}))) as ApiResponse
        if (!response.ok || !result.confirmation) {
          throw new Error(result.error ?? 'Kunde inte hämta uppdragsbekräftelsen.')
        }
        if (!cancelled) {
          setForm(result.confirmation)
          const summary = toSummary(result.confirmation)
          if (summary) onUpdated({ ...summary, inspectionId: inspection.inspectionId })
        }
      } catch (error) {
        if (!cancelled) showError(error, 'Kunde inte hämta uppdragsbekräftelsen.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [endpoint, inspection, onUpdated, open, showError])

  const editable = form?.status === 'draft' || form?.status === 'not_created'
  const canReissue =
    form?.status === 'sent' || form?.status === 'ordered' || form?.status === 'booked'
  const priceLabel = form?.details.pricingModel === 'hourly' ? 'Timpris' : 'Fast pris'
  const previewFacts = useMemo(() => {
    if (!form || !inspection) return []
    return [
      ['Uppdrag', inspection.variantLabel],
      ['Entreprenad', project.contractName || project.title],
      ['Objekt', [form.propertyDesignation, form.propertyAddress].filter(Boolean).join(' – ')],
      ['Uppdragsgivare', form.customerName],
      ['Beställartyp', form.details.customerType === 'consumer' ? 'Privatperson/konsument' : 'Företag/organisation'],
      ['Entreprenadavtal', form.details.underlyingContract],
      ['Tid', [form.preferredDate, form.preferredTime].filter(Boolean).join(' ')],
      [priceLabel, money(form.priceAmount, form.currency)],
      ['Moms', form.details.vatIncluded ? 'Ingår' : 'Tillkommer'],
      ['Villkor', `${form.details.contractTerms} · ${form.details.paymentTerms}`],
    ]
  }, [form, inspection, priceLabel, project.contractName, project.title])

  if (!open || !inspection) return null

  const update = <K extends keyof EbAssignmentConfirmationForm>(
    key: K,
    value: EbAssignmentConfirmationForm[K]
  ) => setForm((current) => (current ? { ...current, [key]: value } : current))

  const updateDetails = <K extends keyof EbAssignmentDetails>(
    key: K,
    value: EbAssignmentDetails[K]
  ) => setForm((current) => (current ? { ...current, details: { ...current.details, [key]: value } } : current))

  const updateCustomerType = (value: string) => {
    const nextType = value === 'consumer' ? 'consumer' : 'business'
    setForm((current) => {
      if (!current) return current
      const knownContracts = [...BUSINESS_CONTRACTS, ...CONSUMER_CONTRACTS]
      const currentContract = current.details.underlyingContract
      const shouldReplaceContract = !currentContract || knownContracts.includes(currentContract)
      return {
        ...current,
        details: {
          ...current.details,
          customerType: nextType,
          vatIncluded: nextType === 'consumer',
          contractTerms:
            nextType === 'consumer' ? 'ABK 09 med konsumentanpassningar' : 'ABK 09',
          underlyingContract: shouldReplaceContract
            ? nextType === 'consumer'
              ? 'ABS 18'
              : 'AB 04'
            : currentContract,
        },
      }
    })
  }

  const request = async (mode: 'save' | 'send') => {
    if (!form || operationRef.current) return
    try {
      operationRef.current = true
      setBusy(mode)
      setMessage(null)
      const response = await fetch(endpoint, {
        method: mode === 'send' ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload(form)),
      })
      const result = (await response.json().catch(() => ({}))) as ApiResponse
      if (!response.ok || !result.confirmation) {
        throw new Error(result.error ?? `Kunde inte ${mode === 'send' ? 'skicka' : 'spara'} uppdragsbekräftelsen.`)
      }
      setForm(result.confirmation)
      const summary = toSummary(result.confirmation)
      if (summary) onUpdated({ ...summary, inspectionId: inspection.inspectionId })
      setMessage(mode === 'send' ? 'Uppdragsbekräftelsen är skickad.' : 'Utkastet är sparat.')
    } catch (error) {
      showError(error, mode === 'send' ? 'Kunde inte skicka uppdragsbekräftelsen.' : 'Kunde inte spara uppdragsbekräftelsen.')
    } finally {
      operationRef.current = false
      setBusy(null)
    }
  }

  const reissue = async () => {
    if (operationRef.current) return
    if (!window.confirm('Den nuvarande versionen behålls i historiken och ersätts av ett nytt redigerbart utkast. Fortsätta?')) return
    try {
      operationRef.current = true
      setBusy('reissue')
      setMessage(null)
      const response = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reissue' }),
      })
      const result = (await response.json().catch(() => ({}))) as ApiResponse
      if (!response.ok || !result.confirmation) throw new Error(result.error ?? 'Kunde inte skapa ny version.')
      setForm(result.confirmation)
      const summary = toSummary(result.confirmation)
      if (summary) onUpdated({ ...summary, inspectionId: inspection.inspectionId })
      setMessage('En ny redigerbar version har skapats.')
    } catch (error) {
      showError(error, 'Kunde inte skapa ny version.')
    } finally {
      operationRef.current = false
      setBusy(null)
    }
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/55 p-3">
      <div className="max-h-[94vh] w-full max-w-6xl overflow-hidden rounded-xl border border-emerald-100 bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-emerald-100 px-4 py-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
              {inspection.variant} · Version {form?.versionNo ?? 1}
            </p>
            <h2 className="text-lg font-semibold text-gray-950">Uppdragsbekräftelse</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading || Boolean(busy)}
            aria-label="Stäng"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </header>

        <div className="max-h-[calc(94vh-65px)] overflow-auto p-4">
          {loading || !form ? (
            <div className="flex items-center gap-2 py-12 text-sm text-gray-600">
              <Loader2 size={18} className="animate-spin text-emerald-700" />
              Laddar uppdragsbekräftelsen...
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${form.acceptedAt ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                  {statusLabel(form.status)}
                </span>
                {form.lastSentAt ? <span className="text-xs text-gray-600">Senast skickad {new Date(form.lastSentAt).toLocaleString('sv-SE')}</span> : null}
              </div>
              {message ? <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div> : null}
              {!editable ? (
                <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
                  {canReissue
                    ? 'Den här versionen är låst. Skapa en ny version om uppgifterna behöver ändras.'
                    : 'Den här versionen är låst och kan inte längre ändras.'}
                </div>
              ) : null}

              <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                <div className="space-y-4">
                  <Panel title="Uppdrag och mottagare">
                    <div className="grid gap-3 md:grid-cols-2">
                      <SelectField
                        label="Beställartyp *"
                        value={form.details.customerType}
                        disabled={!editable}
                        onChange={updateCustomerType}
                      >
                        <option value="business">Företag/organisation</option>
                        <option value="consumer">Privatperson/konsument</option>
                      </SelectField>
                      <SelectField
                        label="Entreprenadens standardavtal *"
                        value={form.details.underlyingContract}
                        disabled={!editable}
                        onChange={(value) => updateDetails('underlyingContract', value)}
                      >
                        <option value="">Välj standardavtal</option>
                        {(form.details.customerType === 'consumer'
                          ? CONSUMER_CONTRACTS
                          : BUSINESS_CONTRACTS
                        ).map((contract) => (
                          <option key={contract} value={contract}>{contract}</option>
                        ))}
                        {form.details.underlyingContract &&
                        ![...BUSINESS_CONTRACTS, ...CONSUMER_CONTRACTS].includes(
                          form.details.underlyingContract
                        ) ? (
                          <option value={form.details.underlyingContract}>
                            {form.details.underlyingContract}
                          </option>
                        ) : null}
                      </SelectField>
                      <Field label="Uppdragsgivare" value={form.customerName} disabled={!editable} onChange={(value) => update('customerName', value)} />
                      <Field label="E-post för godkännande *" type="email" value={form.customerEmail} disabled={!editable} onChange={(value) => update('customerEmail', value)} />
                      <Field label="Telefon" value={form.customerPhone} disabled={!editable} onChange={(value) => update('customerPhone', value)} />
                      <Field label="Fastighetsbeteckning *" value={form.propertyDesignation} disabled={!editable} onChange={(value) => update('propertyDesignation', value)} />
                    </div>
                    <TextArea label="Uppdragets omfattning *" value={form.scopeDescription} disabled={!editable} onChange={(value) => update('scopeDescription', value)} />
                    <TextArea label="Underlag och kontraktshandlingar" value={form.details.basisDocuments} disabled={!editable} onChange={(value) => updateDetails('basisDocuments', value)} />
                    <TextArea label="Genomförande och avgränsningar" value={form.details.executionNotes} disabled={!editable} onChange={(value) => updateDetails('executionNotes', value)} />
                    <TextArea label="Övriga tider och hållpunkter" value={form.details.scheduleNotes} disabled={!editable} onChange={(value) => updateDetails('scheduleNotes', value)} />
                  </Panel>

                  <Panel title="Tid och ekonomi">
                    <div className="grid gap-3 md:grid-cols-2">
                      <Field label="Besiktningsdatum *" type="date" value={form.preferredDate} disabled={!editable} onChange={(value) => update('preferredDate', value)} />
                      <Field label="Tid *" type="time" value={form.preferredTime} disabled={!editable} onChange={(value) => update('preferredTime', value)} />
                      <SelectField label="Prisform" value={form.details.pricingModel} disabled={!editable} onChange={(value) => updateDetails('pricingModel', value === 'hourly' ? 'hourly' : 'fixed')}>
                        <option value="fixed">Fast pris</option>
                        <option value="hourly">Timpris</option>
                      </SelectField>
                      <NumberField label={`${priceLabel} (SEK) *`} value={form.priceAmount} disabled={!editable} onChange={(value) => update('priceAmount', value)} />
                      <NumberField label="Timpris biträdande besiktningsman" value={form.details.assistantHourlyRate} disabled={!editable} onChange={(value) => updateDetails('assistantHourlyRate', value)} />
                      <NumberField label="Budget/takpris" value={form.details.budgetAmount} disabled={!editable} onChange={(value) => updateDetails('budgetAmount', value)} />
                      <NumberField label="Påslag externa kostnader (%)" value={form.details.expenseMarkupPercent} disabled={!editable} onChange={(value) => updateDetails('expenseMarkupPercent', value)} />
                      <Field label="Betalningsvillkor" value={form.details.paymentTerms} disabled={!editable} onChange={(value) => updateDetails('paymentTerms', value)} />
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <Checkbox label="Resa ingår i priset" checked={form.details.travelIncluded} disabled={!editable} onChange={(checked) => updateDetails('travelIncluded', checked)} />
                      <Checkbox
                        label={
                          form.details.customerType === 'consumer'
                            ? 'Priser visas inklusive moms för konsument'
                            : 'Moms tillkommer för företag/organisation'
                        }
                        checked={form.details.vatIncluded}
                        disabled
                        onChange={() => undefined}
                      />
                    </div>
                    {!form.details.travelIncluded ? <Field label="Reseersättning" value={form.details.travelTerms} disabled={!editable} onChange={(value) => updateDetails('travelTerms', value)} /> : null}
                    <TextArea label="Avbokningsvillkor" value={form.details.cancellationTerms} disabled={!editable} onChange={(value) => updateDetails('cancellationTerms', value)} />
                    <Field label="Ansvarsförsäkring" value={form.details.insuranceTerms} disabled={!editable} onChange={(value) => updateDetails('insuranceTerms', value)} />
                    <TextArea label="Särskilda villkor" value={form.details.specialTerms} disabled={!editable} onChange={(value) => updateDetails('specialTerms', value)} />
                  </Panel>

                  <Panel title="Fakturering">
                    <div className="grid gap-3 md:grid-cols-2">
                      <Field label="Fakturamottagare" value={form.invoiceName} disabled={!editable} onChange={(value) => update('invoiceName', value)} />
                      <Field label="Org.nr/personnummer" value={form.invoiceOrgNo} disabled={!editable} onChange={(value) => update('invoiceOrgNo', value)} />
                      <Field label="Faktura-e-post" type="email" value={form.invoiceEmail} disabled={!editable} onChange={(value) => update('invoiceEmail', value)} />
                      <Field label="Referens/märkning" value={form.details.invoiceReference} disabled={!editable} onChange={(value) => updateDetails('invoiceReference', value)} />
                      <Field label="Fakturaadress" value={form.invoiceAddress} disabled={!editable} onChange={(value) => update('invoiceAddress', value)} />
                      <Field label="Postnummer och ort" value={[form.details.invoicePostalCode, form.details.invoiceCity].filter(Boolean).join(' ')} disabled />
                    </div>
                  </Panel>
                </div>

                <aside className="h-fit space-y-4 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 lg:sticky lg:top-0">
                  <div className="flex items-center gap-2 text-emerald-900">
                    <FileCheck2 size={18} />
                    <h3 className="font-semibold">Förhandsgranskning</h3>
                  </div>
                  <dl className="space-y-3">
                    {previewFacts.map(([label, value]) => (
                      <div key={label}>
                        <dt className="text-xs font-semibold uppercase tracking-wide text-emerald-800">{label}</dt>
                        <dd className="mt-0.5 whitespace-pre-wrap text-sm text-gray-800">{value || 'Ej angivet'}</dd>
                      </div>
                    ))}
                  </dl>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Omfattning</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">{form.scopeDescription || 'Ej angivet'}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Villkorsbilaga</p>
                    <p className="mt-1 text-sm text-gray-800">
                      {form.details.customerType === 'consumer'
                        ? 'Entreprenadbesiktning för konsument · ABK 09 med konsumentanpassningar · version 2026-08-22.eb-consumer.v1'
                        : 'Entreprenadbesiktning för företag/organisation · ABK 09 · version 2026-08-22.eb-business.v1'}
                    </p>
                  </div>
                </aside>
              </div>

              <footer className="flex flex-wrap justify-end gap-2 border-t border-gray-200 pt-4">
                <button type="button" onClick={onClose} disabled={Boolean(busy)} className="rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">Stäng</button>
                {editable ? (
                  <>
                    <button type="button" onClick={() => void request('save')} disabled={Boolean(busy)} aria-busy={busy === 'save'} className="inline-flex items-center gap-2 rounded-md border border-emerald-300 bg-white px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50">
                      {busy === 'save' ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                      {busy === 'save' ? 'Sparar...' : 'Spara utkast'}
                    </button>
                    <button type="button" onClick={() => void request('send')} disabled={Boolean(busy)} aria-busy={busy === 'send'} className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:bg-emerald-300">
                      {busy === 'send' ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}
                      {busy === 'send' ? 'Skickar...' : 'Skicka för godkännande'}
                    </button>
                  </>
                ) : canReissue ? (
                  <button type="button" onClick={() => void reissue()} disabled={Boolean(busy)} aria-busy={busy === 'reissue'} className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:bg-emerald-300">
                    {busy === 'reissue' ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />}
                    {busy === 'reissue' ? 'Skapar version...' : 'Skapa ny version'}
                  </button>
                ) : null}
              </footer>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4"><h3 className="font-semibold text-gray-950">{title}</h3>{children}</section>
}

function Field({ label, value, onChange, disabled, type = 'text' }: { label: string; value: string; onChange?: (value: string) => void; disabled?: boolean; type?: string }) {
  return <label className="space-y-1 text-sm font-medium text-gray-700"><span>{label}</span><input type={type} value={value} onChange={(event) => onChange?.(event.target.value)} disabled={disabled} className={inputClass} /></label>
}

function NumberField({ label, value, onChange, disabled }: { label: string; value: number | null; onChange: (value: number | null) => void; disabled?: boolean }) {
  return <label className="space-y-1 text-sm font-medium text-gray-700"><span>{label}</span><input type="number" min="0" step="0.01" value={value ?? ''} onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))} disabled={disabled} className={inputClass} /></label>
}

function TextArea({ label, value, onChange, disabled }: { label: string; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  return <label className="block space-y-1 text-sm font-medium text-gray-700"><span>{label}</span><textarea rows={4} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} className={inputClass} /></label>
}

function SelectField({ label, value, onChange, disabled, children }: { label: string; value: string; onChange: (value: string) => void; disabled?: boolean; children: ReactNode }) {
  return <label className="space-y-1 text-sm font-medium text-gray-700"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} className={inputClass}>{children}</select></label>
}

function Checkbox({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return <label className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} disabled={disabled} className="h-4 w-4 rounded border-gray-300" /><span>{label}</span></label>
}
