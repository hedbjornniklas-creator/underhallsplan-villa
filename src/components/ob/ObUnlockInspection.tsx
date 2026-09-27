'use client'

import { useState } from 'react'
import { UnlockKeyhole } from 'lucide-react'
import { useToast } from '@/components/ui/AppToastProvider'
import Sheet from './ObRoundSheet'

export default function ObUnlockInspection({ inspectionId, disabled, onUnlocked }: {
  inspectionId: string; disabled?: boolean; onUnlocked: () => void
}) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const unlock = async () => {
    if (busy || reason.trim().length < 10) return
    setBusy(true)
    try {
      const response = await fetch(`/api/ob/inspections/${inspectionId}/unlock`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      })
      const result = await response.json().catch(() => null)
      if (!response.ok || result?.ok !== true) throw new Error(result?.error || 'Besiktningen kunde inte låsas upp.')
      onUnlocked()
      setOpen(false)
      toast.success('Besiktningen är upplåst.')
    } catch (caught) {
      toast.error(caught, 'Besiktningen kunde inte låsas upp.')
    } finally { setBusy(false) }
  }

  return <>
    <button type="button" className="ob-delivery-secondary inline-flex items-center gap-2"
      disabled={disabled} onClick={() => { setReason(''); setOpen(true) }}>
      <UnlockKeyhole size={18} aria-hidden="true" />Lås upp besiktning
    </button>
    {open && <Sheet title="Lås upp besiktning" className="ob-unlock-sheet" closeDisabled={busy}
      onClose={() => setOpen(false)} footer={<>
        <button type="button" className="obm-secondary" disabled={busy} onClick={() => setOpen(false)}>Avbryt</button>
        <button type="button" className="obm-primary" disabled={busy || reason.trim().length < 10} onClick={() => void unlock()}>
          {busy ? 'Låser upp...' : 'Lås upp'}
        </button>
      </>}>
      <p>Tidigare publicerade utlåtanden och PDF-filer ändras inte när du låser upp besiktningen.</p>
      <label className="ob-unlock-reason">Anledning till upplåsning
        <textarea autoFocus rows={3} value={reason} disabled={busy} minLength={10}
          aria-describedby="ob-unlock-hint" onChange={event => setReason(event.target.value)} />
      </label>
      <p id="ob-unlock-hint">Minst 10 tecken. Anledningen sparas i loggen.</p>
    </Sheet>}
  </>
}
