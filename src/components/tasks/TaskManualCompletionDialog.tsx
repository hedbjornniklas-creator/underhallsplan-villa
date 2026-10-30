'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AlertTriangle, CheckCheck, RefreshCw, X } from 'lucide-react'
import type { TaskView } from '@/lib/tasks/contracts'
import { COMPLETION_EVIDENCE_LABELS, MANUAL_COMPLETION_COMMENT_LIMIT, manualCompletionGaps } from '@/lib/tasks/manualCompletion'

type Props = {
  task: TaskView
  busy: boolean
  onClose: () => void
  onComplete: (payload: Record<string, unknown>) => Promise<void>
  onReload?: () => Promise<void>
}

export default function TaskManualCompletionDialog({ task, busy, onClose, onComplete, onReload }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const submittingRef = useRef(false)
  const [submitting, setSubmitting] = useState(false)
  const [comment, setComment] = useState('')
  const [acknowledgedKey, setAcknowledgedKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const locked = busy || submitting
  const gaps = manualCompletionGaps(task)
  const acknowledgementKey = JSON.stringify([task.id, task.version, gaps.acknowledgement])
  const acknowledged = !gaps.hasGaps || acknowledgedKey === acknowledgementKey
  const terminal = ['approved', 'cancelled', 'draft'].includes(task.status)

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const dialog = dialogRef.current
    dialog?.showModal()
    return () => {
      dialog?.close()
      if (opener && document.contains(opener)) opener.focus()
    }
  }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (locked || submittingRef.current || !comment.trim() || !acknowledged || task.openChildCount > 0 || terminal) return
    submittingRef.current = true
    setSubmitting(true)
    setError(null)
    try {
      await onComplete({ taskId: task.id, version: task.version, comment: comment.trim(), confirmed: true, acknowledgedGaps: gaps.acknowledgement })
      onClose()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Uppgiften kunde inte klarmarkeras. Försök igen.')
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <dialog ref={dialogRef} aria-labelledby="task-manual-completion-title" aria-describedby="task-manual-completion-description"
      aria-busy={locked} tabIndex={-1} onCancel={event => { event.preventDefault(); if (!locked) onClose() }}
      onKeyDown={event => {
        if (event.key !== 'Tab') return
        const dialog = event.currentTarget
        const controls = dialog.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),[tabindex="0"]')
        const first = controls[0], last = controls[controls.length - 1]
        if (!first || !last) { event.preventDefault(); dialog.focus(); return }
        if (!dialog.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) {
          event.preventDefault(); last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first.focus()
        }
      }}
      className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-xl overflow-hidden rounded-lg border border-slate-200 bg-white p-0 text-slate-950 shadow-2xl backdrop:bg-slate-950/60">
      <form className="flex max-h-[90dvh] flex-col" onSubmit={event => void submit(event)}>
        <header className="flex shrink-0 items-start gap-3 border-b border-slate-200 px-5 py-4">
          <CheckCheck size={22} className="mt-1 shrink-0 text-emerald-700" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 id="task-manual-completion-title" className="text-lg font-semibold">Klarmarkera manuellt</h2>
            <p className="mt-1 break-words text-sm text-slate-600">{task.title}</p>
          </div>
          <button type="button" aria-label="Stäng klarmarkering" title="Stäng" disabled={locked} onClick={onClose}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 disabled:opacity-50"><X size={18} /></button>
        </header>
        <div className="min-h-0 space-y-4 overflow-y-auto px-5 py-4">
          <p id="task-manual-completion-description" className="text-sm leading-6 text-slate-600">
            Du registrerar uppgiften som klar i rollen som uppdragsansvarig. Ditt namn, din kommentar och eventuella kvarstående krav sparas i historiken. Mottagaren meddelas enligt uppgiftens notifieringar.
          </p>
          {task.openChildCount > 0 ? <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            {task.openChildCount} öppna underuppgifter måste hanteras innan uppgiften kan klarmarkeras.
          </p> : null}
          {gaps.hasGaps ? <section aria-label="Kvarstående krav" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <h3 className="flex items-center gap-2 font-semibold"><AlertTriangle size={17} aria-hidden="true" /> Kvarstående krav</h3>
            {gaps.requirements.length ? <><p className="mt-3 font-medium">Kontrollpunkter som inte är verifierade</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">{gaps.requirements.map(item => <li key={item.id} className="break-words">{item.label}</li>)}</ul></> : null}
            {gaps.evidenceTypes.length ? <><p className="mt-3 font-medium">Färdigbevis som saknas</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">{gaps.evidenceTypes.map(type => <li key={type}>{COMPLETION_EVIDENCE_LABELS[type]}</li>)}</ul></> : null}
            <label className="mt-4 flex items-start gap-2 font-medium">
              <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" disabled={locked} checked={acknowledgedKey === acknowledgementKey}
                onChange={event => setAcknowledgedKey(event.target.checked ? acknowledgementKey : null)} />
              Jag godkänner att uppgiften klarmarkeras trots ovanstående kvarstående krav.
            </label>
          </section> : null}
          <label className="block text-sm font-medium">Kommentar *
            <textarea required maxLength={MANUAL_COMPLETION_COMMENT_LIMIT} rows={4} value={comment} disabled={locked}
              onChange={event => setComment(event.target.value)}
              className="mt-2 min-h-28 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 disabled:opacity-50" />
          </label>
          {task.recurrenceInterval ? <p className="text-sm text-slate-600">Nästa återkommande tillfälle skapas när uppgiften klarmarkeras.</p> : null}
          {task.deadlineRequests.some(request => request.status === 'pending') ? <p className="text-sm text-slate-600">Obehandlade begäranden om förlängning avslutas utan att slutdatumet flyttas.</p> : null}
          {terminal ? <p role="alert" className="text-sm text-rose-700">Uppgiften kan inte klarmarkeras i sitt nuvarande läge.</p> : null}
          {error ? <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
            <p>{error}</p>
            {onReload ? <button type="button" disabled={locked} onClick={() => void onReload()}
              className="mt-2 inline-flex min-h-9 items-center gap-2 font-semibold"><RefreshCw size={15} /> Uppdatera underlag</button> : null}
          </div> : null}
        </div>
        <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <button type="button" disabled={locked} onClick={onClose} className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold disabled:opacity-50">Avbryt</button>
          <button type="submit" disabled={locked || !comment.trim() || !acknowledged || task.openChildCount > 0 || terminal}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-50">
            <CheckCheck size={17} /> {submitting ? 'Klarmarkerar…' : 'Bekräfta klarmarkering'}
          </button>
        </footer>
      </form>
    </dialog>
  )
}
