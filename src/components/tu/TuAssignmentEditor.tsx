'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Loader2, Pencil, Save, X } from 'lucide-react'
import type { AssignmentDetails } from '@/lib/assignments/server'
import { canEditTuAssignmentDetails } from '@/lib/tu/assignmentProgress'
import { parseTuAssignmentEdit, TU_ASSIGNMENT_FIELDS, tuAssignmentForm, type TuAssignmentForm } from '@/lib/tu/assignmentEditing'
import { useToast } from '@/components/ui/AppToastProvider'
import { allowTuAssignmentNavigation, tuActionButton } from './TuAssignmentActions'

export default function TuAssignmentEditor({ assignment, onSaved }: { assignment: AssignmentDetails; onSaved: () => void | Promise<void> }) {
  const toast = useToast()
  const dialog = useRef<HTMLDialogElement>(null)
  const title = useId()
  const [form, setForm] = useState<TuAssignmentForm>(() => tuAssignmentForm(assignment))
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const dirty = open && JSON.stringify(form) !== JSON.stringify(tuAssignmentForm(assignment))
  useEffect(() => {
    if (!dirty && !busy) return
    const prevent = (event: Event) => event.preventDefault()
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('hushub:before-organization-switch', prevent)
    window.addEventListener('beforeunload', unload)
    return () => { window.removeEventListener('hushub:before-organization-switch', prevent); window.removeEventListener('beforeunload', unload) }
  }, [dirty, busy])
  const close = () => {
    if (inFlight.current || (dirty && !window.confirm('Stäng utan att spara ändringarna?'))) return
    setOpen(false); dialog.current?.close()
  }
  const save = async () => {
    if (inFlight.current) return
    const body = { ...form, expectedUpdatedAt: assignment.updated_at }
    try { parseTuAssignmentEdit(body) } catch (error) { toast.error(error, { appearance: 'dark' }); return }
    inFlight.current = true; setBusy(true)
    try {
      const response = await fetch(`/api/tu/assignments/${encodeURIComponent(assignment.id)}?orgId=${encodeURIComponent(assignment.org_id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }).catch(() => { throw new Error('Kunde inte ansluta. Dina ändringar finns kvar här.') })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload.assignment?.id !== assignment.id || payload.assignment?.org_id !== assignment.org_id) throw new Error(payload.error || 'Kunde inte spara uppdraget.')
      toast.success('Uppgifterna är sparade. Inget mejl har skickats.', { appearance: 'dark' })
      setOpen(false); dialog.current?.close()
      await onSaved()
    } catch (error) { toast.error(error, { appearance: 'dark' }) }
    finally { inFlight.current = false; setBusy(false) }
  }
  if (!canEditTuAssignmentDetails(assignment)) return null
  return <>
    <button type="button" className={tuActionButton} onClick={() => { if (!allowTuAssignmentNavigation()) return; setForm(tuAssignmentForm(assignment)); setOpen(true); dialog.current?.showModal() }}><Pencil size={16} aria-hidden />Redigera uppgifter</button>
    <dialog ref={dialog} aria-labelledby={title} onCancel={event => { event.preventDefault(); close() }} className="m-auto max-h-[92dvh] w-[calc(100%-2rem)] max-w-3xl overflow-auto rounded-lg border border-slate-300 bg-white text-slate-900 shadow-xl backdrop:bg-black/40">
      <form onSubmit={event => { event.preventDefault(); void save() }}>
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-200 bg-white p-4"><h2 id={title} className="text-lg font-semibold">Redigera uppdragsbekräftelse</h2><button type="button" className={tuActionButton} disabled={busy} onClick={close} aria-label="Stäng redigering"><X size={18} aria-hidden /></button></header>
        <fieldset disabled={busy} className="space-y-5 p-4">
          {[...new Set(TU_ASSIGNMENT_FIELDS.map(field => field.group))].map(group => <section key={group} className="border-b border-slate-200 pb-5 last:border-0"><h3 className="mb-3 font-semibold">{group}</h3><div className="grid gap-3 sm:grid-cols-2">
            {TU_ASSIGNMENT_FIELDS.filter(field => field.group === group).map(field => {
              const type = 'type' in field ? field.type : 'text'
              const fieldId = `${title}-${field.key}`
              return <label key={field.key} htmlFor={fieldId} className={`min-w-0 text-sm text-slate-700 ${type === 'textarea' ? 'sm:col-span-2' : ''}`}>{field.label}
                {type === 'textarea' ? <textarea id={fieldId} value={form[field.key]} rows={5} onChange={event => setForm(current => ({ ...current, [field.key]: event.target.value }))} className="mt-1 block w-full rounded-md border border-slate-300 bg-white p-3 text-base" />
                  : <input id={fieldId} type={type === 'price' ? 'text' : type} inputMode={type === 'price' ? 'decimal' : undefined} required={'required' in field && field.required} value={form[field.key]} onChange={event => setForm(current => ({ ...current, [field.key]: event.target.value }))} className="mt-1 block min-h-11 w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 text-base" />}
              </label>
            })}
          </div></section>)}
        </fieldset>
        <footer className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-white p-4"><button type="button" className={tuActionButton} disabled={busy} onClick={close}>Avbryt</button><button type="submit" disabled={!dirty || busy} className={`${tuActionButton} !border-violet-600 !bg-violet-600 !text-white`}>{busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Save size={16} aria-hidden />}{busy ? 'Sparar…' : 'Spara uppgifter'}</button></footer>
      </form>
    </dialog>
  </>
}
