'use client'

import { useState, type ReactNode } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { EbProjectAgreementItem, EbProjectAgreementItemKind, EbProjectListItem } from '@/lib/eb/server'
import { resolveEbAgreementVocabulary } from '@/lib/eb/vocabulary'

export type EbProjectFormState = {
  title: string
  contractName: string
  objectDescription: string
  propertyDesignation: string
  brfApartmentNumber: string
  address: string
  postalCode: string
  city: string
  municipality: string
  standardAgreement: string
  contractForm: string
  procurementForm: string
  contractDate: string
  notePrefix: string
  clientName: string
  clientOrgNo: string
  clientAddress: string
  clientPostalCode: string
  clientCity: string
  contractorName: string
  contractorOrgNo: string
  contractorAddress: string
  contractorPostalCode: string
  contractorCity: string
  agreementItems: EbProjectAgreementItem[]
}

export const EMPTY_EB_PROJECT_FORM: EbProjectFormState = {
  title: '',
  contractName: '',
  objectDescription: '',
  propertyDesignation: '',
  brfApartmentNumber: '',
  address: '',
  postalCode: '',
  city: '',
  municipality: '',
  standardAgreement: '',
  contractForm: '',
  procurementForm: '',
  contractDate: '',
  notePrefix: 'BES',
  clientName: '',
  clientOrgNo: '',
  clientAddress: '',
  clientPostalCode: '',
  clientCity: '',
  contractorName: '',
  contractorOrgNo: '',
  contractorAddress: '',
  contractorPostalCode: '',
  contractorCity: '',
  agreementItems: [],
}

const STANDARD_AGREEMENT_OPTIONS = [
  { value: '', label: 'Välj' },
  { value: 'AB 04', label: 'AB 04' },
  { value: 'ABT 06', label: 'ABT 06' },
  { value: 'ABS 18', label: 'ABS 18' },
  { value: 'HF17', label: 'HF 17' },
]

type EbProjectFormTab = 'object' | 'agreement' | 'contractors'

function createAgreementItem(kind: EbProjectAgreementItemKind, sortOrder: number): EbProjectAgreementItem {
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`

  return {
    id,
    kind,
    title: '',
    documentDate: null,
    note: null,
    includeInReport: true,
    sortOrder,
  }
}

export function buildEbProjectForm(project: EbProjectListItem): EbProjectFormState {
  return {
    title: project.title ?? '',
    contractName: project.contractName ?? '',
    objectDescription: project.objectDescription ?? '',
    propertyDesignation: project.propertyDesignation ?? '',
    brfApartmentNumber: project.brfApartmentNumber ?? '',
    address: project.address ?? '',
    postalCode: project.postalCode ?? '',
    city: project.city ?? '',
    municipality: project.municipality ?? '',
    standardAgreement: project.standardAgreement ?? '',
    contractForm: project.contractForm ?? '',
    procurementForm: project.procurementForm ?? '',
    contractDate: project.contractDate ?? '',
    notePrefix: project.notePrefix ?? 'BES',
    clientName: project.clientName ?? '',
    clientOrgNo: project.clientOrgNo ?? '',
    clientAddress: project.clientAddress ?? '',
    clientPostalCode: project.clientPostalCode ?? '',
    clientCity: project.clientCity ?? '',
    contractorName: project.contractorName ?? '',
    contractorOrgNo: project.contractorOrgNo ?? '',
    contractorAddress: project.contractorAddress ?? '',
    contractorPostalCode: project.contractorPostalCode ?? '',
    contractorCity: project.contractorCity ?? '',
    agreementItems: project.agreementItems ?? [],
  }
}

export function ebProjectFormToPayload(form: EbProjectFormState) {
  return { ...form }
}

export function ebProjectInputClassName() {
  return 'w-full rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm text-gray-950 shadow-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100'
}

export function EbProjectFieldLabel({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-gray-700">{label}</span>
      <span className="mt-1 block">{children}</span>
    </label>
  )
}

export default function EbProjectForm({
  form,
  onChange,
  showNotePrefix,
}: {
  form: EbProjectFormState
  onChange: <K extends keyof EbProjectFormState>(field: K, value: EbProjectFormState[K]) => void
  showNotePrefix?: boolean
}) {
  const [activeTab, setActiveTab] = useState<EbProjectFormTab>('object')
  const vocabulary = resolveEbAgreementVocabulary(form.standardAgreement)
  const tabs: Array<{ key: EbProjectFormTab; label: string }> = [
    { key: 'object', label: 'Objekt & beställare' },
    { key: 'agreement', label: 'Avtal' },
    { key: 'contractors', label: vocabulary.contractorPluralLabel },
  ]
  const changeOrders = form.agreementItems.filter((item) => item.kind === 'change_order')
  const otherAgreements = form.agreementItems.filter((item) => item.kind === 'other')

  const updateAgreementItem = <K extends keyof EbProjectAgreementItem>(
    id: string,
    field: K,
    value: EbProjectAgreementItem[K]
  ) => {
    onChange(
      'agreementItems',
      form.agreementItems.map((item) => item.id === id ? { ...item, [field]: value } : item)
    )
  }

  const addAgreementItem = (kind: EbProjectAgreementItemKind) => {
    onChange('agreementItems', [
      ...form.agreementItems,
      createAgreementItem(kind, (form.agreementItems.length + 1) * 100),
    ])
  }

  const removeAgreementItem = (id: string) => {
    onChange('agreementItems', form.agreementItems.filter((item) => item.id !== id))
  }

  const renderAgreementRows = (
    rows: EbProjectAgreementItem[],
    kind: EbProjectAgreementItemKind,
    emptyText: string
  ) => (
    <div className="space-y-3">
      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-emerald-200 bg-emerald-50/40 px-3 py-2 text-sm text-gray-600">
          {emptyText}
        </p>
      ) : null}

      {rows.map((item) => (
        <div key={item.id} className="rounded-md border border-emerald-100 bg-white p-3">
          <div className="grid gap-3 md:grid-cols-[1fr_150px_auto]">
            <EbProjectFieldLabel label={kind === 'change_order' ? 'ÄTA-handling' : 'Handling/överenskommelse'}>
              <input
                value={item.title}
                onChange={(event) => updateAgreementItem(item.id, 'title', event.target.value)}
                placeholder={kind === 'change_order' ? 'Bilaga till avtalet enligt formulär Ändring och tilläggsarbeten' : 'Ange handling eller överenskommelse'}
                className={ebProjectInputClassName()}
              />
            </EbProjectFieldLabel>
            <EbProjectFieldLabel label="Datum">
              <input
                type="date"
                value={item.documentDate ?? ''}
                onChange={(event) => updateAgreementItem(item.id, 'documentDate', event.target.value || null)}
                className={ebProjectInputClassName()}
              />
            </EbProjectFieldLabel>
            <div className="flex items-end justify-end gap-2">
              <label className="inline-flex h-10 items-center gap-2 rounded-md border border-emerald-100 bg-emerald-50/60 px-3 text-sm font-medium text-emerald-900">
                <input
                  type="checkbox"
                  checked={item.includeInReport}
                  onChange={(event) => updateAgreementItem(item.id, 'includeInReport', event.target.checked)}
                  className="h-4 w-4 rounded border-emerald-300 text-emerald-700 focus:ring-emerald-600"
                />
                Utlåtande
              </label>
              <button
                type="button"
                onClick={() => removeAgreementItem(item.id)}
                aria-label="Ta bort rad"
                title="Ta bort rad"
                className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-rose-200 bg-white text-rose-700 transition hover:bg-rose-50"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
          <div className="mt-3">
            <EbProjectFieldLabel label="Kommentar">
              <textarea
                value={item.note ?? ''}
                onChange={(event) => updateAgreementItem(item.id, 'note', event.target.value || null)}
                rows={2}
                className={`${ebProjectInputClassName()} resize-y leading-6`}
              />
            </EbProjectFieldLabel>
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={() => addAgreementItem(kind)}
        className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50"
      >
        <Plus size={16} />
        {kind === 'change_order' ? 'Lägg till ÄTA-handling' : 'Lägg till övrig handling'}
      </button>
    </div>
  )

  return (
    <div className="space-y-5">
      <div className="border-b border-emerald-100">
        <div className="flex flex-wrap gap-1">
          {tabs.map((tab) => {
            const selected = activeTab === tab.key
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={[
                  'rounded-t-md border px-3 py-2 text-sm font-semibold transition',
                  selected
                    ? 'border-emerald-200 border-b-white bg-white text-emerald-900'
                    : 'border-transparent text-gray-600 hover:bg-emerald-50 hover:text-emerald-800',
                ].join(' ')}
              >
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>

      {activeTab === 'object' ? (
        <section>
          <h3 className="text-sm font-semibold text-gray-950">Objekt och beställare</h3>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <EbProjectFieldLabel label="Projektnamn">
              <input
                value={form.title}
                onChange={(event) => onChange('title', event.target.value)}
                className={ebProjectInputClassName()}
                required
              />
            </EbProjectFieldLabel>
            <EbProjectFieldLabel label="Kontraktsnamn">
              <input
                value={form.contractName}
                onChange={(event) => onChange('contractName', event.target.value)}
                className={ebProjectInputClassName()}
              />
            </EbProjectFieldLabel>
            {showNotePrefix ? (
              <EbProjectFieldLabel label="Noteringsserie">
                <input
                  value={form.notePrefix}
                  onChange={(event) => onChange('notePrefix', event.target.value.toUpperCase())}
                  className={ebProjectInputClassName()}
                  maxLength={12}
                />
              </EbProjectFieldLabel>
            ) : null}
            <EbProjectFieldLabel label="Fastighetsbeteckning">
              <input
                value={form.propertyDesignation}
                onChange={(event) => onChange('propertyDesignation', event.target.value)}
                className={ebProjectInputClassName()}
              />
            </EbProjectFieldLabel>
            <EbProjectFieldLabel label="BRF och lgh nr">
              <input
                value={form.brfApartmentNumber}
                onChange={(event) => onChange('brfApartmentNumber', event.target.value)}
                placeholder="Exempel: Brf Solgläntan, lgh 1202"
                className={ebProjectInputClassName()}
              />
            </EbProjectFieldLabel>
            <EbProjectFieldLabel label="Kommun">
              <input
                value={form.municipality}
                onChange={(event) => onChange('municipality', event.target.value)}
                className={ebProjectInputClassName()}
              />
            </EbProjectFieldLabel>
            <div className="md:col-span-2">
              <EbProjectFieldLabel label="Beskrivning av entreprenaden">
                <textarea
                  value={form.objectDescription}
                  onChange={(event) => onChange('objectDescription', event.target.value)}
                  rows={3}
                  className={`${ebProjectInputClassName()} resize-y leading-6`}
                />
              </EbProjectFieldLabel>
            </div>
            <EbProjectFieldLabel label="Objektadress">
              <input
                value={form.address}
                onChange={(event) => onChange('address', event.target.value)}
                className={ebProjectInputClassName()}
              />
            </EbProjectFieldLabel>
            <div className="grid grid-cols-[0.7fr_1fr] gap-3">
              <EbProjectFieldLabel label="Postnummer">
                <input
                  value={form.postalCode}
                  onChange={(event) => onChange('postalCode', event.target.value)}
                  className={ebProjectInputClassName()}
                />
              </EbProjectFieldLabel>
              <EbProjectFieldLabel label="Ort">
                <input
                  value={form.city}
                  onChange={(event) => onChange('city', event.target.value)}
                  className={ebProjectInputClassName()}
                />
              </EbProjectFieldLabel>
            </div>
            <EbProjectFieldLabel label={vocabulary.clientLabel}>
              <input
                value={form.clientName}
                onChange={(event) => onChange('clientName', event.target.value)}
                className={ebProjectInputClassName()}
              />
            </EbProjectFieldLabel>
            <EbProjectFieldLabel label="Beställare org.nr">
              <input
                value={form.clientOrgNo}
                onChange={(event) => onChange('clientOrgNo', event.target.value)}
                className={ebProjectInputClassName()}
              />
            </EbProjectFieldLabel>
            <EbProjectFieldLabel label="Beställare adress">
              <input
                value={form.clientAddress}
                onChange={(event) => onChange('clientAddress', event.target.value)}
                className={ebProjectInputClassName()}
              />
            </EbProjectFieldLabel>
            <div className="grid grid-cols-[0.7fr_1fr] gap-3">
              <EbProjectFieldLabel label="Postnummer">
                <input
                  value={form.clientPostalCode}
                  onChange={(event) => onChange('clientPostalCode', event.target.value)}
                  className={ebProjectInputClassName()}
                />
              </EbProjectFieldLabel>
              <EbProjectFieldLabel label="Ort">
                <input
                  value={form.clientCity}
                  onChange={(event) => onChange('clientCity', event.target.value)}
                  className={ebProjectInputClassName()}
                />
              </EbProjectFieldLabel>
            </div>
          </div>
        </section>
      ) : null}

      {activeTab === 'agreement' ? (
        <section>
          <h3 className="text-sm font-semibold text-gray-950">Avtal</h3>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <EbProjectFieldLabel label="Standardavtal">
              <select
                value={form.standardAgreement}
                onChange={(event) => onChange('standardAgreement', event.target.value)}
                className={ebProjectInputClassName()}
              >
                {STANDARD_AGREEMENT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </EbProjectFieldLabel>
            <EbProjectFieldLabel label="Kontraktsdatum">
              <input
                type="date"
                value={form.contractDate}
                onChange={(event) => onChange('contractDate', event.target.value)}
                className={ebProjectInputClassName()}
              />
            </EbProjectFieldLabel>
            <EbProjectFieldLabel label="Entreprenadform">
              <input
                value={form.contractForm}
                onChange={(event) => onChange('contractForm', event.target.value)}
                className={ebProjectInputClassName()}
              />
            </EbProjectFieldLabel>
            <EbProjectFieldLabel label="Upphandlingsform">
              <input
                value={form.procurementForm}
                onChange={(event) => onChange('procurementForm', event.target.value)}
                className={ebProjectInputClassName()}
              />
            </EbProjectFieldLabel>
          </div>

          <div className="mt-6 space-y-6">
            <section>
              <div className="mb-3">
                <h4 className="text-sm font-semibold text-gray-950">ÄTA-handlingar</h4>
                <p className="mt-1 text-xs text-gray-600">
                  Lägg till ändringar och tilläggsarbeten som ska framgå i utlåtandet.
                </p>
              </div>
              {renderAgreementRows(
                changeOrders,
                'change_order',
                'Inga ÄTA-handlingar är tillagda.'
              )}
            </section>

            <section>
              <div className="mb-3">
                <h4 className="text-sm font-semibold text-gray-950">Övriga handlingar och överenskommelser</h4>
                <p className="mt-1 text-xs text-gray-600">
                  Ange övriga skriftliga eller muntliga överenskommelser som varit underlag för besiktningen.
                </p>
              </div>
              {renderAgreementRows(
                otherAgreements,
                'other',
                'Inga övriga handlingar eller överenskommelser är tillagda.'
              )}
            </section>
          </div>
        </section>
      ) : null}

      {activeTab === 'contractors' ? (
        <section>
          <h3 className="text-sm font-semibold text-gray-950">{vocabulary.contractorShortLabel}</h3>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <EbProjectFieldLabel label={vocabulary.contractorLabel}>
              <input
                value={form.contractorName}
                onChange={(event) => onChange('contractorName', event.target.value)}
                className={ebProjectInputClassName()}
              />
            </EbProjectFieldLabel>
            <EbProjectFieldLabel label={vocabulary.contractorOrgLabel}>
              <input
                value={form.contractorOrgNo}
                onChange={(event) => onChange('contractorOrgNo', event.target.value)}
                className={ebProjectInputClassName()}
              />
            </EbProjectFieldLabel>
            <EbProjectFieldLabel label={`${vocabulary.contractorShortLabel} adress`}>
              <input
                value={form.contractorAddress}
                onChange={(event) => onChange('contractorAddress', event.target.value)}
                className={ebProjectInputClassName()}
              />
            </EbProjectFieldLabel>
            <div className="grid grid-cols-[0.7fr_1fr] gap-3">
              <EbProjectFieldLabel label="Postnummer">
                <input
                  value={form.contractorPostalCode}
                  onChange={(event) => onChange('contractorPostalCode', event.target.value)}
                  className={ebProjectInputClassName()}
                />
              </EbProjectFieldLabel>
              <EbProjectFieldLabel label="Ort">
                <input
                  value={form.contractorCity}
                  onChange={(event) => onChange('contractorCity', event.target.value)}
                  className={ebProjectInputClassName()}
                />
              </EbProjectFieldLabel>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  )
}
