'use client'

import { ArrowDown, ArrowUp, ExternalLink, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import type { CustomerOfferDraft, CustomerOfferFile } from '@/lib/action-cases/customerOffers'
import { assignmentForEditing, assignmentPatch, type ContractAssignment } from '@/lib/action-cases/contractAssignment'

const field = 'mt-1 block w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm'
const tool = 'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-slate-300 disabled:opacity-30'

export default function CustomerContractAssignmentEditor({ draft, files, caseId, onChange, children }: {
  draft: CustomerOfferDraft
  files: CustomerOfferFile[]
  caseId: string
  onChange: (patch: Partial<CustomerOfferDraft>) => void
  children?: ReactNode
}) {
  const value = assignmentForEditing(draft, files)
  const selected = new Set(value.documents.map((d) => d.fileId))
  const available = files.filter((f) => !selected.has(f.id) && (draft.attachmentIds.length < 30 || draft.attachmentIds.includes(f.id)))
  const change = (patch: Partial<ContractAssignment>) => onChange(assignmentPatch(draft, { ...value, ...patch }, value))
  const add = (fileId: string) => {
    const file = files.find((f) => f.id === fileId)
    if (!file || selected.has(fileId)) return
    change({ documents: [...value.documents, { fileId, type: '', name: file.fileName, date: '' }] })
  }
  const move = (index: number, delta: number) => {
    const documents = [...value.documents]
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
    <section aria-label="Handlingar som ingår i uppdraget">
      <h3 className="font-semibold">Handlingar som ingår i uppdraget</h3>
      <div className="mt-3 grid gap-2 border-y border-slate-200 bg-slate-50 px-3 py-3 text-sm md:grid-cols-[1fr_2fr_1fr]">
        <strong>Detta kontrakt</strong><span className="break-words">{draft.title}</span><span className="text-slate-500">Datum vid publicering</span>
      </div>
      <datalist id="contract-document-types">
        {['Beskrivning', 'Ritning', 'Anbud', 'Administrativa föreskrifter', 'Allmänna bestämmelser, ABS 18', 'Avtalshandling'].map((type) => <option key={type} value={type} />)}
      </datalist>
      {value.documents.map((doc, index) => {
        const file = files.find((f) => f.id === doc.fileId)
        const edit = (patch: Partial<typeof doc>) => change({ documents: value.documents.map((d) => d.fileId === doc.fileId ? { ...d, ...patch } : d) })
        return <div key={doc.fileId} role="group" aria-label={`Handling ${index + 1}`} className="border-b border-slate-200 py-4">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(140px,1fr)]">
            <label className="min-w-0 text-sm">Typ av handling
              <input aria-label={`Typ av handling ${index + 1}`} className={field} list="contract-document-types" maxLength={100} value={doc.type} onChange={(e) => edit({ type: e.target.value })} />
            </label>
            <label className="min-w-0 text-sm">Handlingens namn
              <input aria-label={`Handlingens namn ${index + 1}`} className={field} maxLength={250} value={doc.name} onChange={(e) => edit({ name: e.target.value })} />
            </label>
            <label className="min-w-0 text-sm">Handlingens datum
              <input aria-label={`Handlingens datum ${index + 1}`} type="date" className={field} value={doc.date} onChange={(e) => edit({ date: e.target.value })} />
            </label>
          </div>
          {file?.contentType === 'application/pdf' && <label className="mt-3 inline-flex min-h-10 cursor-pointer items-center gap-2 text-sm">
            <input type="radio" name={`contract-terms-${caseId}`} aria-label={`Använd handling ${index + 1} som avtalsvillkor`} className="h-4 w-4 accent-teal-800" checked={draft.termsAttachmentId === doc.fileId} onChange={() => onChange({ ...assignmentPatch(draft, value, value), termsAttachmentId: doc.fileId })} />
            Innehåller avtalsvillkoren
          </label>}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            {file ? <a className="inline-flex min-h-10 min-w-0 flex-1 items-center gap-2 text-teal-800 underline" href={`/api/action-cases/${caseId}/attachments/${doc.fileId}`} target="_blank" rel="noopener noreferrer" aria-label={`Öppna ${file.fileName} i ny flik`}>
              <ExternalLink size={16} className="shrink-0" /><span className="break-all">Öppna {file.fileName}</span>
            </a> : <span role="alert" className="flex-1 text-red-700">Filen saknas i projektet. Välj en ny handling.</span>}
            <button type="button" className={tool} title="Flytta handling upp" aria-label={`Flytta handling ${index + 1} upp`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={17} /></button>
            <button type="button" className={tool} title="Flytta handling ned" aria-label={`Flytta handling ${index + 1} ned`} disabled={index === value.documents.length - 1} onClick={() => move(index, 1)}><ArrowDown size={17} /></button>
            <button type="button" className={`${tool} text-red-700`} title="Ta bort från avtalet" aria-label={`Ta bort handling ${index + 1} från avtalet`} onClick={() => change({ documents: value.documents.filter((d) => d.fileId !== doc.fileId) })}><Trash2 size={17} /></button>
          </div>
        </div>
      })}
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
