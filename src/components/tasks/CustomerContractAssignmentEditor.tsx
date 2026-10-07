'use client'

import { ArrowDown, ArrowUp, ChevronDown, ExternalLink, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { Fragment, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { CustomerOfferDraft, CustomerOfferFile } from '@/lib/action-cases/customerOffers'
import { assignmentForEditing, assignmentPatch, type ContractAssignment } from '@/lib/action-cases/contractAssignment'
import { ABS18_TERMS } from '@/lib/action-cases/standardContractTerms'

const field = 'mt-1 block w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm'
const tool = 'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-slate-300 disabled:opacity-30'

export default function CustomerContractAssignmentEditor({ draft, files, caseId, onChange, children, standardTermsId, termsState, onRetryTerms }: {
  draft: CustomerOfferDraft
  files: CustomerOfferFile[]
  caseId: string
  onChange: (patch: Partial<CustomerOfferDraft>) => void
  children?: ReactNode
  standardTermsId?: string
  termsState?: '' | 'loading' | 'error'
  onRetryTerms?: () => void
}) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const listId = useId()
  const clicked = useRef<{ element: HTMLElement; top: number } | null>(null)
  useLayoutEffect(() => {
    const anchor = clicked.current
    clicked.current = null
    if (!anchor?.element.isConnected) return
    // Match the other project editors: opening a preceding row must not hide the clicked row.
    const bounds = anchor.element.getBoundingClientRect()
    const formSpace = expanded ? Math.min(240, window.innerHeight / 2) : 0
    const top = Math.max(16, Math.min(anchor.top, window.innerHeight - bounds.height - formSpace - 16))
    if (Math.abs(bounds.top - top) >= 1) window.scrollBy({ top: bounds.top - top, behavior: 'instant' })
  }, [expanded])
  const toggle = (fileId: string, element: HTMLElement) => {
    clicked.current = { element, top: element.getBoundingClientRect().top }
    setExpanded(expanded === fileId ? null : fileId)
  }
  const value = assignmentForEditing(draft, files)
  const selected = new Set(value.documents.map((d) => d.fileId))
  const available = files.filter((f) => f.id !== standardTermsId && !selected.has(f.id) && (draft.attachmentIds.length < 30 || draft.attachmentIds.includes(f.id)))
  const change = (patch: Partial<ContractAssignment>) => onChange(assignmentPatch(draft, { ...value, ...patch }, value))
  const add = (fileId: string) => {
    const file = files.find((f) => f.id === fileId)
    if (!file || selected.has(fileId)) return
    setExpanded(fileId)
    change({ documents: [...value.documents, { fileId, type: '', name: file.fileName, date: '' }] })
  }
  const move = (index: number, delta: number) => {
    const documents = [...value.documents]
    const other = index + delta
    if (other < 0 || other >= documents.length ||
      (draft.contractForm === 'abs18' && documents[other].fileId === standardTermsId)) return
    ;[documents[index], documents[index + delta]] = [documents[index + delta], documents[index]]
    change({ documents })
  }
  return <div className="space-y-6">
    <label className="block text-sm font-medium">Avtalsgrund
      <select className={field} value={draft.contractForm} onChange={(e) => onChange({ contractForm: e.target.value as CustomerOfferDraft['contractForm'] })}>
        <option value="abs18">ABS 18 – entreprenadkontrakt</option>
        <option value="custom">Egen avtalshandling</option>
      </select>
    </label>
    <section className="gizmo-contract-documents" aria-label="Handlingar som ingår i uppdraget">
      {draft.contractForm === 'abs18' && <div className="flex min-h-11 items-center gap-2 text-sm text-slate-600" role="status">
        {termsState === 'loading' ? <><Loader2 size={16} className="animate-spin" /> Förbereder ABS 18-villkor…</>
          : termsState === 'error' ? <button type="button" className={tool} onClick={onRetryTerms} title="Försök lägga till standardvillkoren igen" aria-label="Försök lägga till ABS 18-villkoren igen"><RefreshCw size={17} /></button>
            : <a href="/abs18-2018-06.pdf" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 text-teal-800 underline"><ExternalLink size={16} /> ABS 18 · Standardvillkor 2018.06</a>}
      </div>}
      <h3 className="font-semibold">Handlingar som ingår i uppdraget</h3>
      <datalist id="contract-document-types">
        {['Beskrivning', 'Ritning', 'Anbud', 'Administrativa föreskrifter', 'Allmänna bestämmelser, ABS 18', 'Avtalshandling'].map((type) => <option key={type} value={type} />)}
      </datalist>
      <table className="gizmo-document-table mt-3 w-full table-fixed border-y border-slate-200 text-left text-sm" aria-label="Handlingsförteckning">
        <thead>
          <tr>
            <th scope="col" className="gizmo-document-type w-1/4 px-3">Typ av handling</th>
            <th scope="col" className="px-3">Handling</th>
            <th scope="col" className="gizmo-document-date w-32 px-3">Datum</th>
            <th scope="col" className="gizmo-document-tools px-2"><span className="sr-only">Verktyg</span></th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-slate-200">
            <th scope="row" className="gizmo-document-type px-3 py-3 font-medium">Detta kontrakt</th>
            <td className="px-3 py-3 [overflow-wrap:anywhere]">
              <span className="gizmo-document-mobile mb-1 text-xs text-slate-500">Detta kontrakt</span>
              {draft.title}
              <span className="gizmo-document-mobile mt-1 text-xs text-slate-500">Datum vid publicering</span>
            </td>
            <td className="gizmo-document-date px-3 py-3 text-xs text-slate-500">Datum vid publicering</td>
            <td />
          </tr>
          {value.documents.map((doc, index) => {
            const file = files.find((f) => f.id === doc.fileId)
            if (draft.contractForm === 'abs18' && doc.fileId === standardTermsId) return <tr key={doc.fileId} className="gizmo-document-standard border-t border-slate-200">
              <td className="gizmo-document-type px-3 py-2">ABS 18<span className="mt-1 block text-xs font-medium text-teal-800">Avtalsvillkor</span></td>
              <td className="px-3 py-2"><strong className="block font-semibold">{ABS18_TERMS.name}</strong><span className="gizmo-document-mobile mt-1 text-xs text-slate-600">Avtalsvillkor · 2018.06</span></td>
              <td className="gizmo-document-date px-3 py-2 text-slate-600">2018.06</td>
              <td className="px-2 py-1"><div className="flex justify-end"><a className="gizmo-document-tool text-teal-800" href={`/api/action-cases/${caseId}/attachments/${doc.fileId}`} target="_blank" rel="noopener noreferrer" aria-label="Öppna ABS 18-villkoren i ny flik" title="Öppna ABS 18-villkoren i ny flik"><ExternalLink size={17} /></a></div></td>
            </tr>
            const open = expanded === doc.fileId
            const panelId = `${listId}-${doc.fileId}`
            const terms = draft.termsAttachmentId === doc.fileId
            const edit = (patch: Partial<typeof doc>) => change({ documents: value.documents.map((d) => d.fileId === doc.fileId ? { ...d, ...patch } : d) })
            return <Fragment key={doc.fileId}>
              <tr className="gizmo-document-row border-t border-slate-200" data-expanded={open} onClick={(e) => {
                if (e.target instanceof Element && e.target.closest('a,button')) return
                toggle(doc.fileId, e.currentTarget)
              }}>
                <td className="gizmo-document-type px-3 py-2">
                  <span className={`block truncate ${doc.type.trim() ? '' : 'text-amber-800'}`} title={doc.type || 'Typ saknas'}>{doc.type || 'Typ saknas'}</span>
                  {terms && <span className="mt-1 block text-xs font-medium text-teal-800">Avtalsvillkor</span>}
                </td>
                <td className="px-3 py-1">
                  <button type="button" className="gizmo-document-toggle flex w-full min-w-0 items-center text-left" aria-label={`${open ? 'Stäng' : 'Redigera'} handling ${index + 1}: ${doc.name || file?.fileName || 'Namnet saknas'}`} aria-expanded={open} aria-controls={panelId} title={doc.name || file?.fileName} onClick={(e) => toggle(doc.fileId, e.currentTarget)}>
                    <span className="block min-w-0 flex-1">
                      <strong className="block font-semibold [overflow-wrap:anywhere]">{doc.name || file?.fileName || 'Namnet saknas'}</strong>
                      <span className="gizmo-document-mobile mt-1 text-xs text-slate-600">{doc.type || 'Typ saknas'} · {doc.date || 'Datum saknas'}{terms ? ' · Avtalsvillkor' : ''}</span>
                      {!file && <span role="alert" className="mt-1 block text-xs text-red-700">Filen saknas i projektet.</span>}
                    </span>
                  </button>
                </td>
                <td className={`gizmo-document-date px-3 py-2 tabular-nums ${doc.date ? 'text-slate-600' : 'text-amber-800'}`}>{doc.date || 'Datum saknas'}</td>
                <td className="px-2 py-1">
                  <div className="flex items-center justify-end gap-1">
                    {file && <a className="gizmo-document-tool text-teal-800" href={`/api/action-cases/${caseId}/attachments/${doc.fileId}`} target="_blank" rel="noopener noreferrer" aria-label={`Öppna ${file.fileName} i ny flik`} title={`Öppna ${file.fileName} i ny flik`}><ExternalLink size={17} /></a>}
                    <button type="button" className="gizmo-document-tool" title={open ? 'Stäng redigering' : 'Redigera handling'} aria-label={`${open ? 'Stäng' : 'Öppna'} redigering för handling ${index + 1}`} aria-expanded={open} aria-controls={panelId} onClick={(e) => toggle(doc.fileId, e.currentTarget)}><ChevronDown size={18} className={open ? 'rotate-180' : ''} /></button>
                  </div>
                </td>
              </tr>
              <tr className="gizmo-document-editor" hidden={!open}>
                <td colSpan={4} className="border-t border-slate-200 bg-slate-50 p-3 md:p-4">
                  <div id={panelId} role="group" aria-label={`Handling ${index + 1}`}>
                    <div className="gizmo-document-fields grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(140px,1fr)]">
                      <label className="min-w-0 text-sm">Typ av handling
                        <input aria-label={`Typ av handling ${index + 1}`} className={field} list="contract-document-types" maxLength={100} value={doc.type} onChange={(e) => edit({ type: e.target.value })} />
                      </label>
                      <label className="min-w-0 text-sm">Handlingens namn
                        <input aria-label={`Handlingens namn ${index + 1}`} className={field} maxLength={250} value={doc.name} onChange={(e) => edit({ name: e.target.value })} />
                      </label>
                      <label className="min-w-0 text-sm">Handlingens datum
                        <input aria-label={`Handlingens datum ${index + 1}`} type="date" min="0001-01-01" max="9999-12-31" className={field} value={doc.date} onChange={(e) => {
                          if (!e.target.value || e.target.validity.valid) edit({ date: e.target.value })
                        }} onBlur={(e) => e.target.reportValidity()} />
                      </label>
                    </div>
                    {draft.contractForm === 'custom' && file?.contentType === 'application/pdf' && <label className="gizmo-document-terms mt-3 inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                      <input type="radio" name={`contract-terms-${caseId}`} aria-label={`Använd handling ${index + 1} som avtalsvillkor`} className="h-4 w-4 accent-teal-800" checked={draft.termsAttachmentId === doc.fileId} onChange={() => onChange({ ...assignmentPatch(draft, value, value), termsAttachmentId: doc.fileId })} />
                      Innehåller avtalsvillkoren
                    </label>}
                    <div className="mt-3 flex flex-wrap items-center justify-end gap-2 text-sm">
                      {!file && <span role="alert" className="flex-1 text-red-700">Filen saknas i projektet. Välj en ny handling.</span>}
                      <button type="button" className={tool} title="Flytta handling upp" aria-label={`Flytta handling ${index + 1} upp`} disabled={index === 0 || (draft.contractForm === 'abs18' && value.documents[index - 1].fileId === standardTermsId)} onClick={() => move(index, -1)}><ArrowUp size={17} /></button>
                      <button type="button" className={tool} title="Flytta handling ned" aria-label={`Flytta handling ${index + 1} ned`} disabled={index === value.documents.length - 1} onClick={() => move(index, 1)}><ArrowDown size={17} /></button>
                      <button type="button" className={`${tool} text-red-700`} title="Ta bort från avtalet" aria-label={`Ta bort handling ${index + 1} från avtalet`} onClick={() => change({ documents: value.documents.filter((d) => d.fileId !== doc.fileId) })}><Trash2 size={17} /></button>
                    </div>
                  </div>
                </td>
              </tr>
            </Fragment>
          })}
        </tbody>
      </table>
      <label className="mt-4 block text-sm font-medium">Lägg till handling från projektet
        <select aria-label="Lägg till handling från projektet" className={field} value="" disabled={!available.length} onChange={(e) => add(e.target.value)}>
          <option value="">Välj uppladdad fil…</option>
          {available.map((f) => <option key={f.id} value={f.id}>{f.fileName}</option>)}
        </select>
      </label>
      {!files.length && <p className="mt-2 text-sm text-slate-500">Inga handlingar uppladdade. <a className="underline" href={`/uppdrag/${caseId}?view=files`}>Bilder och filer</a></p>}
      {draft.contractForm === 'custom' && <label className="mt-3 inline-flex min-h-10 cursor-pointer items-center gap-2 text-sm">
        <input type="radio" name={`contract-terms-${caseId}`} aria-label="Ingen separat villkorsbilaga" className="h-4 w-4 accent-teal-800" checked={!draft.termsAttachmentId} onChange={() => onChange({ ...assignmentPatch(draft, value, value), termsAttachmentId: null })} />
        Ingen separat villkorsbilaga
      </label>}
      <label className="mt-4 block text-sm">Kompletterande uppgifter om handlingarna
        <textarea aria-label="Kompletterande uppgifter om handlingarna" className={field} rows={2} maxLength={6000} value={value.documentNotes} onChange={(e) => change({ documentNotes: e.target.value })} />
      </label>
    </section>
    <label className="block text-sm font-medium">Samt enligt följande
      <textarea aria-label="Samt enligt följande" className={field} rows={4} maxLength={12000} value={value.additionalScope} onChange={(e) => change({ additionalScope: e.target.value })} />
    </label>
    {children}
    <label className="block text-sm font-medium">Entreprenörens åtagande omfattar inte
      <textarea aria-label="Entreprenörens åtagande omfattar inte" className={field} rows={3} maxLength={6000} value={value.exclusions} onChange={(e) => change({ exclusions: e.target.value })} />
    </label>
  </div>
}
