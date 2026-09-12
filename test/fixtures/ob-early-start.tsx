import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import AssignmentPage from '../../src/app/(dashboard)/ob/assignments/[id]/page'
import Boundary from '../../src/components/ob/ObAssignmentWorkflowBoundary'
import type { ObAssignmentWorkflow } from '../../src/lib/ob/assignmentWorkflow'
import { recordObGrunddataWriteResult, trackObGrunddataWrite } from '../../src/lib/ob/grunddataWrites'

function BoundaryFixture() {
  const [grunddata, setGrunddata] = useState({ customer_phone: '', customer_name: 'Besiktningsmannens namn' })
  const [updatedFields, setUpdatedFields] = useState<string[]>([])
  const [customerNameDraft, setCustomerNameDraft] = useState('Besiktningsmannens namn')
  const [allowNameSave, setAllowNameSave] = useState(false)
  const [nameSaveStatus, setNameSaveStatus] = useState('')
  const showFailedSaveFixture = new URLSearchParams(location.search).has('failed-grunddata')
  const saveCustomerName = () => trackObGrunddataWrite('test-inspection', async () => {
    setNameSaveStatus('saving')
    try {
      const response = await fetch('/api/ob/inspections/test-inspection/fixture-grunddata', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_name: customerNameDraft, fail: !allowNameSave }),
      })
      recordObGrunddataWriteResult('test-inspection', ['inspection:customer_name'], !response.ok)
      if (!response.ok) { setNameSaveStatus('failed'); return }
      setGrunddata(previous => ({ ...previous, customer_name: customerNameDraft }))
      setNameSaveStatus('saved')
    } catch {
      recordObGrunddataWriteResult('test-inspection', ['inspection:customer_name'], true)
      setNameSaveStatus('failed')
    }
  })
  useEffect(() => {
    const reconcile = (event: Event) => {
      const { workflow, fields } = (event as CustomEvent<{ workflow: ObAssignmentWorkflow; fields: string[] }>).detail
      setGrunddata(previous => ({ ...previous,
        ...Object.fromEntries(fields.map(field => [field, workflow.inspectionSnapshot?.[field] ?? ''])),
      }))
      if (fields.includes('customer_name')) setCustomerNameDraft(String(workflow.inspectionSnapshot?.customer_name ?? ''))
      setUpdatedFields(fields)
    }
    window.addEventListener('ob-assignment-reconciled', reconcile)
    return () => window.removeEventListener('ob-assignment-reconciled', reconcile)
  }, [])
  return <main className="mx-auto max-w-5xl p-4">
    <Boundary inspectionId="test-inspection" showStatus={!new URLSearchParams(location.search).has('round')}>
      <label>Notering<input id="test-note" /></label>
      {showFailedSaveFixture ? <div className="my-4 flex flex-col gap-2">
        <label className="flex min-w-0 flex-col gap-1">Kundnamn<input id="test-customer-name-input" className="w-full min-w-0 rounded border border-slate-300 p-2" value={customerNameDraft}
          onChange={event => setCustomerNameDraft(event.target.value)} onBlur={() => void saveCustomerName()} /></label>
        <label><input id="test-allow-name-save" type="checkbox" checked={allowNameSave}
          onChange={event => setAllowNameSave(event.target.checked)} />Nästa namnsparning lyckas</label>
        <output id="test-name-save-status">{nameSaveStatus}</output>
      </div> : null}
      <dl><dt>Grunddata telefon</dt><dd><output id="test-phone">{grunddata.customer_phone}</output></dd>
        <dt>Grunddata kund</dt><dd><output id="test-customer">{grunddata.customer_name}</output></dd></dl>
      <output id="test-updated-fields">{updatedFields.join(',')}</output>
    </Boundary>
  </main>
}

createRoot(document.getElementById('root')!).render(
  location.pathname === '/boundary' ? <BoundaryFixture /> : <AssignmentPage />,
)
