import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import TaskDetailSheet from '../../src/components/tasks/TaskDetailSheet'
import type { TaskPerson, TaskView, TaskWorkspace } from '../../src/lib/tasks/contracts'

const people: TaskPerson[] = [
  { id: '11111111-1111-4111-8111-111111111111', kind: 'profile', name: 'Anna Exempel', email: 'anna@example.test', companyName: null, phone: null, whatsappNumber: null, isActive: true },
  { id: '22222222-2222-4222-8222-222222222222', kind: 'profile', name: 'Bo Exempel', email: 'bo@example.test', companyName: null, phone: null, whatsappNumber: null, isActive: true },
  { id: '33333333-3333-4333-8333-333333333333', kind: 'contact', name: 'Cia Exempel', email: 'cia@example.test', companyName: 'Exempelfirman', phone: null, whatsappNumber: null, isActive: true },
]
const original: TaskView = {
  id: '44444444-4444-4444-8444-444444444444', rootTaskId: '44444444-4444-4444-8444-444444444444', parentTaskId: null, depth: 0,
  title: 'Kontrollera leveransen', description: 'Fiktiv uppgift. Inga mejl skickas.', contextLabel: 'Testprojekt', taskKind: 'simple',
  status: 'in_progress', risk: 'green', ballHolder: 'assignee', issuerId: people[0].id, issuerName: people[0].name, assignee: people[1],
  canEditDetails: true, canEditEstimate: false, canEditDueDate: false, canDelete: true, canCompleteManually: true,
  dueAt: '2027-01-15T15:00:42.000Z', dueTimeZone: 'Europe/Stockholm', nextFollowupAt: '2027-01-14T08:00:42.000Z',
  primaryChannel: 'email', fallbackChannel: null, estimatedMinutes: 15, estimateVersion: 1, recurrenceInterval: null, recurrenceSequence: null,
  evidenceRequirement: 'optional', evidenceRequirements: [], requirements: [], reviewRound: 1, initialDispatchPending: false,
  version: 1, childCount: 0, openChildCount: 0, events: [], deadlineRequests: [], attachments: [], aiSuggestions: [],
  unreadMessageCount: 0, latestMessage: null, latestIncomingMessageEventId: null, notificationDeliveries: [], notificationDeliveryProblemCount: 0,
  createdAt: '2026-11-10T08:00:00Z', updatedAt: '2026-11-10T08:00:00Z',
}
const key = `test:task-details:${new URLSearchParams(location.search).get('suite') ?? 'default'}`
function Fixture() {
  const [task, setTask] = useState<TaskView>(() => JSON.parse(localStorage.getItem(key) ?? 'null') ?? original)
  const [open, setOpen] = useState(true), [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [sends, setSends] = useState(0)
  const [fail, setFail] = useState(new URLSearchParams(location.search).get('scenario') === 'error')
  const workspace: TaskWorkspace = {
    currentUser: { id: people[0].id, name: people[0].name, isOrgAdmin: false }, timeZone: 'Europe/Stockholm', timeEstimatesAvailable: false,
    tasks: [task], people, summary: { totalActive: 1, userHasBall: 0, awaitingReview: 0, overdue: 0, green: 1, yellow: 0, red: 0, unreadMessages: 0 },
    analytics: { asOf: '2026-11-10', defaultPeriod: '90d' } as TaskWorkspace['analytics'], limits: { maxDepth: 2, maxOpenChildren: 5, maxActiveDescendants: 15 },
  }
  const action = async (name: string, payload: Record<string, unknown>) => {
    if (name === 'mark_messages_read') return
    setBusy(true)
    try {
      await new Promise(resolve => setTimeout(resolve, 100))
      if (name === 'edit_task_details') {
        if (fail) { setFail(false); throw Error('Fiktivt sparfel. Dina ändringar är kvar.') }
        if (payload.version !== task.version) throw Error('Uppgiften har ändrats. Ladda om innan du sparar.')
        const assignee = people.find(p => `${p.kind}:${p.id}` === payload.assigneeRef)!
        const changed = assignee.id !== task.assignee.id
        const updated = { ...task, title: String(payload.title), description: String(payload.description), contextLabel: String(payload.contextLabel),
          assignee, dueAt: payload.dueAt as string | null, nextFollowupAt: payload.nextFollowupAt as string | null,
          primaryChannel: payload.primaryChannel as TaskView['primaryChannel'], fallbackChannel: payload.fallbackChannel as TaskView['fallbackChannel'],
          initialDispatchPending: changed || task.initialDispatchPending, version: task.version + 1 }
        setTask(updated); localStorage.setItem(key, JSON.stringify(updated)); setNotice(`Sparat. Status: ${updated.status}. Skickade mejl: ${sends}.`)
      } else if (name === 'issue_access_link' || name === 'dispatch_assignment') {
        setSends(sends + 1); const updated = { ...task, initialDispatchPending: false }; setTask(updated); localStorage.setItem(key, JSON.stringify(updated)); setNotice('Fiktivt utskick efter separat klick.')
      } else throw Error('Denna åtgärd ingår inte i testet.')
    } finally { setBusy(false) }
  }
  return <div className="uppdrag-scope p-4"><p>Fiktivt redigeringstest. Inga utskick.</p><p role="status">{notice}</p><button onClick={() => setOpen(true)}>Öppna uppgift</button>
    <TaskDetailSheet task={open ? task : null} workspace={workspace} busy={busy} onClose={() => setOpen(false)} onAction={action}
      onUpload={async () => {}} onUpdateTranscript={async () => {}} onCreateSubtask={() => {}} onSelectTask={() => {}} />
  </div>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
