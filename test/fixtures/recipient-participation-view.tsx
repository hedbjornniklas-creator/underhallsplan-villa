import { createRoot } from 'react-dom/client'
import RecipientPortalOverviewClient from '@/components/tasks/RecipientPortalOverviewClient'
import QuestionDialogue from '@/components/tasks/QuestionDialogue'
import UppdragBrand from '@/components/tasks/UppdragBrand'
import { buildTaskAnalyticsScope } from '@/lib/tasks/analytics'
import type { QuestionDialogue as Dialogue } from '@/lib/action-cases/questionDialogue'

const manager = location.pathname === '/manager', overview = location.pathname === '/'
const asOf = '2026-11-18T12:00:00Z'
const state: Dialogue = {
  questionId: '00000000-0000-4000-8000-000000000012', version: 4, sharedAt: '2026-11-01T08:00:00Z', status: 'open',
  snapshot: { title: 'Ta in pris for tre AC-enheter', description: 'Fiktiv projektfraga. Kontrollera alternativen och aterkom med ett pris.' },
  managerId: 'manager', canManage: manager, viewerId: manager ? 'manager' : 'late',
  participants: [
    { id: 'manager', kind: 'profile', personId: 'manager', name: 'Anna Exempel', email: manager ? 'anna@example.invalid' : null, shared: true },
    { id: 'old', kind: 'contact', personId: 'old', name: 'Bo Exempel', email: manager ? 'bo@example.invalid' : null, shared: true },
    { id: 'late', kind: 'contact', personId: 'late', name: 'Cia Exempel', email: manager ? 'cia@example.invalid' : null, shared: true },
  ], deliveries: [], messages: [
    { id: 'old-message', participantId: 'old', actorName: 'Bo Exempel', actorMethod: 'personal_link', operation: 'reply', text: 'Tidigare delat svar innan Cia lades till.', snapshot: null, createdAt: '2026-11-02T08:00:00Z', files: [{ id: 'shared-file', name: 'Tidigare delat underlag.pdf' }] },
  ],
}
let failOnce = new URLSearchParams(location.search).has('retry'), attempts = 0
const requests = new Set<string>()
window.fetch = async (input, init) => {
  if (String(input) !== '/fixture-dialogue') throw Error('Only fictional local requests are allowed')
  if (init?.method) {
    const body = JSON.parse(String(init.body))
    attempts++
    if (!requests.has(body.requestId)) {
      if (body.operation === 'reply') state.messages.push({ id: body.requestId, participantId: state.viewerId!, actorName: manager ? 'Anna Exempel' : 'Cia Exempel', actorMethod: 'recipient_login', operation: 'reply', text: body.text, snapshot: null, files: [], createdAt: new Date().toISOString() })
      if (!['resend_link', 'reply'].includes(body.operation)) return Response.json({ error: 'Unsupported fictional operation' }, { status: 400 })
      requests.add(body.requestId); state.version++
    }
    if (failOnce) { failOnce = false; throw Error('Fiktivt natverksavbrott efter sparning') }
    return Response.json({ questionId: state.questionId, messageId: body.requestId })
  }
  return Response.json(structuredClone(state))
}
const app = overview ? <RecipientPortalOverviewClient initialOverview={{
  recipientName: 'Cia Exempel', email: 'cia@example.invalid', tasks: [],
  summary: { active: 0, completed: 0, needsAction: 0, overdue: 0, unreadMessages: 0 },
  analytics: { asOf, defaultPeriod: '90d', self: buildTaskAnalyticsScope({ tasks: [], deadlineRequests: [], asOf }) },
  participations: [
    { id: state.questionId, kind: 'question', title: `F-012 ${state.snapshot!.title}`, contextLabel: 'Fiktivt testprojekt', status: 'open', sharedAt: asOf, href: '/question' },
    { id: 'prior-task', kind: 'task', title: 'Tidigare delat uppdrag', contextLabel: 'Fiktivt testprojekt', status: 'closed', sharedAt: asOf, href: '/question' },
  ],
}} /> : <main className="uppdrag-scope gizmo-question-public"><header><UppdragBrand /><p>Fiktivt deltagartest</p></header><QuestionDialogue initial={state} endpoint="/fixture-dialogue" fileBase="/fixture-files" mode={manager ? 'participants' : 'dialogue'} publicView={!manager} people={state.participants.map(p => ({ id: p.personId, kind: p.kind, name: p.name, email: p.email || '' }))} /></main>
createRoot(document.getElementById('root')!).render(app)
// The visible counters verify that retrying uses one durable request, not two mails.
setInterval(() => { const node = document.getElementById('fixture-counter'); if (node) node.textContent = `Fiktiva anrop: ${attempts}. Unika skrivningar: ${requests.size}.` }, 100)
