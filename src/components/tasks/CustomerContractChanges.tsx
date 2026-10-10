'use client'

import { useId, useState } from 'react'
import { ExternalLink, Pencil, Plus, Trash2, X } from 'lucide-react'
import type { CustomerOfferDraft, CustomerOfferFile } from '@/lib/action-cases/customerOffers'
import { money } from '@/lib/action-cases/customerOffers'
import { assignmentForEditing } from '@/lib/action-cases/contractAssignment'
import { changeMarkupFields, changesForEditing, changePricingPatch, type ChangeRate, type ContractChanges } from '@/lib/action-cases/contractChanges'
import PriceInput from './CustomerOfferPriceInput'

const field = 'mt-1 block w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm'
export default function CustomerContractChanges({ draft, files, caseId, blocked, onChange }: {
  draft: CustomerOfferDraft; files: CustomerOfferFile[]; caseId: string; blocked: boolean; onChange: (patch: Partial<CustomerOfferDraft>) => void
}) {
  const name = useId()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [removeId, setRemoveId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const value = changesForEditing(draft.contractDetails!)
  const management = value.rates.find((row) => row.kind === 'management')
  const available = files.filter((file) => file.contentType === 'application/pdf' && file.id !== draft.termsAttachmentId)
  const change = (patch: Partial<ContractChanges>) => {
    if (blocked) return
    try { onChange(changePricingPatch(draft, { ...value, ...patch }, files)); setError('') }
    catch { setError('Prisbilagan kunde inte läggas till. Kontrollera filen och att avtalet har plats för fler handlingar.') }
  }
  const editRate = (id: string, patch: Partial<ChangeRate>) => change({ rates: value.rates.map((row) => row.id === id ? { ...row, ...patch } : row) })
  const addRate = (kind: ChangeRate['kind'], title: string) => {
    const id = crypto.randomUUID()
    change({ rates: [...value.rates, { id, kind, title, hourlyOre: null }] })
    setExpanded(id)
  }
  return <fieldset disabled={blocked} className="gizmo-contract-changes min-w-0 space-y-4" aria-label="Prisgrunder för ÄTA">
    <fieldset><legend className="mb-2 text-sm font-medium">Prisgrunder</legend><div className="gizmo-price-modes">
      {([{ mode: 'fields', label: 'Fyll i här' }, { mode: 'attachment', label: 'Enligt prisbilaga' }] as const).map(({ mode, label }) => <label key={mode} className={value.mode === mode ? 'selected' : ''}>
        <input type="radio" name={name} checked={value.mode === mode} onChange={() => change({ mode })} />{label}
      </label>)}
    </div></fieldset>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {value.mode === 'fields' ? <div className="gizmo-change-tables">
      <section aria-label="Timpriser för ÄTA" className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Timpriser</h3>
          <button type="button" className="gizmo-button" disabled={blocked || value.rates.length >= 50} onClick={() => addRate(value.rates.some((row) => row.kind === 'ordinary') ? 'other' : 'ordinary', value.rates.some((row) => row.kind === 'ordinary') ? '' : 'Ordinarie arbete')}><Plus size={16} />Lägg till timpris</button>
        </div>
        <div role="table" aria-label="ÄTA-timpriser" className="gizmo-change-table">
          <div role="row" className="gizmo-change-rate gizmo-change-header"><span role="columnheader">Arbete eller roll</span><span role="columnheader">Kr/tim inkl. moms</span><span role="columnheader" className="sr-only">Verktyg</span></div>
          {value.rates.map((row) => <div key={row.id}>
            <div role="row" className={`gizmo-change-rate ${expanded === row.id ? 'open' : ''}`}>
              <div role="cell" className="min-w-0"><button type="button" className="gizmo-change-title" aria-label={`Redigera ÄTA-timpris ${row.title || 'ny roll'}`} aria-expanded={expanded === row.id} onClick={() => setExpanded(expanded === row.id ? null : row.id)}>{row.title || 'Ny roll'}</button></div>
              <span role="cell" className="text-right tabular-nums">{money(row.hourlyOre)}</span>
              <div role="cell" className="flex justify-end gap-1">
                <button type="button" className="gizmo-button gizmo-icon-button" title="Redigera timpris" aria-label={`Öppna ÄTA-timpris ${row.title || 'ny roll'}`} onClick={() => setExpanded(expanded === row.id ? null : row.id)}><Pencil size={16} /></button>
                <button type="button" className="gizmo-button gizmo-icon-button" title="Radera timpris" aria-label={`Radera ÄTA-timpris ${row.title || 'ny roll'}`} onClick={() => setRemoveId(row.id)}><Trash2 size={16} /></button>
              </div>
            </div>
            {removeId === row.id && <div role="alert" className="border-b border-slate-200 p-3 text-sm">
              Radera timpriset för {row.title || 'ny roll'}?
              <div className="mt-2 flex flex-wrap gap-2"><button type="button" className="gizmo-button" onClick={() => { change({ rates: value.rates.filter((rate) => rate.id !== row.id) }); setRemoveId(null); setExpanded(null) }}><Trash2 size={16} />Radera timpris</button><button type="button" className="gizmo-button" onClick={() => setRemoveId(null)}><X size={16} />Avbryt</button></div>
            </div>}
            {expanded === row.id && <div role="group" aria-label={`Redigera timpris ${row.title || 'ny roll'}`} className="gizmo-change-rate-editor border-b border-slate-200 bg-slate-50 p-3">
              <label className="min-w-0 text-sm font-medium">Arbete eller roll<input aria-label="ÄTA-timprisets roll" className={field} maxLength={250} value={row.title} onChange={(e) => editRate(row.id, { title: e.target.value })} /></label>
              <PriceInput label="ÄTA-timpris inkl. arvode och moms (kr/tim)" value={row.hourlyOre} onChange={(hourlyOre) => editRate(row.id, { hourlyOre })} />
            </div>}
          </div>)}
        </div>
        {!value.rates.some((row) => row.kind === 'ordinary') && <p role="alert" className="mt-2 text-sm text-amber-800">Ordinarie timpris saknas.</p>}
        <label className="mt-2 flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" checked={!management} disabled={blocked || (!management && value.rates.length >= 50)} onChange={(e) => {
          if (e.target.checked) change({ rates: value.rates.filter((row) => row.kind !== 'management') })
          else addRate('management', 'Arbetsledning')
        }} />Arbetsledning enligt ordinarie timpris</label>
      </section>
      <section aria-label="Påslag för ÄTA" className="min-w-0">
        <h3 className="gizmo-change-markup-heading text-sm font-semibold">Påslag på självkostnad</h3>
        <div role="table" aria-label="ÄTA-påslag" className="gizmo-change-table">
          <div role="row" className="gizmo-change-markup gizmo-change-header"><span role="columnheader">Kostnadsslag</span><span role="columnheader">Påslag (%)</span></div>
          {changeMarkupFields.map(({ key, title }) => <div key={key} role="row" className="gizmo-change-markup"><span role="cell">{title}</span><div role="cell">
            <PriceInput label={`ÄTA-påslag ${title.toLocaleLowerCase('sv-SE')} (%)`} value={value.markups[key] === null ? null : Math.round(value.markups[key]! * 100)} max={100000} onChange={(amount) => change({ markups: { ...value.markups, [key]: amount === null ? null : amount / 100 } })} />
          </div></div>)}
        </div>
      </section>
    </div> : <section className="space-y-3" aria-label="Prisbilaga för ÄTA">
      <label className="block text-sm font-medium">Prisbilaga
        <select aria-label="ÄTA-prisbilaga" className={field} value={value.annex?.fileId ?? ''} onChange={(e) => {
          const file = available.find((file) => file.id === e.target.value)
          const existing = assignmentForEditing(draft, files).documents.find((doc) => doc.fileId === file?.id)
          change({ annex: file ? existing ? { ...existing, type: existing.type.trim() ? existing.type : 'ÄTA-prislista' } : { fileId: file.id, name: file.fileName, type: 'ÄTA-prislista', date: '' } : null, annexRevision: '' })
        }}><option value="">Välj uppladdad prisbilaga…</option>{available.map((file) => <option key={file.id} value={file.id}>{file.fileName}</option>)}</select>
      </label>
      {!available.length && <a className="inline-flex items-center gap-2 text-sm text-teal-800 underline" href={`/uppdrag/${caseId}?view=files`}>Bilder och filer</a>}
      {value.annex && <>
        <div className="gizmo-change-annex-fields">
          <label className="min-w-0 text-sm font-medium">Handlingens namn<input aria-label="ÄTA-prisbilagans namn" className={field} maxLength={250} value={value.annex.name} onChange={(e) => change({ annex: { ...value.annex!, name: e.target.value } })} /></label>
          <label className="min-w-0 text-sm font-medium">Datum<input aria-label="ÄTA-prisbilagans datum" type="date" min="0001-01-01" max="9999-12-31" className={field} value={value.annex.date} onChange={(e) => { if (!e.target.value || e.target.validity.valid) change({ annex: { ...value.annex!, date: e.target.value } }) }} onBlur={(e) => {
            if (e.target.reportValidity() && e.target.value !== value.annex!.date) change({ annex: { ...value.annex!, date: e.target.value } })
          }} /></label>
          <label className="min-w-0 text-sm font-medium">Version<input aria-label="ÄTA-prisbilagans version" className={field} maxLength={100} value={value.annexRevision} onChange={(e) => change({ annexRevision: e.target.value })} /></label>
        </div>
        <a className="inline-flex min-h-9 items-center gap-2 text-sm text-teal-800 underline" href={`/api/action-cases/${caseId}/attachments/${value.annex.fileId}`} target="_blank" rel="noopener noreferrer"><ExternalLink size={16} />Öppna prisbilaga</a>
      </>}
    </section>}
    <label className="block text-sm font-medium">Avtalsvillkor för ÄTA<textarea aria-label="Avtalsvillkor för ÄTA" className={field} rows={4} maxLength={6000} value={value.standardText} onChange={(e) => change({ standardText: e.target.value })} /></label>
    <label className="block text-sm font-medium">Övriga ÄTA-villkor<textarea aria-label="Övriga ÄTA-villkor" className={field} rows={2} maxLength={6200} value={value.notes} onChange={(e) => change({ notes: e.target.value })} /></label>
  </fieldset>
}

export function ContractChangesDocument({ value, fileUrl }: { value: ContractChanges; fileUrl?: (id: string) => string }) {
  const ordinary = value.rates.find((row) => row.kind === 'ordinary')
  return <section aria-label="Ändringar och tilläggsarbeten" className="min-w-0 space-y-3 text-sm">
    <p className="whitespace-pre-wrap leading-6">{value.standardText}</p>
    {value.mode === 'fields' ? <>
      <div className="gizmo-price-document"><table className="w-full text-left"><thead className="bg-[#EDF1F1]"><tr><th>Arbete eller roll</th><th>Kr/tim inkl. arvode och moms</th></tr></thead><tbody>
        {value.rates.map((row) => <tr key={row.id}><td>{row.title || 'Roll saknar namn'}</td><td>{money(row.hourlyOre)}</td></tr>)}
        {!value.rates.some((row) => row.kind === 'management') && <tr><td>Arbetsledning</td><td>{money(ordinary?.hourlyOre ?? null)}</td></tr>}
      </tbody></table></div>
      <div className="gizmo-price-document"><table className="w-full text-left"><thead className="bg-[#EDF1F1]"><tr><th>Kostnadsslag</th><th>Påslag på självkostnad</th></tr></thead><tbody>
        {changeMarkupFields.map(({ key, title }) => <tr key={key}><td>{title}</td><td>{value.markups[key] === null ? 'Ej angivet' : `${value.markups[key]!.toLocaleString('sv-SE', { maximumFractionDigits: 2 })} %`}</td></tr>)}
      </tbody></table></div>
      <p>Självkostnad exklusive moms + entreprenörarvode. Moms tillkommer på kostnad och arvode.</p>
    </> : value.annex ? <p>Timpriser och påslag enligt prisbilaga: {fileUrl ? <a href={fileUrl(value.annex.fileId)} target="_blank" rel="noopener noreferrer" className="underline">{value.annex.name}</a> : value.annex.name}. Datum {value.annex.date || 'saknas'}, version {value.annexRevision || 'saknas'}.</p> : <p>Prisbilaga saknas.</p>}
    {value.notes && <div><h5 className="font-semibold">Övriga ÄTA-villkor</h5><p className="mt-1 whitespace-pre-wrap leading-6">{value.notes}</p></div>}
  </section>
}
