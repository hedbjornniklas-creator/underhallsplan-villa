'use client'

import { useId, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Trash2 } from 'lucide-react'
import { useToast } from '@/components/ui/AppToastProvider'

export default function TuDeleteInvestigationButton({ inspectionId, organizationId, title, locked }: {
  inspectionId: string; organizationId: string; title: string; locked: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useId()
  const inFlight = useRef(false)
  const [busy, setBusy] = useState(false)
  const remove = async () => {
    if (locked || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    try {
      const response = await fetch(`/api/tu/investigations/${encodeURIComponent(inspectionId)}?orgId=${encodeURIComponent(organizationId)}`, { method: 'DELETE' })
      if (!response.ok) throw new Error('DELETE_FAILED')
      dialog.current?.close()
      toast.show('Utredningen har raderats.', { tone: 'success' })
      router.push(`/tu?orgId=${encodeURIComponent(organizationId)}`)
    } catch {
      dialog.current?.close()
      toast.show('Utredningen kunde inte raderas. Uppdatera sidan och kontrollera att den inte är låst.', { tone: 'error' })
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }
  const button = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50'
  return <>
    <button type="button" className={button} disabled={locked || busy}
      title={locked ? 'Låsta utlåtanden kan inte raderas' : 'Radera utredning'}
      onClick={() => dialog.current?.showModal()}><Trash2 size={16} aria-hidden />Radera utredning</button>
    <dialog ref={dialog} aria-labelledby={heading} onCancel={event => { if (busy) event.preventDefault() }}
      className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-auto rounded-lg border border-slate-300 bg-white p-5 text-slate-900 shadow-xl backdrop:bg-black/40">
      <h2 id={heading} className="text-lg font-semibold">Radera utredning?</h2>
      <p className="mt-3 break-words text-sm leading-6">Utredningen ”{title}” och dess underlag raderas. Det går inte att ångra.</p>
      <div className="mt-5 flex flex-wrap justify-end gap-3">
        <button type="button" className={button} disabled={busy} onClick={() => dialog.current?.close()}>Avbryt</button>
        <button type="button" className={`${button} !border-red-700 !bg-red-700 !text-white`} disabled={locked || busy} onClick={() => void remove()}>
          {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Trash2 size={16} aria-hidden />}
          {busy ? 'Raderar...' : 'Radera utredning'}
        </button>
      </div>
    </dialog>
  </>
}
