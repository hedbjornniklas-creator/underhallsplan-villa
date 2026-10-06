import { LoaderCircle } from 'lucide-react'
import UppdragScope from '@/components/tasks/UppdragScope'

export default function ProjectLoading() {
  return <UppdragScope><main className="gizmo-route-loading" role="status" aria-busy="true" aria-live="polite">
    <LoaderCircle size={22} className="animate-spin" aria-hidden="true" />
    <p>Öppnar projekt…</p>
  </main></UppdragScope>
}
