import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import DetailPage from '../../src/app/(dashboard)/tu/assignments/[id]/page'
import ListPage from '../../src/app/(dashboard)/tu/assignments/page'
import { AppToastProvider } from '../../src/components/ui/AppToastProvider'
import { tuAssignment } from './tu-overview-data'
import type { AssignmentDetails, AssignmentStatus } from '../../src/lib/assignments/server'
import type { TuAssignmentProgress, TuAssignmentMessage } from '../../src/lib/tu/assignmentProgress'
import { parseTuAssignmentEdit } from '../../src/lib/tu/assignmentEditing'

const mode = new URLSearchParams(location.search).get('state') || 'sent'
const listView = new URLSearchParams(location.search).get('view') === 'list'
let sequence = 0
const version = () => new Date(Date.UTC(2026, 9, 15, 8, 0, ++sequence)).toISOString()
let record: AssignmentDetails & { progress?: TuAssignmentProgress } = {
  ...tuAssignment({ status: mode as AssignmentStatus, last_sent_at: mode === 'draft' ? null : '2026-10-14T08:00:00Z' }),
  customer_name: 'Anna Andersson', customer_email: 'anna.med.en.lang.epostadress@example.test',
  scope_description: 'Undersökning av missfärgning på vinden. Dokumentation av åtkomliga delar och tekniskt utlåtande.',
  property_address: 'Långgatan 18 B', property_municipality: 'Stockholm', property_owner_name: null,
  customer_address: 'Långgatan 18 B', property_id: null, terms_version: 'v1', terms_document_hash: 'hash',
  orderer_role: null, invoice_email: null, invoice_name: null, invoice_address: null, personal_identity_number: null,
  notes_internal: 'Ring vid ankomst.', currency: 'SEK', price_amount: 4900, assignment_details: { customerType: 'consumer' },
  booked_at: mode === 'booked' ? version() : null, archived_at: mode === 'cancelled' ? version() : null,
}
if (mode === 'expired') record.progress = { available: true, approvalVerified: false, linkState: 'expired', linkExpiresAt: '2026-10-01T08:00:00Z' }
let messages: TuAssignmentMessage[] = mode === 'draft' ? [] : [{ id: 'msg-1', created_at: '2026-10-14T08:00:00Z', sent_at: '2026-10-14T08:00:00Z', recipient_email: record.customer_email, template_key: 'assignment_confirmation', status: 'sent' }]
let fail = false, slow = false, actions = 0
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.href)
  if (url.pathname === '/api/tu/assignments') return Response.json({ items: [record], org: { id: record.org_id, name: 'Testbolaget' } })
  if (!url.pathname.startsWith(`/api/tu/assignments/${record.id}`)) throw new Error('Unexpected preview request')
  if (!init?.method || init.method === 'GET') return Response.json({ assignment: record, customerType: 'consumer', currentTerms: { version: 'v1', documentHash: 'hash', text: 'Syntetiska testvillkor', matchesAcceptedVersion: true }, withdrawal: null, linkIssues: { available: true, items: [] }, messages,
    reportTemplates: [{ key: 'moisture', title: 'Fuktskadeutredning' }, { key: 'standard', title: 'Teknisk utredning' }],
  })
  const body = JSON.parse(String(init.body))
  if (slow) await new Promise(resolve => setTimeout(resolve, 1800))
  if (fail) return Response.json({ error: 'Åtgärden kunde inte slutföras. Uppdatera status innan du försöker igen.' }, { status: 503 })
  if (url.pathname.endsWith('/convert')) { actions++; return Response.json({ inspectionId: 'new-investigation' }) }
  if (body.expectedUpdatedAt !== record.updated_at) return Response.json({ error: 'Uppdraget har ändrats. Uppdatera status innan du försöker igen.' }, { status: 409 })
  actions++
  document.getElementById('request-count')!.textContent = String(actions)
  if (url.pathname.endsWith('/schedule') && init.method === 'PATCH') {
    record = { ...record, preferred_date: body.preferredDate, preferred_time: body.preferredTime, updated_at: version() }
    return Response.json({ assignment: record })
  }
  if (init.method === 'PATCH') { const { patch } = parseTuAssignmentEdit(body); record = { ...record, ...patch, updated_at: version() } as typeof record; return Response.json({ assignment: record }) }
  if (body.action === 'reissue') return Response.json({ message: 'Ett nytt utkast har skapats. Inget mejl har skickats.', draftId: 'new-draft' })
  if (body.action === 'send' || body.action === 'receipt' || body.action === 'book') {
    messages = [{ id: `msg-${sequence}`, created_at: version(), sent_at: version(), recipient_email: record.customer_email, template_key: body.action === 'book' ? 'assignment_order_receipt' : body.action === 'receipt' ? 'assignment_accept_notice' : 'assignment_confirmation', status: 'sent' }, ...messages]
    record.last_sent_at = version()
    if (body.action === 'send') record = { ...record, status: 'sent', progress: { available: true, approvalVerified: false, linkState: 'active', linkExpiresAt: '2099-10-20T08:00:00Z' } }
    if (body.action === 'book') record = { ...record, status: 'booked', booked_at: version() }
  } else if (body.action === 'cancel') record = { ...record, status: 'cancelled', archived_at: version() }
  else if (body.action === 'archive') record.archived_at = version()
  else if (body.action === 'restore') record.archived_at = null
  record.updated_at = version()
  return Response.json({ message: 'Åtgärden är klar.' })
}

function Preview() {
  const [key, setKey] = useState(0)
  return <AppToastProvider><aside className="flex flex-wrap items-center gap-4 border-b border-slate-300 bg-white p-3 text-sm">
    <strong>Lokal testvy. Inga kundmejl eller verkliga ändringar.</strong>
    <label><input type="checkbox" onChange={event => { fail = event.target.checked }} /> Simulera fel</label>
    <label><input type="checkbox" onChange={event => { slow = event.target.checked }} /> Långsamt svar</label>
    <button type="button" onClick={() => { record.updated_at = version() }}>Ändra i annan flik</button>
    <button type="button" onClick={() => setKey(value => value + 1)}>Ladda om testvy</button>
    <output>Åtgärder: <span id="request-count">0</span></output><output id="navigation-result" />
  </aside>{listView ? <ListPage key={key} /> : <DetailPage key={key} />}</AppToastProvider>
}
createRoot(document.getElementById('root')!).render(<Preview />)
