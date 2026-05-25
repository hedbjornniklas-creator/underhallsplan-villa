'use client'

import type { ReactNode } from 'react'
import type { EbProjectListItem } from '@/lib/eb/server'

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
  contractorName: string
  contractorOrgNo: string
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
  contractorName: '',
  contractorOrgNo: '',
}

const STANDARD_AGREEMENT_OPTIONS = [
  { value: '', label: 'Välj' },
  { value: 'AB 04', label: 'AB 04' },
  { value: 'ABT 06', label: 'ABT 06' },
  { value: 'ABS 18', label: 'ABS 18' },
  { value: 'HF17', label: 'HF17' },
]

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
    contractorName: project.contractorName ?? '',
    contractorOrgNo: project.contractorOrgNo ?? '',
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
  return (
    <div className="space-y-5">
      <section>
        <h3 className="text-sm font-semibold text-gray-950">Entreprenad</h3>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <EbProjectFieldLabel
            label="Projektnamn"
          >
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
          <EbProjectFieldLabel label="Adress">
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
        </div>
      </section>

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

      <section>
        <h3 className="text-sm font-semibold text-gray-950">Parter</h3>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <EbProjectFieldLabel label="Beställare">
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
          <EbProjectFieldLabel label="Entreprenör">
            <input
              value={form.contractorName}
              onChange={(event) => onChange('contractorName', event.target.value)}
              className={ebProjectInputClassName()}
            />
          </EbProjectFieldLabel>
          <EbProjectFieldLabel label="Entreprenör org.nr">
            <input
              value={form.contractorOrgNo}
              onChange={(event) => onChange('contractorOrgNo', event.target.value)}
              className={ebProjectInputClassName()}
            />
          </EbProjectFieldLabel>
        </div>
      </section>
    </div>
  )
}
