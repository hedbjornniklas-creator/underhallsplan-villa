/* eslint-disable @next/next/no-html-link-for-pages -- standalone fixture exercises the normal-link navigation guard */
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import TuAssignmentScheduleEditor from '../../src/components/tu/TuAssignmentScheduleEditor'
import { AppToastProvider } from '../../src/components/ui/AppToastProvider'
import { TU_SCHEDULE_ERRORS, type TuAssignmentSchedule } from '../../src/lib/tu/assignmentSchedule'

const requestedMode = new URLSearchParams(location.search).get('state')
const mode = requestedMode === 'draft' || requestedMode === 'ordered' ? requestedMode : 'sent'
let record: TuAssignmentSchedule = {
  id: '22222222-2222-4222-8222-222222222222', org_id: '11111111-1111-4111-8111-111111111111',
  status: mode, accepted_at: mode === 'ordered' ? '2026-10-15T06:00:00Z' : null, archived_at: null,
  updated_at: '2026-10-15T06:00:00.000Z', preferred_date: '2026-10-12', preferred_time: '09:30:00',
  customer_email: 'kund-med-lang-epostadress@example.test',
}
let slow = false, failSave = false, failMail = false, saves = 0, mails = 0, sequence = 0
const version = () => new Date(Date.UTC(2026, 9, 15, 6, 0, ++sequence)).toISOString()
const initial = { ...record }
const updateReceipt = () => { document.getElementById('test-receipt')!.textContent = `Sparningar: ${saves}. Mejlförsök: ${mails}. Sparad tid: ${record.preferred_date} ${record.preferred_time}.` }
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.href)
  if (!url.pathname.startsWith(`/api/tu/assignments/${record.id}`) || url.searchParams.get('orgId') !== record.org_id) throw new Error('Unexpected preview request')
  if (!init?.method || init.method === 'GET') return Response.json({ assignment: { ...record } })
  const body = JSON.parse(String(init.body))
  if (slow) await new Promise(resolve => setTimeout(resolve, 1800))
  if (record.status === 'ordered') return Response.json({ error: TU_SCHEDULE_ERRORS.TU_SCHEDULE_LOCKED.message }, { status: 409 })
  if (body.expectedUpdatedAt !== record.updated_at) return Response.json({ error: TU_SCHEDULE_ERRORS.TU_SCHEDULE_CONFLICT.message }, { status: 409 })
  if (init.method === 'PATCH') {
    if (failSave) return Response.json({ error: 'Kunde inte spara datum och tid. Försök igen.' }, { status: 503 })
    record = { ...record, preferred_date: body.preferredDate, preferred_time: body.preferredTime || null, updated_at: version() }
    saves++
    updateReceipt()
    return Response.json({ assignment: { ...record } })
  }
  if (init.method === 'POST') {
    mails++
    updateReceipt()
    if (failMail) return Response.json({ error: 'Kunde inte skicka meddelandet. Datum och tid är fortfarande sparade. Försök igen.' }, { status: 500 })
    return Response.json({ recipient: record.customer_email, updatedAt: record.updated_at })
  }
  throw new Error('Unexpected method')
}

function Preview() {
  const [assignment, setAssignment] = useState(initial)
  return <AppToastProvider><main className="mx-auto max-w-4xl space-y-5 p-4 md:p-8">
    <p className="text-sm text-slate-600">Lokal testvy. Inga riktiga uppgifter ändras och inga mejl skickas.</p>
    <header className="flex flex-wrap items-center justify-between gap-4"><h1 className="text-2xl font-semibold">Uppdragsbekräftelse</h1><span>{mode === 'draft' ? 'Utkast' : mode === 'ordered' ? 'Godkänd' : 'Skickad'}</span></header>
    <section className="border-y border-slate-200 bg-white p-4 sm:p-6">
      <h2 className="mb-4 text-lg font-semibold">Tid och pris</h2>
      <TuAssignmentScheduleEditor assignment={assignment} onSaved={setAssignment} />
      <p className="mt-4 border-t border-slate-200 pt-4 text-sm">Pris: 4 900 SEK inklusive moms</p>
    </section>
    <a href="/?left=1" className="block underline">Tillbaka till listan (test)</a>
    <aside className="space-y-3 border-t border-slate-300 pt-4 text-sm">
      <h2 className="font-semibold">Testkontroller</h2>
      <label className="block"><input type="checkbox" onChange={e => { slow = e.target.checked }} /> Långsam sparning</label>
      <label className="block"><input type="checkbox" onChange={e => { failSave = e.target.checked }} /> Simulera sparfel</label>
      <label className="block"><input type="checkbox" onChange={e => { failMail = e.target.checked }} /> Simulera mejlfel</label>
      <button className="min-h-11 border px-3" onClick={() => { record.updated_at = version() }}>Ändra i annan flik</button>
      <button className="ml-2 min-h-11 border px-3" onClick={() => { record = { ...record, status: 'ordered', accepted_at: version(), updated_at: version() } }}>Godkänn i annan flik</button>
      <output id="test-receipt" className="block break-words">Inga sparningar eller mejl.</output>
    </aside>
  </main></AppToastProvider>
}
createRoot(document.getElementById('root')!).render(<Preview />)
