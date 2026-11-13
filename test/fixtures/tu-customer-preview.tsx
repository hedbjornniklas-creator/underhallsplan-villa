import { createRoot } from 'react-dom/client'
import { useRef, useState } from 'react'
import TuInvestigationCustomerEditor from '../../src/components/tu/TuInvestigationCustomerEditor'
import TuDashboardClient from '../../src/components/tu/TuDashboardClient'
import TuAssignmentEditor from '../../src/components/tu/TuAssignmentEditor'
import TuPrintPagedDocument from '../../src/components/tu/TuPrintPagedDocument'
import TuPublicReportSnapshotView from '../../src/components/tu/TuPublicReportSnapshotView'
import AcceptPage from '../../src/app/accept/[token]/page'
import { AppToastProvider } from '../../src/components/ui/AppToastProvider'
import { TU_STANDARD_REPORT_TEMPLATES } from '../../src/lib/tu/reportTemplates'
import { calculateTuPricing, type TuCustomer, type TuCustomerKind } from '../../src/lib/tu/customer'
import { tuAssignment, tuPreviewOrg } from './tu-overview-data'
import { tuCopyDemo } from './tu-copy-data'
import { parseTuAssignmentEdit, TU_ASSIGNMENT_CHANGED_MESSAGE } from '../../src/lib/tu/assignmentEditing'
import type { AssignmentDetails } from '../../src/lib/assignments/server'
import { createTuReportSnapshotPayloadV1 } from '../../src/lib/tu/reportSnapshot'
import type { TuInvestigationDetails } from '../../src/lib/tu/server'

const query = new URLSearchParams(location.search)
const kind = (query.get('kind') ?? 'association') as TuCustomerKind
const customer: TuCustomer = { version: 1, kind, contactName: 'Anna Exempel', contactRole: 'Kontaktperson',
  identityNumber: kind === 'consumer' ? '' : '769600-0000', invoiceName: '', invoiceAddress: '', invoiceReference: 'Projekt 17' }
let record: AssignmentDetails = {
  ...tuAssignment({ status: query.get('status') === 'sent' ? 'sent' : query.get('status') === 'approved' ? 'ordered' : 'draft' }), customer_name: kind === 'consumer' ? 'Anna Exempel' : 'Exempelforeningen',
  customer_address: 'Kundgatan 1', customer_postal_code: '12345', customer_city: 'Stockholm', customer_phone: '0701234567',
  property_municipality: 'Stockholm', property_owner_name: 'Objektagaren', property_id: null,
  invoice_name: '', invoice_address: '', invoice_email: '', personal_identity_number: customer.identityNumber,
  orderer_role: null, notes_internal: '', terms_version: 'test', terms_document_hash: 'a'.repeat(64),
  preferred_date: '2099-12-15', currency: 'SEK', price_amount: 6250,
  assignment_details: { objectType: query.get('object') === 'apartment' ? 'apartment' : 'villa',
    customerType: kind === 'consumer' ? 'consumer' : 'business', tuCustomer: customer,
    tuPricing: calculateTuPricing(kind === 'business' ? 5000 : 6250, kind === 'business' ? 'exclusive' : 'inclusive') },
  brf_name: 'BRF Objektet', apartment_number: '12', apartment_holder_name: 'Annan person',
}
declare global { interface Window { __tuCustomerPreview: { requests: Array<{ url: string; body: Record<string, unknown> }> } } }
window.__tuCustomerPreview = { requests: [] }
window.fetch = async (input, init) => {
  const url = String(input)
  if (init?.method && init.method !== 'GET') {
    const body = JSON.parse(String(init.body))
    window.__tuCustomerPreview.requests.push({ url, body })
    if (init.method === 'PATCH') {
      record = { ...record, ...parseTuAssignmentEdit(body, record.assignment_details).patch, updated_at: new Date().toISOString() } as AssignmentDetails
      return Response.json({ assignment: record })
    }
    if (url.includes('/accept/')) {
      if (query.has('stale') && body.tuEditRevision !== 1) {
        record = { ...record, scope_description: 'Ny omfattning efter redigering', property_address: 'Rattad gata 3', price_amount: 7500,
          assignment_details: { ...record.assignment_details, tuEditRevision: 1, tuPricing: calculateTuPricing(7500, 'inclusive') } }
        return Response.json({ error: TU_ASSIGNMENT_CHANGED_MESSAGE, code: 'TU_ASSIGNMENT_CONTENT_CHANGED', retryable: true }, { status: 409 })
      }
      return Response.json({ ok: true, confirmationEmailSent: true })
    }
    return Response.json({ assignment: { id: 'synthetic-new' }, inspectionId: 'synthetic-new' })
  }
  if (url.includes('/accept/')) return Response.json({ state: 'open', expiresAt: '2099-12-31', usedAt: null,
    assignment: record, inspector: null, addonOffers: [], selectedAddonServiceIds: [], withdrawal: null,
    terms: { version: 'test', documents: { technical: { text: 'Syntetiska testvillkor.', hash: 'a'.repeat(64), templateId: 'test' } } },
  })
  if (url.includes('/settings/customers')) return Response.json({ workspace: { organization: { id: tuPreviewOrg }, customers: [] } })
  return Response.json({ org: { id: tuPreviewOrg }, items: [] })
}
function Edit() {
  const [assignment, setAssignment] = useState(record)
  return <main className="mx-auto max-w-3xl p-4"><TuAssignmentEditor assignment={assignment} onSaved={() => setAssignment(record)} /></main>
}
function InvestigationCustomer() {
  const [value, setValue] = useState(customer)
  const pending = useRef(false)
  return <main className="mx-auto max-w-3xl p-4"><TuInvestigationCustomerEditor customer={value} disabled={false} pendingRef={pending} onSave={async next => {
    window.__tuCustomerPreview.requests.push({ url: '/synthetic/customer', body: { tuCustomer: next } })
    setValue(next)
  }} /></main>
}
function Report() {
  const snapshot = createTuReportSnapshotPayloadV1({
    investigation: {
      inspectionId: 'synthetic-report', inspection: { customer_name: record.customer_name },
      assignment: record, tuCustomer: customer, objectType: 'villa', cadastralId: 'TEST 1:1',
      title: 'Tekniskt utlåtande', reportTemplateKey: 'short_technical_statement',
      property: { address: 'Objektgatan 1', city: 'Stockholm' },
      inspector: { full_name: 'Erik Besiktningsman', company_name: 'Testbolaget', email: 'erik@example.test', phone: '0701112233' },
      reportDraft: { sections: [{ id: 'scope', key: 'assignment_scope', title: 'Uppdrag och avgränsning',
        text: 'Besiktningsmannens egen text. Detta är enbart ett syntetiskt layouttest.' }] },
    } as unknown as TuInvestigationDetails,
    coverImages: [], appendixImages: [], createdAt: new Date('2026-11-11T12:00:00Z'),
  })
  return query.get('screen') === 'print'
    ? <TuPrintPagedDocument {...snapshot.report} />
    : <TuPublicReportSnapshotView snapshot={snapshot} shareEndpoint={null} shareUrl={null} pdfDownloadUrl={null} />
}
createRoot(document.getElementById('root')!).render(<AppToastProvider>
  {['print', 'digital'].includes(query.get('screen') ?? '') ? <Report /> : query.get('screen') === 'customer' ? <InvestigationCustomer /> : query.get('screen') === 'accept' ? <AcceptPage /> : query.get('screen') === 'edit' ? <Edit /> :
    <TuDashboardClient organizationId={tuPreviewOrg} organizationName="Testbolaget"
      initialAssignments={[]} initialInvestigations={[]} initialReportTemplates={TU_STANDARD_REPORT_TEMPLATES}
      inspectorProfile={null} initialError={null} initialCopySource={{ ...tuCopyDemo, customerType: kind,
        tuCustomer: customer, customerIdentityNumber: customer.identityNumber, customerBinding: null }} />}
</AppToastProvider>)
