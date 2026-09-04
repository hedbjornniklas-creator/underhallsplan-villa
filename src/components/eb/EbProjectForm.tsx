'use client'

import { useState, type ReactNode } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { EbProjectAgreementItem, EbProjectAgreementItemKind, EbProjectListItem } from '@/lib/eb/server'
import { resolveEbAgreementVocabulary } from '@/lib/eb/vocabulary'

export type EbProjectFormState = {
  projectTemplateKey: string
  drainageSystem: string
  drainageInspectionStage: string
  drainageGuidanceVersion: string
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
  agreementNote: string
  notePrefix: string
  clientName: string
  clientOrgNo: string
  clientEmail: string
  clientPhone: string
  clientAddressMatchesObject: boolean
  clientAddress: string
  clientPostalCode: string
  clientCity: string
  clientIsPropertyOwner: boolean
  propertyOwnerName: string
  contractorName: string
  contractorOrgNo: string
  contractorEmail: string
  contractorPhone: string
  contractorAddress: string
  contractorPostalCode: string
  contractorCity: string
  invoiceRecipientMatchesClient: boolean
  invoiceName: string
  invoiceOrgNo: string
  invoiceReference: string
  invoiceEmailMatchesClient: boolean
  invoiceEmail: string
  invoiceAddressMatchesClient: boolean
  invoiceAddress: string
  invoicePostalCode: string
  invoiceCity: string
  agreementItems: EbProjectAgreementItem[]
}

export const EMPTY_EB_PROJECT_FORM: EbProjectFormState = {
  projectTemplateKey: '',
  drainageSystem: '',
  drainageInspectionStage: '',
  drainageGuidanceVersion: '',
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
  agreementNote: '',
  notePrefix: 'BES',
  clientName: '',
  clientOrgNo: '',
  clientEmail: '',
  clientPhone: '',
  clientAddressMatchesObject: false,
  clientAddress: '',
  clientPostalCode: '',
  clientCity: '',
  clientIsPropertyOwner: true,
  propertyOwnerName: '',
  contractorName: '',
  contractorOrgNo: '',
  contractorEmail: '',
  contractorPhone: '',
  contractorAddress: '',
  contractorPostalCode: '',
  contractorCity: '',
  invoiceRecipientMatchesClient: true,
  invoiceName: '',
  invoiceOrgNo: '',
  invoiceReference: '',
  invoiceEmailMatchesClient: true,
  invoiceEmail: '',
  invoiceAddressMatchesClient: true,
  invoiceAddress: '',
  invoicePostalCode: '',
  invoiceCity: '',
  agreementItems: [],
}

const STANDARD_AGREEMENT_OPTIONS = [
  { value: '', label: 'Välj' },
  { value: 'AB 04', label: 'AB 04' },
  { value: 'ABT 06', label: 'ABT 06' },
  { value: 'ABS 18', label: 'ABS 18' },
  { value: 'Konsumententreprenad', label: 'Konsumententreprenad' },
  { value: 'HF17', label: 'HF 17' },
  { value: 'Offert', label: 'Offert' },
]

const PROJECT_TEMPLATE_OPTIONS = [
  { value: '', label: 'Vanlig entreprenadbesiktning' },
  { value: 'drainage_foundation', label: 'Dräneringsbesiktning' },
]

const DRAINAGE_SYSTEM_OPTIONS = [
  { value: 'generic', label: 'Allmän mall' },
  { value: 'isodran', label: 'Isodrän' },
  { value: 'pordran', label: 'Pordrän' },
  { value: 'other', label: 'Annat system' },
]

const DRAINAGE_STAGE_OPTIONS = [
  { value: '', label: 'Ej satt' },
  { value: 'before_backfill', label: 'Före återfyllning' },
  { value: 'after_backfill', label: 'Efter återfyllning' },
  { value: 'partial', label: 'Delvis återfyllt / delvis åtkomligt' },
  { value: 'final', label: 'Slutkontroll' },
]

type EbProjectFormTab = 'object' | 'agreement' | 'contractors'

export type EbAgreementDocumentFieldRenderer = (input: {
  agreementKey: string
  label: string
  description: string
  agreementItem?: EbProjectAgreementItem
}) => ReactNode

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
    projectTemplateKey: project.projectTemplateKey ?? '',
    drainageSystem: project.drainageSystem ?? '',
    drainageInspectionStage: project.drainageInspectionStage ?? '',
    drainageGuidanceVersion: project.drainageGuidanceVersion ?? '',
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
    agreementNote: project.agreementNote ?? '',
    notePrefix: project.notePrefix ?? 'BES',
    clientName: project.clientName ?? '',
    clientOrgNo: project.clientOrgNo ?? '',
    clientEmail: project.clientEmail ?? '',
    clientPhone: project.clientPhone ?? '',
    clientAddressMatchesObject: project.clientAddressMatchesObject,
    clientAddress: project.clientAddress ?? '',
    clientPostalCode: project.clientPostalCode ?? '',
    clientCity: project.clientCity ?? '',
    clientIsPropertyOwner: project.clientIsPropertyOwner,
    propertyOwnerName: project.propertyOwnerName ?? '',
    contractorName: project.contractorName ?? '',
    contractorOrgNo: project.contractorOrgNo ?? '',
    contractorEmail: project.contractorEmail ?? '',
    contractorPhone: project.contractorPhone ?? '',
    contractorAddress: project.contractorAddress ?? '',
    contractorPostalCode: project.contractorPostalCode ?? '',
    contractorCity: project.contractorCity ?? '',
    invoiceRecipientMatchesClient: project.invoiceRecipientMatchesClient,
    invoiceName: project.invoiceName ?? '',
    invoiceOrgNo: project.invoiceOrgNo ?? '',
    invoiceReference: project.invoiceReference ?? '',
    invoiceEmailMatchesClient: project.invoiceEmailMatchesClient,
    invoiceEmail: project.invoiceEmail ?? '',
    invoiceAddressMatchesClient: project.invoiceAddressMatchesClient,
    invoiceAddress: project.invoiceAddress ?? '',
    invoicePostalCode: project.invoicePostalCode ?? '',
    invoiceCity: project.invoiceCity ?? '',
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

function EbSameAsCheckbox({
  checked,
  label,
  description,
  onChange,
}: {
  checked: boolean
  label: string
  description: string
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-emerald-100 bg-emerald-50/60 px-3 py-2.5 text-sm text-gray-800">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-emerald-700 focus:ring-emerald-500"
      />
      <span>
        <span className="block font-medium">{label}</span>
        <span className="mt-0.5 block text-xs text-gray-600">{description}</span>
      </span>
    </label>
  )
}

function EbResolvedValue({ value, emptyText }: { value: string; emptyText: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
      {value || emptyText}
    </div>
  )
}

export default function EbProjectForm({
  form,
  onChange,
  showNotePrefix,
  renderAgreementDocumentField,
}: {
  form: EbProjectFormState
  onChange: <K extends keyof EbProjectFormState>(field: K, value: EbProjectFormState[K]) => void
  showNotePrefix?: boolean
  renderAgreementDocumentField?: EbAgreementDocumentFieldRenderer
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
  const objectAddressLine = [form.address, [form.postalCode, form.city].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ')
  const resolvedClientAddressLine = form.clientAddressMatchesObject
    ? objectAddressLine
    : [form.clientAddress, [form.clientPostalCode, form.clientCity].filter(Boolean).join(' ')]
        .filter(Boolean)
        .join(', ')
  const resolvedInvoiceName = form.invoiceRecipientMatchesClient ? form.clientName : form.invoiceName
  const resolvedInvoiceEmail = form.invoiceEmailMatchesClient ? form.clientEmail : form.invoiceEmail
  const resolvedInvoiceAddressLine = form.invoiceAddressMatchesClient
    ? resolvedClientAddressLine
    : [form.invoiceAddress, [form.invoicePostalCode, form.invoiceCity].filter(Boolean).join(' ')]
        .filter(Boolean)
        .join(', ')

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

  const updateTemplateKey = (value: string) => {
    onChange('projectTemplateKey', value)
    if (value === 'drainage_foundation') {
      if (!form.drainageSystem) onChange('drainageSystem', 'generic')
      if (form.notePrefix === 'BES') onChange('notePrefix', 'DRÄN')
      return
    }
    onChange('drainageSystem', '')
    onChange('drainageInspectionStage', '')
    onChange('drainageGuidanceVersion', '')
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
          {renderAgreementDocumentField?.({
            agreementKey: item.id,
            label: kind === 'change_order' ? 'ÄTA-dokument' : 'Dokument för överenskommelsen',
            description: 'Koppla en eller flera handlingar som hör till denna rad.',
            agreementItem: item,
          })}
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
      <section className="rounded-lg border border-emerald-100 bg-emerald-50/25 p-3">
        <div className="grid gap-4 md:grid-cols-2">
          <EbProjectFieldLabel label="Projekttyp">
            <select
              value={form.projectTemplateKey}
              onChange={(event) => updateTemplateKey(event.target.value)}
              className={ebProjectInputClassName()}
            >
              {PROJECT_TEMPLATE_OPTIONS.map((option) => (
                <option key={option.value || 'none'} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </EbProjectFieldLabel>

          {form.projectTemplateKey === 'drainage_foundation' ? (
            <>
              <EbProjectFieldLabel label="System">
                <select
                  value={form.drainageSystem || 'generic'}
                  onChange={(event) => onChange('drainageSystem', event.target.value)}
                  className={ebProjectInputClassName()}
                >
                  {DRAINAGE_SYSTEM_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </EbProjectFieldLabel>
              <EbProjectFieldLabel label="Besiktningsläge">
                <select
                  value={form.drainageInspectionStage}
                  onChange={(event) => onChange('drainageInspectionStage', event.target.value)}
                  className={ebProjectInputClassName()}
                >
                  {DRAINAGE_STAGE_OPTIONS.map((option) => (
                    <option key={option.value || 'none'} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </EbProjectFieldLabel>
              <EbProjectFieldLabel label="Anvisning/version">
                <input
                  value={form.drainageGuidanceVersion}
                  onChange={(event) => onChange('drainageGuidanceVersion', event.target.value)}
                  placeholder="Exempel: Isodrän arbetsinstruktion källare 2026"
                  className={ebProjectInputClassName()}
                />
              </EbProjectFieldLabel>
            </>
          ) : null}
        </div>
      </section>

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
            <div className="md:col-span-2 mt-2 border-t border-emerald-100 pt-4">
              <h4 className="text-sm font-semibold text-gray-950">Beställare och fastighetsägare</h4>
              <p className="mt-1 text-xs text-gray-600">Kontaktuppgifterna används även som förval för kallelser.</p>
            </div>
            <EbProjectFieldLabel label={vocabulary.clientLabel}>
              <input
                value={form.clientName}
                onChange={(event) => onChange('clientName', event.target.value)}
                className={ebProjectInputClassName()}
              />
            </EbProjectFieldLabel>
            <EbProjectFieldLabel label="Beställare org.nr / personnummer">
              <input
                value={form.clientOrgNo}
                onChange={(event) => onChange('clientOrgNo', event.target.value)}
                className={ebProjectInputClassName()}
              />
            </EbProjectFieldLabel>
            <EbProjectFieldLabel label="Beställare e-post">
              <input
                type="email"
                value={form.clientEmail}
                onChange={(event) => onChange('clientEmail', event.target.value)}
                className={ebProjectInputClassName()}
              />
            </EbProjectFieldLabel>
            <EbProjectFieldLabel label="Beställare telefon">
              <input
                type="tel"
                value={form.clientPhone}
                onChange={(event) => onChange('clientPhone', event.target.value)}
                className={ebProjectInputClassName()}
              />
            </EbProjectFieldLabel>
            <div className="md:col-span-2">
              <EbSameAsCheckbox
                checked={form.clientAddressMatchesObject}
                label="Beställarens adress är samma som objektadressen"
                description="Adress, postnummer och ort följer objektuppgifterna."
                onChange={(checked) => onChange('clientAddressMatchesObject', checked)}
              />
            </div>
            {form.clientAddressMatchesObject ? (
              <div className="md:col-span-2">
                <EbResolvedValue value={objectAddressLine} emptyText="Objektadress saknas." />
              </div>
            ) : (
              <>
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
              </>
            )}
            <div className="md:col-span-2">
              <EbSameAsCheckbox
                checked={form.clientIsPropertyOwner}
                label="Beställaren är fastighetsägare"
                description="Avmarkera om objektet ägs av någon annan."
                onChange={(checked) => onChange('clientIsPropertyOwner', checked)}
              />
            </div>
            {form.clientIsPropertyOwner ? (
              <div className="md:col-span-2">
                <EbResolvedValue value={form.clientName} emptyText="Beställarens namn saknas." />
              </div>
            ) : (
              <EbProjectFieldLabel label="Fastighetsägare">
                <input
                  value={form.propertyOwnerName}
                  onChange={(event) => onChange('propertyOwnerName', event.target.value)}
                  className={ebProjectInputClassName()}
                />
              </EbProjectFieldLabel>
            )}
          </div>
          <details className="mt-5 rounded-lg border border-emerald-100 bg-white">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-gray-950">
              Standardvärden för fakturering
            </summary>
            <div className="border-t border-emerald-100 p-4">
              <p className="mb-4 text-xs text-gray-600">
                Kopieras till nya besiktningar. Fakturauppgifterna kan därefter ändras separat för varje besiktning och visas inte i utlåtandet.
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <EbSameAsCheckbox
                    checked={form.invoiceRecipientMatchesClient}
                    label="Fakturamottagaren är beställaren"
                    description="Namn och org.nr/personnummer följer beställarens uppgifter."
                    onChange={(checked) => onChange('invoiceRecipientMatchesClient', checked)}
                  />
                </div>
                {form.invoiceRecipientMatchesClient ? (
                  <div className="md:col-span-2">
                    <EbResolvedValue
                      value={[resolvedInvoiceName, form.clientOrgNo].filter(Boolean).join(', ')}
                      emptyText="Beställaruppgifter saknas."
                    />
                  </div>
                ) : (
                  <>
                    <EbProjectFieldLabel label="Fakturamottagare">
                      <input
                        value={form.invoiceName}
                        onChange={(event) => onChange('invoiceName', event.target.value)}
                        className={ebProjectInputClassName()}
                      />
                    </EbProjectFieldLabel>
                    <EbProjectFieldLabel label="Org.nr / personnummer">
                      <input
                        value={form.invoiceOrgNo}
                        onChange={(event) => onChange('invoiceOrgNo', event.target.value)}
                        className={ebProjectInputClassName()}
                      />
                    </EbProjectFieldLabel>
                  </>
                )}
                <EbProjectFieldLabel label="Fakturareferens">
                  <input
                    value={form.invoiceReference}
                    onChange={(event) => onChange('invoiceReference', event.target.value)}
                    className={ebProjectInputClassName()}
                  />
                </EbProjectFieldLabel>
                <div className="md:col-span-2">
                  <EbSameAsCheckbox
                    checked={form.invoiceEmailMatchesClient}
                    label="Faktura-e-post är samma som beställarens e-post"
                    description="Avmarkera om fakturan ska skickas till en annan e-postadress."
                    onChange={(checked) => onChange('invoiceEmailMatchesClient', checked)}
                  />
                </div>
                {form.invoiceEmailMatchesClient ? (
                  <div className="md:col-span-2">
                    <EbResolvedValue value={resolvedInvoiceEmail} emptyText="Beställarens e-post saknas." />
                  </div>
                ) : (
                  <EbProjectFieldLabel label="Faktura-e-post">
                    <input
                      type="email"
                      value={form.invoiceEmail}
                      onChange={(event) => onChange('invoiceEmail', event.target.value)}
                      className={ebProjectInputClassName()}
                    />
                  </EbProjectFieldLabel>
                )}
                <div className="md:col-span-2">
                  <EbSameAsCheckbox
                    checked={form.invoiceAddressMatchesClient}
                    label="Fakturaadressen är samma som beställarens adress"
                    description="Adress, postnummer och ort följer beställarens effektiva adress."
                    onChange={(checked) => onChange('invoiceAddressMatchesClient', checked)}
                  />
                </div>
                {form.invoiceAddressMatchesClient ? (
                  <div className="md:col-span-2">
                    <EbResolvedValue value={resolvedInvoiceAddressLine} emptyText="Beställaradress saknas." />
                  </div>
                ) : (
                  <>
                    <EbProjectFieldLabel label="Fakturaadress">
                      <input
                        value={form.invoiceAddress}
                        onChange={(event) => onChange('invoiceAddress', event.target.value)}
                        className={ebProjectInputClassName()}
                      />
                    </EbProjectFieldLabel>
                    <div className="grid grid-cols-[0.7fr_1fr] gap-3">
                      <EbProjectFieldLabel label="Postnummer">
                        <input
                          value={form.invoicePostalCode}
                          onChange={(event) => onChange('invoicePostalCode', event.target.value)}
                          className={ebProjectInputClassName()}
                        />
                      </EbProjectFieldLabel>
                      <EbProjectFieldLabel label="Ort">
                        <input
                          value={form.invoiceCity}
                          onChange={(event) => onChange('invoiceCity', event.target.value)}
                          className={ebProjectInputClassName()}
                        />
                      </EbProjectFieldLabel>
                    </div>
                  </>
                )}
              </div>
            </div>
          </details>
        </section>
      ) : null}

      {activeTab === 'agreement' ? (
        <section>
          <h3 className="text-sm font-semibold text-gray-950">Avtal</h3>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <EbProjectFieldLabel label="Kontraktsnamn">
                <input
                  value={form.contractName}
                  onChange={(event) => onChange('contractName', event.target.value)}
                  placeholder={form.title || 'Samma som projektnamnet'}
                  className={ebProjectInputClassName()}
                />
              </EbProjectFieldLabel>
              <p className="mt-1 text-xs text-gray-600">Lämna tomt om kontraktsnamnet är samma som projektnamnet.</p>
            </div>
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
            <EbProjectFieldLabel label="Datum">
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

          <div className="mt-4">
            <EbProjectFieldLabel label="Kommentar">
              <textarea
                value={form.agreementNote}
                onChange={(event) => onChange('agreementNote', event.target.value)}
                rows={3}
                placeholder="Notering om avtalet"
                className={`${ebProjectInputClassName()} resize-y leading-6`}
              />
            </EbProjectFieldLabel>
            <p className="mt-1 text-xs text-gray-600">
              Visas direkt efter den inledande avtalstexten i utlåtandet.
            </p>
          </div>

          {renderAgreementDocumentField ? (
            renderAgreementDocumentField({
              agreementKey: 'standard',
              label: 'Avtalsdokument',
              description: 'Ladda upp avtalet som PDF eller välj en handling som redan finns i entreprenaden.',
            })
          ) : (
            <p className="mt-4 rounded-md border border-dashed border-emerald-200 bg-emerald-50/35 px-3 py-2 text-xs text-gray-600">
              Spara entreprenaden först för att kunna lägga till avtalsfiler.
            </p>
          )}

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
            <EbProjectFieldLabel label={`${vocabulary.contractorShortLabel} e-post`}>
              <input
                type="email"
                value={form.contractorEmail}
                onChange={(event) => onChange('contractorEmail', event.target.value)}
                className={ebProjectInputClassName()}
              />
            </EbProjectFieldLabel>
            <EbProjectFieldLabel label={`${vocabulary.contractorShortLabel} telefon`}>
              <input
                type="tel"
                value={form.contractorPhone}
                onChange={(event) => onChange('contractorPhone', event.target.value)}
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
