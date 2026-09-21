'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, RotateCcw, Save } from 'lucide-react'
import { useAutosaveQueue } from '@/hooks/useAutosaveQueue'
import { isOpenClarification, type Clarification, type ClarificationAction } from '@/lib/renoapp/clarifications'
import type { CompletionSummary } from '@/lib/renoapp/completion'

type Props = {
  caseId: string
  rows: Clarification[]
  status: string
  completion?: CompletionSummary | null
  disabled: boolean
  onSaved: (row: Clarification) => void
  onBusyChange: (questionId: string, busy: boolean) => void
}
const labels: Record<Clarification['state'], string> = {
  pending: 'Behöver klarläggas', answered: 'Svar inkommet – behöver bedömas',
  resolved: 'Klarlagt', not_relevant: 'Inte relevant för ärendet',
}

function ClarificationRow({ row, ...props }: Omit<Props, 'rows'> & { row: Clarification }) {
  const [requested, setRequested] = useState(row.requested)
  const [note, setNote] = useState('')
  const revision = useRef(row.revision)
  const lastAction = useRef<{ action: ClarificationAction; note: string }>({ action: 'request', note: '' })
  const queue = useAutosaveQueue<{ action: ClarificationAction; note: string }, Clarification>({
    save: async change => {
      const response = await fetch(`/api/renoapp/app/cases/${props.caseId}/clarifications`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId: row.question_id, revision: revision.current, ...change }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error ?? 'Kunde inte spara klarläggandet.')
      const saved = (payload.item?.clarifications as Clarification[] | undefined)?.find(item => item.question_id === row.question_id)
      if (!saved) throw new Error('Kunde inte läsa det sparade klarläggandet.')
      // Advance after every write, including writes followed by another queued checkbox change.
      revision.current = saved.revision
      return saved
    },
    onSaved: saved => {
      props.onSaved(saved)
      props.onBusyChange(row.question_id, false)
      if (!isOpenClarification(saved)) setNote('')
    },
  })
  useEffect(() => {
    revision.current = row.revision
    setRequested(row.requested)
  }, [row.revision, row.requested])

  const save = (action: ClarificationAction, text = '') => {
    lastAction.current = { action, note: text }
    props.onBusyChange(row.question_id, true)
    void queue.enqueue(lastAction.current).catch(() => undefined)
  }
  const open = isOpenClarification(row)
  const inSentRound = props.status === 'need_info' && !props.completion?.submitted_at &&
    props.completion?.items.some(item => item.id === `clarification:${row.question_id}`)
  const unsent = requested && !inSentRound
  const final = ['draft', 'approved', 'conditional', 'approved_with_conditions', 'rejected'].includes(props.status)
  return (
    <fieldset disabled={props.disabled || final} className="min-w-0 border-b border-[var(--reno-line)] py-5 last:border-0">
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(240px,0.75fr)]">
        <div className={`min-w-0 border-l-4 pl-4 ${open ? 'border-amber-500' : 'border-emerald-600'}`}>
          <h3 className="font-semibold">{row.label}</h3>
          <p className="mt-1 text-sm font-medium">{labels[row.state]}</p>
          <p className="mt-2 text-sm text-[var(--reno-muted)]">Ursprungligt svar: {row.original_answer}</p>
          {row.answer_label && <p className="mt-2 text-sm"><strong>Inkommet svar:</strong> {row.answer_label}</p>}
          {row.answer_note && <p className="mt-2 whitespace-pre-wrap break-words text-sm">{row.answer_note}</p>}
          {row.review_note && <p className="mt-2 whitespace-pre-wrap break-words text-sm"><strong>Styrelsens bedömning:</strong> {row.review_note}</p>}
        </div>
        <div className="min-w-0 space-y-3">
          {open && <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
            <input type="checkbox" className="h-4 w-4 shrink-0" checked={requested}
              disabled={queue.isSaving && !['request', 'not_requested'].includes(lastAction.current.action)}
              onChange={event => { setRequested(event.target.checked); save(event.target.checked ? 'request' : 'not_requested') }} />
            Ta med i kompletteringsbegäran
          </label>}
          {unsent && !final && <p role="status" className="text-sm text-amber-900">Begäran behöver skickas till sökanden.</p>}
          {inSentRound ? <p className="text-sm text-[var(--reno-muted)]">Begäran är skickad. Inväntar sökandens komplettering.</p> : !final && (
            <details>
              <summary className="cursor-pointer py-2 text-sm font-semibold">Styrelsens bedömning</summary>
              <label className="block text-sm">Motivering
                <textarea rows={3} maxLength={4000} value={note} onChange={event => setNote(event.target.value)}
                  className="mt-2 w-full rounded-md border border-[var(--reno-line)] bg-white p-2" />
              </label>
              <div className="mt-2 flex flex-wrap gap-2">
                {row.state === 'answered' && <button type="button" disabled={queue.isSaving || !note.trim()} onClick={() => save('resolve', note)} className="inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm disabled:opacity-50"><Check size={16} />Markera klarlagt</button>}
                {open ? <button type="button" disabled={queue.isSaving || !note.trim()} onClick={() => save('not_relevant', note)} className="inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm disabled:opacity-50"><Save size={16} />Inte relevant</button>
                  : <button type="button" disabled={queue.isSaving || !note.trim()} onClick={() => save('reopen', note)} className="inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm disabled:opacity-50"><RotateCcw size={16} />Öppna frågan igen</button>}
              </div>
            </details>
          )}
          {queue.isSaving && <p role="status" className="text-sm text-[var(--reno-muted)]">Sparar...</p>}
          {queue.error && <div role="alert" className="text-sm text-red-800">
            <p>{queue.error}</p>
            <button type="button" className="mt-2 min-h-11 underline" onClick={() => save(lastAction.current.action, lastAction.current.note)}>Försök igen</button>
            <button type="button" className="ml-4 min-h-11 underline" onClick={() => window.location.reload()}>Ladda om ärendet</button>
          </div>}
        </div>
      </div>
    </fieldset>
  )
}

export default function BoardClarifications({ rows, ...props }: Props) {
  if (!rows.length) return null
  return (
    <section className="min-w-0 border-y border-[var(--reno-line)] bg-white px-4 py-5 sm:px-6" aria-labelledby="board-clarifications">
      <h2 id="board-clarifications" className="text-xl font-semibold">Frågor att klarlägga</h2>
      {rows.map(row => <ClarificationRow key={row.question_id} row={row} {...props} />)}
    </section>
  )
}
