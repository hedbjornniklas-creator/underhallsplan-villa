'use client'

import { useState, type ReactNode } from 'react'
import type { EbProjectListItem } from '@/lib/eb/server'
import { resolveEbAgreementVocabulary } from '@/lib/eb/vocabulary'

export type EbProjectFormState = {
  title: string
  contractName: string
  objectDescription: string
  propertyDesignation: string
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
}

export const EMPTY_EB_PROJECT_FORM: EbProjectFormState = {
  title: '',
  contractName: '',
  objectDescription: '',
  propertyDesignation: '',
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
}

const STANDARD_AGREEMENT_OPTIONS = [
  { value: '', label: 'Välj' },
  { value: 'AB 04', label: 'AB 04' },
  { value: 'ABT 06', label: 'ABT 06' },
  { value: 'ABS 18', label: 'ABS 18' },
  { value: 'HF17', label: 'HF 17' },
]

type EbProjectFormTab = 'object' | 'agreement' | 'contractors'

export function buildEbProjectForm(project: EbProjectListItem): EbProjectFormState {
  return {
    title: project.title ?? '',
    contractName: project.contractName ?? '',
    objectDescription: project.objectDescription ?? '',
    propertyDesignation: project.propertyDesignation ?? '',
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
            <EbProjectFieldLabel label="Fastighetsbeteckning / Brf, lgh nr">
              <input
                value={form.propertyDesignation}
                onChange={(event) => onChange('propertyDesignation', event.target.value)}
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
