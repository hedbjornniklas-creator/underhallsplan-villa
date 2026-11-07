import { useState, type ComponentProps } from 'react'
import { createRoot } from 'react-dom/client'
import ObWizard, { type ObWizardInspectionInput, type ObWizardPropertyInput, type ObSectionKey } from '../../src/components/ob/ObWizard'
import { ObBuildingContext } from '../../src/components/ob/ObBuildingContext'
import ObOrganizationBoundary from '../../src/components/ob/ObOrganizationBoundary'
import OrganizationContextProvider from '../../src/components/organizations/OrganizationContextProvider'
import { AppToastProvider } from '../../src/components/ui/AppToastProvider'
import PendingLink from '../../src/components/ui/PendingLink'
import { emptyObInspectionBilling, type ObInspectionBilling } from '../../src/lib/ob/billing'
import { inspection, inspectionId, property, overview, parts } from './ob-forms-client'

declare global { interface Window { __obBillingTest: { billing: ObInspectionBilling; writes: { url: string; body: Record<string, unknown> }[];
  reads: string[]; fail: number; delay: number; canEdit: boolean; unavailable: boolean } } }
const query = new URLSearchParams(location.search)
const org = { id: '11111111-1111-4111-8111-111111111111', name: 'Testbolaget', isDefault: true }
window.__obBillingTest = { billing: emptyObInspectionBilling(), writes: [], reads: [], fail: 0, delay: 0,
  canEdit: !query.has('readonly'), unavailable: query.has('unavailable') }
const deliveryMeta = () => ({ inspectionId, inspectionStatus: 'completed', canSend: !query.has('workflowblocked'),
  hasStoredPdf: true, pdfStatus: 'ready', pdfError: null, canDownloadPdf: true, reason: 'Syntetisk workflowspärr',
  defaultRecipientEmail: 'test@example.invalid', ordererEmail: 'test@example.invalid', history: [], activityLog: [] })
const otherBilling = new Map<string, ObInspectionBilling>()
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.href)
  if (url.origin !== location.origin) throw Error('Synthetic OB billing preview forbids external requests')
  const state = window.__obBillingTest
  const method = init?.method ?? 'GET'
  if (url.pathname === '/api/organizations/context') return Response.json({ organization: org, organizations: [org] })
  if (url.pathname.endsWith('/billing')) {
    const selectedId = url.pathname.split('/')[4]
    const current = selectedId === inspectionId ? state.billing : otherBilling.get(selectedId) ?? emptyObInspectionBilling()
    if (url.searchParams.get('orgId') !== org.id) throw Error('Billing request lost selected organization')
    if (method === 'GET') { state.reads.push(url.pathname); return state.unavailable
      ? Response.json({ error: 'Databasstödet för fakturamarkering behöver installeras.' }, { status: 503 })
      : Response.json({ billing: state.canEdit ? current : { status: current.status }, canEdit: state.canEdit }) }
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    state.writes.push({ url: url.pathname + url.search, body })
    await new Promise(resolve => setTimeout(resolve, state.delay))
    if (!state.canEdit) return Response.json({ error: 'Endast läsning' }, { status: 403 })
    if (state.fail) return Response.json({ error: 'Syntetiskt sparfel' }, { status: state.fail })
    if (body.expectedRevision !== current.revision) return Response.json({ error: 'Konflikt' }, { status: 409 })
    const updated: ObInspectionBilling = { status: body.isInvoiced ? 'invoiced' : 'not_invoiced', invoicedAt: body.isInvoiced ? '2026-11-07T10:00:00Z' : null,
      invoiceNumber: body.invoiceNumber as string | null, updatedAt: '2026-11-07T10:00:00Z', updatedByName: 'Testperson', revision: current.revision + 1 }
    if (selectedId === inspectionId) state.billing = updated
    else otherBilling.set(selectedId, updated)
    return Response.json({ billing: updated })
  }
  if (url.pathname.endsWith('/report-delivery')) {
    if (method === 'GET') return Response.json(deliveryMeta())
    state.writes.push({ url: url.pathname, body: JSON.parse(String(init?.body ?? '{}')) })
    return Response.json({ ...deliveryMeta(), inspectionLockedAt: '2026-11-07T09:00:00Z', sentRecipients: ['test@example.invalid'],
      failedRecipients: [], publicLink: '/synthetic-report', primaryRecipientEmail: 'test@example.invalid', linkId: 'synthetic' })
  }
  if (method === 'GET') return Response.json({})
  throw Error(`Unexpected synthetic write: ${method} ${url.pathname}`)
}
function App() {
  const [section, setSection] = useState<ObSectionKey>('delivery')
  const [selectedInspection, setSelectedInspection] = useState(inspectionId)
  const building = { inspectionId, overview, part: parts[0], reload: async () => {} } as unknown as NonNullable<ComponentProps<typeof ObBuildingContext.Provider>['value']>
  return <ObBuildingContext.Provider value={building}>
    <nav className="flex flex-wrap gap-4 p-4"><button id="leave-delivery" onClick={() => setSection('risk')}>Annan sektion</button><button id="show-delivery" onClick={() => setSection('delivery')}>Skicka utlåtande</button>
      <PendingLink id="other-inspection" autoPending href="/properties/10000000-0000-4000-8000-000000000099/ob/10000000-0000-4000-8000-000000000002" onClick={event => { event.preventDefault(); setSelectedInspection('10000000-0000-4000-8000-000000000002') }}>Annan besiktning</PendingLink>
      <button id="forced-inspection" onClick={() => setSelectedInspection('10000000-0000-4000-8000-000000000002')}>Simulera annan navigering</button>
      <output id="current-inspection">{selectedInspection}</output></nav>
    <main className="mx-auto max-w-5xl p-4"><ObWizard
      property={{ ...property, id: '10000000-0000-4000-8000-000000000099', name: 'Testgatan 1' } as unknown as ObWizardPropertyInput}
      inspection={{ ...inspection, id: selectedInspection, status: 'completed', locked_at: '2026-11-07T09:00:00Z' } as unknown as ObWizardInspectionInput}
      activeSection={section} /></main>
  </ObBuildingContext.Provider>
}
createRoot(document.getElementById('root')!).render(<AppToastProvider><OrganizationContextProvider><ObOrganizationBoundary><App /></ObOrganizationBoundary></OrganizationContextProvider></AppToastProvider>)
