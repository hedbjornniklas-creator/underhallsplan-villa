'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import ActionButton from '@/components/ui/ActionButton'
import PendingLink from '@/components/ui/PendingLink'
import UppdragScope from '@/components/tasks/UppdragScope'

export default function UppdragError({ reset }: { reset: () => void }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  return <UppdragScope><main className="gizmo-route-error" role="alert">
    <h1>Sidan kunde inte öppnas</h1>
    <p>Försök igen om en stund.</p>
    <div>
      <ActionButton busy={pending} busyLabel="Försöker igen…" icon={<RefreshCw size={18} />} className="gizmo-button gizmo-primary" onClick={() => startTransition(() => {
        router.refresh()
        reset()
      })}>Försök igen</ActionButton>
      <PendingLink autoPending pendingLabel="Öppnar projektlistan…" href="/uppdrag?view=projects" className="gizmo-button">Alla projekt</PendingLink>
    </div>
  </main></UppdragScope>
}
