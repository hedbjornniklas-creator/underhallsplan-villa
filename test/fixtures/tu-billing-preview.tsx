import { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import TuInvestigationBillingPanel, { type TuInvestigationBillingPanelHandle } from '../../src/components/tu/TuInvestigationBillingPanel'
import { AppToastProvider } from '../../src/components/ui/AppToastProvider'
import { emptyTuInvestigationBilling, type TuInvestigationBilling } from '../../src/lib/tu/billing'

const firstOrg = '11111111-1111-4111-8111-111111111111'
const otherOrg = '22222222-2222-4222-8222-222222222222'
const firstId = '10000000-0000-4000-8000-000000000001'
const otherId = '10000000-0000-4000-8000-000000000002'
const query = new URLSearchParams(location.search)
declare global { interface Window { __tuBillingTest: {
  billing: TuInvestigationBilling; writes: { url: string; body: Record<string, unknown> }[];
  reads: string[]; fail: number; delay: number; readDelay: number; canEdit: boolean; unavailable: boolean;
  changed: Array<{ orgId: string; inspectionId: string; invoiceNumber: string | null }>;
} } }
window.__tuBillingTest = { billing: { ...emptyTuInvestigationBilling(), invoiceNumber: query.has('slowload') ? 'OLD-GET-RESPONSE' : null }, writes: [], reads: [], fail: 0,
  delay: 0, readDelay: query.has('slowload') ? 500 : 0, canEdit: !query.has('readonly'), unavailable: query.has('unavailable'), changed: [] }
const records = new Map<string, TuInvestigationBilling>()
const primary = (orgId: string, inspectionId: string) => orgId === firstOrg && inspectionId === firstId
const getBilling = (orgId: string, inspectionId: string) => primary(orgId, inspectionId)
  ? window.__tuBillingTest.billing : records.get(`${orgId}:${inspectionId}`) ?? emptyTuInvestigationBilling()
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.href)
  if (url.origin !== location.origin) throw Error('Synthetic TU billing preview forbids external requests')
  const match = url.pathname.match(/^\/api\/tu\/investigations\/([^/]+)\/billing$/)
  if (!match) throw Error(`Unexpected synthetic endpoint: ${url.pathname}`)
  const orgId = url.searchParams.get('orgId')
  if (!orgId || ![firstOrg, otherOrg].includes(orgId)) throw Error('Billing request lost selected organization')
  const inspectionId = match[1]
  const state = window.__tuBillingTest
  const method = init?.method ?? 'GET'
  if (method === 'GET') {
    state.reads.push(url.pathname + url.search)
    const current = { ...getBilling(orgId, inspectionId) }
    await new Promise(resolve => setTimeout(resolve, state.readDelay))
    return state.unavailable ? Response.json({ error: 'Databasstödet för fakturamarkering behöver installeras.' }, { status: 503 })
      : Response.json({ billing: state.canEdit ? current : { status: current.status }, canEdit: state.canEdit })
  }
  if (method !== 'PATCH') throw Error(`Unexpected synthetic method: ${method}`)
  const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
  state.writes.push({ url: url.pathname + url.search, body })
  await new Promise(resolve => setTimeout(resolve, state.delay))
  if (!state.canEdit) return Response.json({ error: 'Endast läsning' }, { status: 403 })
  if (state.fail) return Response.json({ error: 'Syntetiskt sparfel. Ingen ändring är bekräftad.' }, { status: state.fail })
  const current = getBilling(orgId, inspectionId)
  if (body.expectedRevision !== current.revision) return Response.json({ error: 'Konflikt' }, { status: 409 })
  const updated: TuInvestigationBilling = {
    status: body.isInvoiced ? 'invoiced' : 'not_invoiced', invoicedAt: body.isInvoiced ? '2026-11-10T10:00:00Z' : null,
    invoiceNumber: body.invoiceNumber as string | null, updatedAt: '2026-11-10T10:00:00Z',
    updatedByName: 'Testperson', revision: current.revision + 1,
  }
  if (primary(orgId, inspectionId)) state.billing = updated
  else records.set(`${orgId}:${inspectionId}`, updated)
  return Response.json({ billing: updated, canEdit: true })
}

/** Mounts the real panel with its editor contract; it never edits a real report. */
function App() {
  const [inspectionId, setInspectionId] = useState(firstId)
  const [organizationId, setOrganizationId] = useState(firstOrg)
  const [show, setShow] = useState(true)
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  const panelRef = useRef<TuInvestigationBillingPanelHandle>(null)
  const leave = async () => { if (await panelRef.current?.flush() !== false) setShow(false) }
  return <main className="mx-auto max-w-4xl space-y-4 p-4">
    <h1 className="text-xl font-semibold">TU fakturamarkering · syntetiskt test</h1>
    <p id="report-lock">Utlåtandet är låst. Inga rapportuppgifter ändras av testet.</p>
    <nav className="flex flex-wrap items-center gap-4">
      <button id="leave-delivery" className="min-h-11" onClick={() => void leave()}>Annan sektion</button>
      <button id="show-delivery" className="min-h-11" onClick={() => setShow(true)}>Leverans</button>
      <a id="other-investigation" className="inline-flex min-h-11 items-center" href={`/tu/investigations/${otherId}?orgId=${organizationId}`}
        onClick={event => { event.preventDefault(); setInspectionId(otherId) }}>Annan utredning</a>
      <button id="forced-investigation" className="min-h-11" onClick={() => setInspectionId(otherId)}>Simulera annan utredning</button>
      <button id="forced-org" className="min-h-11" onClick={() => setOrganizationId(otherOrg)}>Simulera annan organisation</button>
      <button id="force-hide" className="min-h-11" onClick={() => setShow(false)}>Dölj portal</button>
    </nav>
    <output id="current-scope" className="block break-all">{organizationId}:{inspectionId}</output>
    {show && <div id="billing-host" ref={setHost} />}
    <TuInvestigationBillingPanel key={`${organizationId}:${inspectionId}`} ref={panelRef} inspectionId={inspectionId}
      organizationId={organizationId} portalTarget={host}
      onChanged={billing => window.__tuBillingTest.changed.push({ orgId: organizationId, inspectionId, invoiceNumber: billing.invoiceNumber })} />
  </main>
}
createRoot(document.getElementById('root')!).render(<AppToastProvider><App /></AppToastProvider>)
