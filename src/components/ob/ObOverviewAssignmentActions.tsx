'use client'

import { useId, useRef, useState } from 'react'
import { Archive, ArchiveRestore, Ban } from 'lucide-react'
import { useToast } from '@/components/ui/AppToastProvider'
import { useObOrganizationSwitchGuard, withObOrganization } from './ObOrganizationBoundary'
import type { ObOverviewItem } from '@/lib/ob/overview'

type Action = 'archive' | 'restore' | 'cancel'
export default function ObOverviewAssignmentActions({ assignment, address, orgId, onChanged }: {
  assignment: NonNullable<ObOverviewItem['assignment']>; address: string; orgId: string; onChanged: () => Promise<void>
}) {
  const toast = useToast()
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const [action, setAction] = useState<Action>('archive')
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const selected = useRef<(NonNullable<ObOverviewItem['assignment']> & { orgId: string }) | null>(null)
  useObOrganizationSwitchGuard(false, busy)
  const canArchive = assignment.archived || !['sent', 'ordered', 'booked'].includes(assignment.status)
  const canCancel = assignment.status !== 'cancelled'
  const labels = { archive: 'Arkivera bekräftelse', restore: 'Återför från arkiv', cancel: 'Avboka bekräftelse' }
  function open(next: Action) {
    selected.current = { ...assignment, orgId }
    setAction(next); dialog.current?.showModal()
  }
  async function confirm() {
    if (inFlight.current) return
    const target = selected.current
    if (!target || target.id !== assignment.id || target.status !== assignment.status ||
      target.archived !== assignment.archived || target.orgId !== orgId) {
      dialog.current?.close()
      toast.warning('Uppdragsbekräftelsen har ändrats. Kontrollera den igen innan du fortsätter.')
      return
    }
    inFlight.current = true; setBusy(true)
    try {
      const archived_at = action === 'restore' ? null : new Date().toISOString()
      const response = await fetch(withObOrganization(`/api/ob/assignments/${encodeURIComponent(target.id)}`, target.orgId), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived_at, ...(action === 'cancel' ? { status: 'cancelled' } : {}) }),
      })
      const result = await response.json().catch(() => null)
      if (!response.ok) throw Error(result?.error || 'Uppdragsbekräftelsen kunde inte uppdateras.')
      dialog.current?.close()
      toast.success(action === 'cancel' ? 'Uppdragsbekräftelsen är avbokad och arkiverad.' : action === 'restore'
        ? 'Uppdragsbekräftelsen är återförd från arkivet.' : 'Uppdragsbekräftelsen är arkiverad.')
      await onChanged()
    } catch (error) { dialog.current?.close(); toast.error(error, 'Uppdragsbekräftelsen kunde inte uppdateras.') }
    finally { inFlight.current = false; setBusy(false) }
  }
  return <div className="obo-assignment-actions">
    <button type="button" disabled={busy || !canArchive} title={canArchive ? undefined : 'En aktiv skickad eller bokad bekräftelse måste först avbokas.'}
      onClick={() => open(assignment.archived ? 'restore' : 'archive')}>
      {assignment.archived ? <ArchiveRestore size={18} aria-hidden /> : <Archive size={18} aria-hidden />}
      {assignment.archived ? labels.restore : labels.archive}
    </button>
    <button type="button" disabled={busy || !canCancel} onClick={() => open('cancel')}><Ban size={18} aria-hidden />{labels.cancel}</button>
    <dialog ref={dialog} className="obo-assignment-dialog" aria-labelledby={titleId} onCancel={event => { if (busy) event.preventDefault() }}>
      <h3 id={titleId}>{labels[action]}</h3><p>{address}</p>
      <p>{action === 'cancel' ? 'Uppdragsbekräftelsen avbokas och flyttas till arkivet. Avbokningen kan pausa det fortsatta besiktningsarbetet.'
        : action === 'restore' ? 'Uppdragsbekräftelsen återförs från arkivet. En eventuell avbokning hävs inte.'
        : 'Uppdragsbekräftelsen flyttas till arkivet.'}</p>
      <p>Besiktningen och tidigare utlåtanden raderas inte.</p>
      <div><button type="button" autoFocus disabled={busy} onClick={() => dialog.current?.close()}>Avbryt</button>
        <button type="button" disabled={busy} onClick={() => void confirm()}>{busy ? 'Sparar…' : labels[action]}</button></div>
    </dialog>
  </div>
}
