import { createRoot } from 'react-dom/client'
import AssignmentPage from '../../src/app/(dashboard)/ob/assignments/[id]/page'
import Boundary from '../../src/components/ob/ObAssignmentWorkflowBoundary'

createRoot(document.getElementById('root')!).render(
  location.pathname === '/boundary' ? <main className="mx-auto max-w-5xl p-4">
    <Boundary inspectionId="test-inspection" showStatus={!new URLSearchParams(location.search).has('round')}><label>Notering<input id="test-note" /></label></Boundary>
  </main> : <AssignmentPage />,
)
