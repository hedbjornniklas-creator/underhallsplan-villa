'use client'

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, Loader2 } from 'lucide-react'
import type { ProjectView } from '@/lib/action-cases/projectNavigation'
import './project-save-protection.css'

export type SaveProtection = {
  label: string
  pending: boolean
  lossRisk?: boolean
  detail?: string
  view?: ProjectView
  flush?: () => Promise<boolean>
}
type Entry = SaveProtection & { id: string }
type Controller = {
  report: (id: string, entry: Entry | null) => void
  navigate: (action: () => void) => Promise<void>
}
const Context = createContext<Controller | null>(null)

// A local recovery copy is not the same as server acknowledgement. It can be
// shown in the status list without blocking navigation when no content is lost.
export function useProjectSaveProtection(value: SaveProtection) {
  const controller = useContext(Context), id = useId(), latest = useRef(value)
  useEffect(() => { latest.current = value })
  const risk = value.pending && value.lossRisk !== false
  useEffect(() => {
    controller?.report(id, value.pending ? { ...value, id, flush: value.flush ? () => latest.current.flush!() : undefined } : null)
    return () => controller?.report(id, null)
  }, [controller, id, value.pending, value.label, value.detail, value.view, value.lossRisk, Boolean(value.flush)]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (controller || !risk) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [controller, risk])
}

export function useProjectSaveNavigation() { return useContext(Context)?.navigate }

export function ProjectSaveProtectionProvider({ children, onLocate }: { children: ReactNode; onLocate: (view: ProjectView) => void }) {
  const entries = useRef(new Map<string, Entry>()), [shown, setShown] = useState<Entry[]>([])
  const [busy, setBusy] = useState(false), [leaving, setLeaving] = useState(false)
  const nextAction = useRef<(() => void) | null>(null), running = useRef(false)
  const approvedLeave = useRef(false)
  const dialog = useRef<HTMLDivElement>(null), stay = useRef<HTMLButtonElement>(null), previousFocus = useRef<HTMLElement | null>(null)
  const report = useCallback((id: string, entry: Entry | null) => {
    if (entry) entries.current.set(id, entry); else entries.current.delete(id)
    setShown([...entries.current.values()])
  }, [])
  useEffect(() => {
    // Browsers deliberately replace custom beforeunload text. The named list
    // below is the explanation; native protection remains for reload/close.
    const warn = (event: BeforeUnloadEvent) => {
      if (approvedLeave.current) return
      if (![...entries.current.values()].some(entry => entry.lossRisk !== false)) return
      event.preventDefault(); event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])
  const navigate = useCallback(async (action: () => void) => {
    if (running.current || nextAction.current) return
    if (!entries.current.size) { action(); return }
    running.current = true; setBusy(true)
    try {
      const work = [...entries.current.values()]
      for (const entry of work) {
        if (!entry.flush) continue
        let timeout: ReturnType<typeof setTimeout> | undefined
        try { await Promise.race([entry.flush(), new Promise(resolve => { timeout = setTimeout(() => resolve(false), 15000) })]) } catch { /* Current guards retain failed work. */ }
        finally { clearTimeout(timeout) }
      }
      // Let acknowledgements render and unregister their guards before deciding
      // whether a confirmation is necessary. Never submit a message or diary.
      await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()))
      const risks = [...entries.current.values()].filter(entry => entry.lossRisk !== false)
      if (risks.length) {
        previousFocus.current = document.activeElement as HTMLElement | null
        nextAction.current = action; setLeaving(true)
      } else action()
    } finally { running.current = false; setBusy(false) }
  }, [])
  const controller = useMemo(() => ({ report, navigate }), [report, navigate])
  useEffect(() => {
    let replay: HTMLAnchorElement | null = null
    const click = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
      if (!anchor || anchor === replay || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || anchor.target && anchor.target !== '_self' || anchor.hasAttribute('download') || anchor.getAttribute('href')?.startsWith('#') || anchor.matches('[data-project-tab], .gizmo-back') || !entries.current.size) return
      event.preventDefault(); event.stopPropagation()
      void navigate(() => { replay = anchor; anchor.click(); replay = null })
    }
    document.addEventListener('click', click, true)
    return () => document.removeEventListener('click', click, true)
  }, [navigate])
  useEffect(() => {
    if (!leaving) return
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'; stay.current?.focus()
    return () => { document.body.style.overflow = overflow; previousFocus.current?.focus() }
  }, [leaving])
  function cancel() { nextAction.current = null; setLeaving(false) }
  const risks = shown.filter(entry => entry.lossRisk !== false)
  useEffect(() => {
    if (!leaving || shown.some(entry => entry.lossRisk !== false)) return
    const action = nextAction.current; nextAction.current = null; setLeaving(false); action?.()
  }, [leaving, shown])
  const list = (values: Entry[]) => <ul>{values.map(entry => <li key={entry.id}><div><strong>{entry.label}</strong><span>{entry.detail || 'Ändringar har inte sparats klart.'}</span></div>{entry.view && <button type="button" className="gizmo-button" onClick={() => { cancel(); onLocate(entry.view!) }}>Visa</button>}</li>)}</ul>
  return <Context.Provider value={controller}>
    {(shown.length > 0 || busy) && <aside className={`gizmo-save-protection ${risks.length ? 'has-risk' : ''}`} aria-label="Sparstatus för projektet">
      <details><summary>{busy ? <Loader2 size={16} className="animate-spin" /> : <AlertCircle size={16} />}<span role="status">{busy ? 'Sparar klart före sidbyte…' : risks.length ? `Inte färdigsparat: ${risks.map(entry => entry.label).join(' · ')}` : 'Lokalt utkast finns på den här enheten'}</span></summary>{list(shown)}</details>
    </aside>}
    {children}
    {leaving && createPortal(<div className="gizmo-save-backdrop"><div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="gizmo-save-warning-title" className="gizmo-save-dialog" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); cancel() }
      if (event.key === 'Tab') {
        const buttons = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>('button') || [])
        if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1)?.focus() }
        else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus() }
      }
    }}><h2 id="gizmo-save-warning-title">Det här är inte sparat klart</h2><p>Kontrollera delarna nedan innan du lämnar sidan. Ändringar som bara finns i det öppna formuläret kan gå förlorade.</p>{list(risks)}<footer><button ref={stay} type="button" className="gizmo-button" onClick={cancel}>Stanna kvar</button><button type="button" className="gizmo-button" onClick={() => { const action = nextAction.current; nextAction.current = null; setLeaving(false); approvedLeave.current = true; try { action?.() } finally { setTimeout(() => { approvedLeave.current = false }, 0) } }}>Lämna ändå</button></footer></div></div>, document.body)}
  </Context.Provider>
}
