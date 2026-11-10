import { createRoot } from 'react-dom/client'
import TaskRecipientClient from '../../src/components/tasks/TaskRecipientClient'
import { AppToastProvider } from '../../src/components/ui/AppToastProvider'
import type { ExternalTaskWorkspace } from '../../src/lib/tasks/external'

const query = new URLSearchParams(location.search), scenario = query.get('scenario') ?? 'assigned'
const second = query.get('recipient') === 'second'
const initial: ExternalTaskWorkspace = {
  accessState: scenario === 'expired' ? 'expired' : 'open', timeZone: 'Europe/Stockholm',
  recipientName: second ? 'Cia Exempel' : 'Bo Exempel', draftScope: (second ? 'b' : 'a').repeat(64),
  recipientAccount: { state: 'unavailable', emailHint: '' }, canDelegate: false,
  task: { id: 'fictional-task', title: 'Kontrollera leveransen av innerdörrar', contextLabel: 'Fiktivt testprojekt',
    description: 'Kontrollera antal och eventuella transportskador. Återkom med en kort status. Endast fiktiva testuppgifter.',
    status: scenario === 'approved' ? 'approved' : scenario === 'cancelled' ? 'cancelled' : scenario === 'in_progress' ? 'in_progress' : 'assigned',
    dueAt: ['approved', 'cancelled'].includes(scenario) ? '2026-11-05T15:00:00Z' : '2027-01-15T15:00:00Z', dueTimeZone: 'Europe/Stockholm',
    nextFollowupAt: '2027-01-14T08:00:00Z', createdAt: '2026-11-01T08:00:00Z', evidenceRequirement: 'optional', evidenceRequirements: [],
    issuerName: 'Anna Exempel', assigneeName: second ? 'Cia Exempel' : 'Bo Exempel',
    requirements: scenario === 'blocked' ? [{ id: 'r', key: 'written_quote', label: 'Skriftlig offert', status: 'pending' }] : [],
    events: ['approved', 'cancelled'].includes(scenario) ? [{ id: 'complete', type: 'status_changed', toStatus: scenario === 'approved' ? 'approved' : 'cancelled', fromStatus: 'in_progress', actorName: 'Anna Exempel', createdAt: '2026-11-04T10:00:00Z', message: null, authorSide: 'other' }] : [],
    deadlineRequests: [], attachments: [], unreadMessageCount: 0, latestMessage: null, latestIncomingMessageEventId: null, version: 1,
  }, children: [],
}
let state = structuredClone(initial), fail = scenario === 'error'
window.fetch = async (input, init) => {
  if (!String(input).startsWith('/fixture-api')) return Response.json({ error: 'Externa anrop är blockerade i testet.' }, { status: 400 })
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : { action: 'attachment' }
  if (fail) { fail = false; return Response.json({ error: 'Fiktivt sparfel. Försök igen.' }, { status: 503 }) }
  if (body.action === 'comment') state.task.events.push({ id: crypto.randomUUID(), type: 'comment', actorName: initial.recipientName, authorSide: 'self', message: body.payload.message, createdAt: new Date().toISOString(), fromStatus: null, toStatus: null })
  if (body.action === 'start') state.task.status = 'in_progress'
  if (body.action === 'ready_for_review') state.task.status = 'ready_for_review'
  if (body.action === 'waiting') state.task.status = 'waiting'
  if (body.action === 'attachment' && init?.body instanceof FormData) state.task.attachments.push({ id: crypto.randomUUID(), type: 'text', title: 'Textunderlag', fileName: null, textContent: String(init.body.get('text') ?? ''), transcriptText: null, canEditTranscript: false, isCompletionEvidence: false, createdAt: new Date().toISOString() })
  state = { ...state, task: { ...state.task, version: state.task.version + 1 } }
  return Response.json({ workspace: structuredClone(state) })
}
createRoot(document.getElementById('root')!).render(<AppToastProvider><TaskRecipientClient initialWorkspace={initial} endpoint="/fixture-api" /></AppToastProvider>)
