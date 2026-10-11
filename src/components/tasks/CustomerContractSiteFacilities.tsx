'use client'

import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { editSiteFacility, emptySiteFacilityEntry, siteFacilityComplete, siteFacilityFields, siteFacilityParties, siteFacilityPartyLabel,
  siteFacilityUsed, siteFacilitiesSummary, type ContractSiteFacilities, type SiteFacilityKey, type SiteFacilityParty } from '@/lib/action-cases/contractSiteFacilities'
import ProjectEditorRow from './ProjectEditorRow'

const field = 'mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm'

export default function CustomerContractSiteFacilities({ value, disabled, onChange }: {
  value?: ContractSiteFacilities; disabled: boolean; onChange: (value: ContractSiteFacilities) => void
}) {
  const [expanded, setExpanded] = useState<SiteFacilityKey | null>(null)
  return <fieldset className="gizmo-site-facilities" disabled={disabled}>
    <legend className="text-base font-semibold">Arbetsplatsens förutsättningar</legend>
    <p className="mb-2 text-sm text-slate-600">{siteFacilitiesSummary(value)}</p>
    <div className="gizmo-site-facilities-header" aria-hidden="true">Förutsättning</div>
    {siteFacilityFields.map(({ key, title }) => {
      const entry = value?.entries[key] ?? emptySiteFacilityEntry()
      const used = siteFacilityUsed(entry)
      const patch = (update: Parameters<typeof editSiteFacility>[2]) => { if (!disabled) onChange(editSiteFacility(value, key, update)) }
      const summary = used ? `Ordnas: ${siteFacilityPartyLabel(entry.providedBy)} · Bekostas: ${siteFacilityPartyLabel(entry.paidBy)}${siteFacilityComplete(entry) ? '' : ' · Behöver kompletteras'}` : 'Inte angivet'
      return <ProjectEditorRow key={key} title={title} summary={summary} open={expanded === key} onToggle={() => setExpanded(expanded === key ? null : key)}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">Ordnas av
            <select aria-label={`${title}: Ordnas av`} className={field} value={entry.providedBy} onChange={(e) => patch({ providedBy: e.target.value as SiteFacilityParty })}>
              {siteFacilityParties.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="text-sm">Bekostas av
            <select aria-label={`${title}: Bekostas av`} className={field} value={entry.paidBy} onChange={(e) => patch({ paidBy: e.target.value as SiteFacilityParty })}>
              {siteFacilityParties.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>
        <label className="mt-3 block text-sm">Plats och villkor
          <textarea aria-label={`${title}: Plats och villkor`} className={field} rows={3} maxLength={2000} value={entry.details} onChange={(e) => patch({ details: e.target.value })} />
        </label>
        <button type="button" disabled={!used || disabled} className="mt-2 inline-flex min-h-9 items-center gap-2 rounded-md border border-slate-300 px-3 text-sm disabled:opacity-40"
          onClick={() => { if (!disabled && used && window.confirm(`Rensa överenskommelsen om ${title.toLowerCase()}?`)) patch(emptySiteFacilityEntry()) }}>
          <Trash2 size={16} aria-hidden="true" /> Rensa uppgifter
        </button>
      </ProjectEditorRow>
    })}
  </fieldset>
}

export function SiteFacilitiesDocument({ value }: { value?: ContractSiteFacilities }) {
  const rows = siteFacilityFields.filter(({ key }) => siteFacilityUsed(value?.entries[key]))
  if (!rows.length) return null
  return <div className="mt-5">
    <h3 className="font-semibold">Arbetsplatsens förutsättningar</h3>
    <dl className="mt-2 divide-y divide-slate-200">
      {rows.map(({ key, title }) => {
        const entry = value!.entries[key]!
        return <div key={key} className="py-3 text-sm">
          <dt className="font-semibold">{title}</dt>
          <dd className="mt-1 text-slate-700">Ordnas av: {siteFacilityPartyLabel(entry.providedBy)}. Bekostas av: {siteFacilityPartyLabel(entry.paidBy)}.</dd>
          <dd className="mt-1 whitespace-pre-wrap break-words text-slate-700">{entry.details || 'Plats och villkor saknas.'}</dd>
        </div>
      })}
    </dl>
  </div>
}
