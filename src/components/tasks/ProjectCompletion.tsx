'use client'
import { useEffect, useRef, useState } from 'react'
import { CheckCheck, RotateCcw, RefreshCw } from 'lucide-react'
import { administrationLabels, projectCompletionBlockers, type ProjectCompletionWorkspace } from '@/lib/action-cases/projectCompletion'
import type { ActionCaseStatus } from '@/lib/action-cases/contracts'
import './project-completion.css'

export default function ProjectCompletion({ caseId, active, refreshKey, blocked, onStatus, onDirty }: {
  caseId: string; active: boolean; refreshKey: number; blocked: boolean
  onStatus: (status: ActionCaseStatus) => void; onDirty: (dirty: boolean) => void
}) {
  const [data, setData] = useState<ProjectCompletionWorkspace | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<'complete' | 'reopen' | null>(null), [reload, setReload] = useState(0)
  const pending = useRef<Record<string, unknown> | null>(null), running = useRef(false)
  const statusCallback = useRef(onStatus); statusCallback.current = onStatus
  useEffect(() => { onDirty(busy || pending.current !== null) }, [busy, error, onDirty])
  useEffect(() => {
    if (!busy && !pending.current) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn)
  }, [busy, error])
  useEffect(() => {
    if (!active || pending.current) return
    const controller = new AbortController()
    setBusy(true); setError('')
    void fetch(`/api/action-cases/${caseId}/administration`, { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]) }).then(async response => {
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Projektstatus kunde inte hämtas.')
      if (!controller.signal.aborted) { setData(result); statusCallback.current(result.status) }
    }).catch(e => { if (!controller.signal.aborted) setError(e.message) }).finally(() => { if (!controller.signal.aborted) setBusy(false) })
    return () => controller.abort()
  }, [active, caseId, refreshKey, reload])
  async function write(values?: Record<string, unknown>) {
    if (running.current || !data) return
    if (!pending.current) pending.current = { ...values, revision: data.revision, requestId: crypto.randomUUID() }
    running.current = true; setBusy(true); setError('')
    try {
      const sent = pending.current
      const response = await fetch(`/api/action-cases/${caseId}/administration`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sent), signal: AbortSignal.timeout(45_000) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Sparningen kunde inte bekräftas.')
      if (!Number.isSafeInteger(result.revision)) throw new Error('Sparningen kunde inte bekräftas.')
      pending.current = null; setConfirm(null); statusCallback.current(result.status)
      setData(current => current ? { ...current, revision: result.revision, status: result.status,
        ...(sent.operation === 'flags' ? { workComplete: Boolean(sent.workComplete), invoiced: Boolean(sent.invoiced) } : {}) } : current)
      setReload(v => v + 1)
    } catch (e) { setError(e instanceof Error ? e.message : 'Åtgärden kunde inte bekräftas.') }
    finally { running.current = false; setBusy(false) }
  }
  const closed = data?.status === 'completed', disabled = busy || blocked || !data?.canManage || Boolean(pending.current) || data.status === 'cancelled'
  const blockers = data ? projectCompletionBlockers(data) : []
  return <section className="gizmo-closeout" aria-label="Projektavslut">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Projektavslut{closed ? ' · Avslutat' : ''}</h3><button type="button" className="gizmo-text-button" aria-label="Uppdatera projektstatus" title="Uppdatera projektstatus" disabled={busy || Boolean(pending.current)} onClick={() => setReload(v => v + 1)}><RefreshCw size={16} /></button></div>
    {!data && !error && <p role="status">Hämtar projektstatus…</p>}
    {error && <div role="alert" className="my-2 text-sm text-rose-800">{error} {pending.current ? <><button type="button" className="gizmo-text-button" disabled={busy} onClick={() => void write()}>Försök igen</button><button type="button" className="gizmo-text-button" disabled={busy} onClick={() => { pending.current = null; setError(''); setConfirm(null); setReload(v => v + 1) }}>Hämta projektstatus</button></> : <button type="button" className="gizmo-text-button" disabled={busy} onClick={() => setReload(v => v + 1)}>Försök igen</button>}</div>}
    {data && <>
      <div className="my-3 flex flex-wrap gap-x-6 gap-y-3"><label className="flex items-center gap-2"><input type="checkbox" checked={data.workComplete} disabled={disabled || closed} onChange={e => void write({ operation: 'flags', workComplete: e.target.checked, invoiced: data.invoiced })} />Arbetet klart</label><label className="flex items-center gap-2"><input type="checkbox" checked={data.invoiced} disabled={disabled || closed} onChange={e => void write({ operation: 'flags', workComplete: data.workComplete, invoiced: e.target.checked })} />Färdigfakturerat</label><span className="text-sm text-[#596368]">{data.openQuestions === null ? 'Frågestatus visas för projektansvarig' : data.openQuestions ? `${data.openQuestions} frågor att avsluta` : 'Alla frågor avslutade'}</span></div>
      {!data.canManage && <p className="text-sm text-[#596368]">Projektansvarig klarmarkerar och avslutar projektet.</p>}
      {blocked && <p className="text-sm" role="status">Vänta tills pågående projektändringar är sparade.</p>}
      {confirm ? <div className="my-3 border-l-4 border-[#C9B867] bg-[#FCF7E8] p-3" role="group" aria-label="Bekräfta projektstatus"><p>{confirm === 'complete' ? 'Avsluta projektet som klart och färdigfakturerat?' : 'Återöppna projektet? Slutmarkeringarna återställs. Avtalets låsning påverkas inte.'}</p><div className="mt-2 flex gap-2"><button type="button" className="gizmo-button" disabled={disabled} onClick={() => void write({ operation: confirm, confirmed: true })}>Bekräfta</button><button type="button" className="gizmo-text-button" disabled={busy || Boolean(pending.current)} onClick={() => setConfirm(null)}>Avbryt</button></div></div>
        : <button type="button" className="gizmo-button" title={!closed ? blockers.join(' ') : undefined} disabled={disabled || (!closed && blockers.length > 0)} onClick={() => setConfirm(closed ? 'reopen' : 'complete')}>{closed ? <RotateCcw size={16} /> : <CheckCheck size={16} />}{closed ? 'Återöppna projekt' : 'Avsluta projekt'}</button>}
      {!closed && data.canManage && blockers.length > 0 && <ul className="my-2 list-disc pl-5 text-sm text-[#596368]">{blockers.map(b => <li key={b}>{b}</li>)}</ul>}
      {data.events.length > 0 && <details className="mt-3 text-sm"><summary>Historik</summary><ul className="mt-2 divide-y divide-[#D5DCDD]">{data.events.map(e => <li key={e.id} className="py-2">{administrationLabels[e.operation] || e.operation} · {e.actor} · {new Date(e.at).toLocaleString('sv-SE')}</li>)}</ul></details>}
    </>}
  </section>
}
