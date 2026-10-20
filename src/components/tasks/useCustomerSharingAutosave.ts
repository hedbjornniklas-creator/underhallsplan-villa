'use client'
import { useEffect, useRef, useState } from 'react'
import { useAutosaveQueue } from '@/hooks/useAutosaveQueue'
import { customerSections, type CustomerSection, type CustomerSharingWorkspace } from '@/lib/action-cases/customerSharing'

type Request = { requestId: string; revision: number; section: CustomerSection; visible: boolean }
export function useCustomerSharingAutosave(caseId: string) {
  const saved = useRef<CustomerSharingWorkspace | null>(null), edits = useRef<Partial<Record<CustomerSection, boolean>>>({})
  const pending = useRef<Request | null>(null), failed = useRef(false), running = useRef(false), mounted = useRef(true)
  const [state, setState] = useState<{ workspace: CustomerSharingWorkspace | null; edits: Partial<Record<CustomerSection, boolean>>; busy: boolean; dirty: boolean; error: string }>({ workspace: null, edits: {}, busy: false, dirty: false, error: '' })
  const error = useRef('')
  function publish() { if (mounted.current) setState({ workspace: saved.current, edits: { ...edits.current }, busy: running.current, dirty: Boolean(pending.current || Object.keys(edits.current).length), error: error.current }) }
  const queue = useAutosaveQueue<true, void>({ save: async () => {
    if (failed.current || !saved.current) return
    running.current = true; publish()
    try {
      while (mounted.current && saved.current) {
        if (!pending.current) {
          const section = customerSections.find(s => edits.current[s.key] !== undefined && edits.current[s.key] !== saved.current!.tabs[s.key])?.key
          if (!section) { edits.current = {}; break }
          pending.current = { requestId: crypto.randomUUID(), revision: saved.current.revision, section, visible: edits.current[section]! }
        }
        if (!saved.current.canEdit) throw new Error('Projektansvarig har ändrats. Dina val är kvar.')
        const request = pending.current
        const response = await fetch(`/api/action-cases/${caseId}/sharing`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) })
        const result = await response.json(), next = result.workspace as CustomerSharingWorkspace
        if (!response.ok) throw new Error(result.error || 'Delningen kunde inte sparas. Dina val är kvar.')
        if (result.requestId !== request.requestId || result.acknowledgedRevision !== request.revision + 1 || !next || !Number.isSafeInteger(next.revision) || next.revision < result.acknowledgedRevision || customerSections.some(s => typeof next.tabs?.[s.key] !== 'boolean')) throw new Error('Sparningen kunde inte bekräftas. Dina val är kvar.')
        saved.current = next; pending.current = null
        if (edits.current[request.section] === request.visible) delete edits.current[request.section]
        error.current = ''; publish()
      }
    } catch (e) { failed.current = true; error.current = e instanceof Error ? e.message : 'Delningen kunde inte sparas.'; throw e }
    finally { running.current = false; publish() }
  } })
  function change(section: CustomerSection, visible: boolean) {
    if (!saved.current?.canEdit) return
    edits.current[section] = visible; publish()
    if (!failed.current) void queue.enqueue(true).catch(() => undefined)
  }
  function retry() { failed.current = false; error.current = ''; publish(); void queue.enqueue(true).catch(() => undefined) }
  function reset(workspace: CustomerSharingWorkspace) {
    if (running.current) return false
    saved.current = workspace; edits.current = {}; pending.current = null; failed.current = false; error.current = ''; publish(); return true
  }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  return { ...state, change, retry, reset, isBusy: () => running.current }
}
