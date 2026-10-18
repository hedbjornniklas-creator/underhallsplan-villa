'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Mail, Pencil, RotateCcw, X } from 'lucide-react'
import { useAutosaveQueue } from '@/hooks/useAutosaveQueue'
import { useToast } from '@/components/ui/AppToastProvider'
import {
  canEditTuSchedule, formatTuSchedule, tuScheduleKey, tuScheduleValues, validTuSchedule,
  type TuAssignmentSchedule, type TuScheduleValues,
} from '@/lib/tu/assignmentSchedule'

const buttonStyle = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50'

export default function TuAssignmentScheduleEditor({ assignment, onSaved }: {
  assignment: TuAssignmentSchedule
  onSaved: (assignment: TuAssignmentSchedule) => void
}) {
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [saved, setSaved] = useState(assignment)
  const [form, setForm] = useState(() => tuScheduleValues(assignment))
  const [conflict, setConflict] = useState(false)
  const [sending, setSending] = useState(false)
  const [confirmNotice, setConfirmNotice] = useState(false)
  const [notifiedVersion, setNotifiedVersion] = useState<string | null>(null)
  const versionRef = useRef(assignment)
  const dirty = tuScheduleKey(form) !== tuScheduleKey(tuScheduleValues(saved))
  const editable = canEditTuSchedule(saved)
  const valid = validTuSchedule(form)
  const endpoint = `/api/tu/assignments/${encodeURIComponent(assignment.id)}/schedule?orgId=${encodeURIComponent(assignment.org_id)}`
  const queue = useAutosaveQueue<TuScheduleValues, TuAssignmentSchedule>({
    save: async (values) => {
      if (tuScheduleKey(values) === tuScheduleKey(tuScheduleValues(versionRef.current))) return versionRef.current
      const response = await fetch(endpoint, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, expectedUpdatedAt: versionRef.current.updated_at }),
      }).catch(() => {
        throw new Error('Kunde inte ansluta. Dina ändringar finns kvar här. Kontrollera anslutningen och försök igen.')
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload.assignment || payload.assignment.org_id !== assignment.org_id || payload.assignment.id !== assignment.id) {
        if (response.status === 409) setConflict(true)
        throw new Error(payload.error || 'Kunde inte spara datum och tid. Försök igen.')
      }
      // The queue can already hold another edit. Advance the version before it runs.
      versionRef.current = payload.assignment
      setSaved(payload.assignment)
      onSaved(payload.assignment)
      return payload.assignment
    },
    onSaved: (updated) => { setSaved(updated); onSaved(updated) },
    onError: error => { toast.error(error, { appearance: 'dark', dedupeKey: 'tu-schedule-save' }) },
  })
  const { enqueue, isSaving, status, resetError } = queue

  useEffect(() => {
    if (!dirty || !valid || !editable || conflict || status === 'error') return
    const timer = window.setTimeout(() => { void enqueue(form).catch(() => {}) }, 650)
    return () => window.clearTimeout(timer)
  }, [dirty, valid, editable, conflict, status, enqueue, form])

  useEffect(() => {
    if (!dirty && !isSaving && !sending) return
    const warn = (event: Event) => {
      event.preventDefault()
      toast.warning('Vänta tills ändringen har sparats, eller återställ osparade ändringar innan du lämnar sidan.', { appearance: 'dark', dedupeKey: 'tu-schedule-leave' })
    }
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    const beforeLink = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (!(link instanceof HTMLAnchorElement) || link.hasAttribute('download') || (link.target && link.target !== '_self')) return
      warn(event)
      event.stopPropagation()
    }
    window.addEventListener('beforeunload', beforeUnload)
    window.addEventListener('hushub:before-organization-switch', warn)
    document.addEventListener('click', beforeLink, true)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      window.removeEventListener('hushub:before-organization-switch', warn)
      document.removeEventListener('click', beforeLink, true)
    }
  }, [dirty, isSaving, sending, toast])

  const change = (key: keyof TuScheduleValues, value: string) => {
    setForm(current => ({ ...current, [key]: value }))
    setConfirmNotice(false)
    resetError()
  }

  const reload = async () => {
    try {
      const response = await fetch(endpoint.replace('/schedule?', '?'), { cache: 'no-store' }).catch(() => {
        throw new Error('Kunde inte hämta aktuella uppgifter. Kontrollera anslutningen och försök igen.')
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload.assignment?.org_id !== assignment.org_id || payload.assignment?.id !== assignment.id) throw new Error('Kunde inte hämta aktuella uppgifter. Försök igen.')
      versionRef.current = payload.assignment
      setSaved(payload.assignment)
      setForm(tuScheduleValues(payload.assignment))
      onSaved(payload.assignment)
      setConflict(false)
      setConfirmNotice(false)
      resetError()
    } catch (error) { toast.error(error, { appearance: 'dark' }) }
  }

  const notify = async () => {
    if (dirty || isSaving || sending || conflict) return
    setSending(true)
    try {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedUpdatedAt: versionRef.current.updated_at }),
      }).catch(() => {
        throw new Error('Kunde inte bekräfta att meddelandet skickades. Datum och tid är sparade. Kontrollera anslutningen och försök igen.')
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (response.status === 409) setConflict(true)
        throw new Error(payload.error || 'Kunde inte skicka meddelandet. Försök igen.')
      }
      setNotifiedVersion(payload.updatedAt)
      setConfirmNotice(false)
      toast.success(`Den nya tiden har skickats till ${payload.recipient}.`, { appearance: 'dark' })
    } catch (error) { toast.error(error, { appearance: 'dark' }) }
    finally { setSending(false) }
  }

  return <div className="min-w-0 space-y-3 md:col-span-2">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <dl className="flex flex-wrap gap-x-8 gap-y-3">
        <div><dt className="text-xs font-medium text-slate-500">Datum</dt><dd className="mt-1 text-sm text-slate-900">{saved.preferred_date ?? 'Ej angivet'}</dd></div>
        <div><dt className="text-xs font-medium text-slate-500">Tid</dt><dd className="mt-1 text-sm text-slate-900">{saved.preferred_time?.slice(0, 5) || 'Ej angivet'}</dd></div>
      </dl>
      {!editing && editable ? <button type="button" className={buttonStyle} onClick={() => setEditing(true)}><Pencil size={16} aria-hidden />Ändra datum och tid</button> : null}
    </div>
    {editing ? <div className="space-y-3 border-t border-slate-200 pt-3">
      <fieldset disabled={!editable || sending} className="grid min-w-0 gap-3 sm:grid-cols-2">
        <label className="min-w-0 text-sm text-slate-700">Datum
          <input aria-label="Datum" type="date" required min="1000-01-01" max="9999-12-31" value={form.preferredDate} onChange={event => change('preferredDate', event.target.value)} className="mt-1 block min-h-11 w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 text-base" />
        </label>
        <label className="min-w-0 text-sm text-slate-700">Tid (valfritt)
          <input aria-label="Tid" type="time" value={form.preferredTime} onChange={event => change('preferredTime', event.target.value)} className="mt-1 block min-h-11 w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 text-base" />
        </label>
      </fieldset>
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-2">
        <span role="status" className={`text-sm ${status === 'error' || conflict ? 'text-rose-700' : 'text-slate-600'}`}>
          {conflict ? 'Uppgifterna har ändrats. Hämta aktuell version.' : status === 'error' ? 'Inte sparat' : isSaving ? 'Sparar…' : dirty ? valid ? 'Väntar på att spara…' : 'Ange ett giltigt datum och en giltig tid.' : 'Sparat'}
        </span>
        <div className="flex flex-wrap gap-2">
          {conflict ? <button type="button" className={buttonStyle} onClick={() => void reload()} disabled={isSaving || sending}><RotateCcw size={16} aria-hidden />Hämta aktuella uppgifter</button> : null}
          {status === 'error' && !conflict ? <button type="button" className={buttonStyle} disabled={!valid || isSaving} onClick={() => { void enqueue(form).catch(() => {}) }}><RotateCcw size={16} aria-hidden />Försök spara igen</button> : null}
          {dirty && !isSaving && !sending ? <button type="button" className={buttonStyle} onClick={() => { setForm(tuScheduleValues(saved)); resetError(); setConfirmNotice(false) }}><RotateCcw size={16} aria-hidden />Återställ osparade ändringar</button> : null}
          <button type="button" className={buttonStyle} disabled={dirty || isSaving || sending} onClick={() => { setEditing(false); setConfirmNotice(false) }}><Check size={16} aria-hidden />Klart</button>
        </div>
      </div>
      {saved.status === 'sent' && editable ? <div className="border-t border-slate-200 pt-3">
        {confirmNotice ? <div className="space-y-3" role="group" aria-label="Bekräfta tidsmeddelande">
          <p className="break-words text-sm text-slate-800 [overflow-wrap:anywhere]">Meddela {saved.customer_email} om tiden {formatTuSchedule(tuScheduleValues(saved))}?</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={`${buttonStyle} !border-violet-600 !bg-violet-600 !text-white`} disabled={dirty || isSaving || sending || conflict} onClick={() => void notify()}><Mail size={16} aria-hidden />{sending ? 'Skickar…' : 'Skicka meddelande'}</button>
            <button type="button" className={buttonStyle} disabled={sending} onClick={() => setConfirmNotice(false)}><X size={16} aria-hidden />Avbryt</button>
          </div>
        </div> : <button type="button" className={buttonStyle} disabled={dirty || isSaving || sending || conflict || !valid || notifiedVersion === saved.updated_at} onClick={() => setConfirmNotice(true)}><Mail size={16} aria-hidden />{!dirty && notifiedVersion === saved.updated_at ? 'Kunden är meddelad' : 'Meddela kunden'}</button>}
      </div> : null}
    </div> : null}
  </div>
}
