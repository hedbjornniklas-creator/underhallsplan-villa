'use client'

import { useState } from 'react'
import { Link2Off, Loader2 } from 'lucide-react'
import type { RfqDelivery } from '@/lib/action-cases/rfqDelivery'

export default function ActionCaseRfqDelivery({ delivery, busy, onRevoke }: {
  delivery: RfqDelivery; busy: boolean; onRevoke: () => Promise<boolean>
}) {
  const [confirming, setConfirming] = useState(false)
  const [openedAt] = useState(Date.now)
  const closed = delivery.revokedAt || Date.parse(delivery.expiresAt) <= openedAt
  return <section className="space-y-2 border-b border-slate-200 pb-4" aria-label="Mottagarlänk">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p role="status" className="text-sm text-slate-600">{delivery.revokedAt ? 'Mottagarlänken är återkallad' : closed ? 'Mottagarlänken har gått ut' : `Mottagarlänk giltig till ${new Date(delivery.expiresAt).toLocaleDateString('sv-SE')}`}</p>
      {!closed && !confirming ? <button type="button" disabled={busy} onClick={() => setConfirming(true)} className="inline-flex min-h-11 items-center gap-2 text-sm text-slate-600 disabled:opacity-40"><Link2Off size={16} />Återkalla länk</button> : null}
    </div>
    {!closed && confirming ? <div className="space-y-2"><p className="text-sm">Återkalla åtkomsten till offertunderlaget? Redan nedladdade filer påverkas inte. Öppna filer kan vara tillgängliga i upp till en minut.</p><div className="flex flex-wrap gap-3"><button type="button" disabled={busy} onClick={() => setConfirming(false)} className="min-h-11 px-3 text-sm">Avbryt</button><button type="button" disabled={busy} onClick={() => void onRevoke().then((ok) => { if (ok) setConfirming(false) })} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-red-200 px-3 text-sm font-semibold text-red-700 disabled:opacity-40">{busy ? <Loader2 size={16} className="animate-spin" /> : <Link2Off size={16} />}Återkalla åtkomst</button></div></div> : null}
  </section>
}
