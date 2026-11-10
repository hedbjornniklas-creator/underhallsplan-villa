import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import TaskDetailSheet from '../../src/components/tasks/TaskDetailSheet'
import UppdragScope from '../../src/components/tasks/UppdragScope'
import type { TaskView, TaskWorkspace } from '../../src/lib/tasks/contracts'

const initial: TaskView = {
  id: 'fictitious-task', rootTaskId: 'fictitious-task', parentTaskId: null, depth: 0,
  title: 'Fiktivt uppdrag - kontrollera leveransen', description: 'Endast fiktiva uppgifter. Ingen databas eller e-post används.\n'.repeat(12), contextLabel: 'Testprojekt',
  taskKind: 'simple', status: 'assigned', risk: 'green', ballHolder: 'issuer', dueAt: '2027-01-15T15:00:00Z', dueTimeZone: 'Europe/Stockholm', nextFollowupAt: '2027-01-14T09:00:00Z',
  recurrenceInterval: null, recurrenceSequence: null, primaryChannel: 'email', fallbackChannel: null, evidenceRequirement: 'optional', evidenceRequirements: [], initialDispatchPending: false,
  issuerId: 'issuer', issuerName: 'Anna Exempel', canDelete: true, canCompleteManually: true, completionMethod: null,
  assignee: { id: 'recipient', kind: 'profile', name: 'Bo Exempel', companyName: null, email: 'bo@example.test', phone: null, whatsappNumber: null, isActive: true },
  reviewRound: 1, version: 7, childCount: 0, openChildCount: 0, requirements: [], events: [], deadlineRequests: [], attachments: [],
  aiSuggestions: [{ id: 'old-suggestion', type: 'create_subtask', title: 'Gammalt AI-förslag', description: 'Ska inte visas eller användas.', rationale: null, status: 'pending', createdAt: '2026-11-10T08:00:00Z' }],
  unreadMessageCount: 0, latestMessage: null, latestIncomingMessageEventId: null, notificationDeliveries: [], notificationDeliveryProblemCount: 0,
  createdAt: '2026-11-10T08:00:00Z', updatedAt: '2026-11-10T08:00:00Z',
}
const fixture: { select: (name: string) => void; calls: { action: string; payload: Record<string, unknown> }[] } = { select: () => {}, calls: [] }
Object.assign(window, { fixture })

function Fixture() {
  const [task, setTask] = useState(initial), [scenario, setScenario] = useState('normal'), [epoch, setEpoch] = useState(0), [open, setOpen] = useState(true)
  useEffect(() => {
    fixture.select = name => {
      fixture.calls.length = 0; setScenario(name); setEpoch(value => value + 1); setOpen(true)
      setTask({ ...initial, status: name === 'approved' ? 'approved' : name === 'cancelled' ? 'cancelled' : 'assigned',
        assignee: name === 'self' ? { ...initial.assignee, id: 'issuer', name: 'Anna Exempel' } : initial.assignee,
        canDelete: name !== 'no-delete' && name !== 'recipient', childCount: name === 'children' ? 1 : 0, openChildCount: name === 'children' ? 1 : 0 })
    }
  }, [])
  const userId = scenario === 'recipient' ? 'recipient' : 'issuer'
  const workspace = { timeZone: 'Europe/Stockholm', currentUser: { id: userId, name: 'Testanvändare', isOrgAdmin: false }, tasks: [task], people: [],
    limits: { maxDepth: 2, maxOpenChildren: 5, maxActiveDescendants: 15 } } as unknown as TaskWorkspace
  return <UppdragScope><main data-scenario={scenario} className="min-h-screen bg-white p-5 text-slate-950"><h1>Fiktivt test: uppgiftsåtgärder</h1><p>Inga riktiga uppgifter eller utskick.</p>
    <button onClick={() => setOpen(true)}>Öppna uppgiften</button>
    {open && <TaskDetailSheet key={epoch} task={task} workspace={workspace} busy={scenario === 'busy'} onClose={() => setOpen(false)}
      onUpload={async () => {}} onUpdateTranscript={async () => {}} onSelectTask={() => {}}
      onCreateSubtask={() => fixture.calls.push({ action: 'create_subtask', payload: { taskId: task.id } })}
      onAction={async (action, payload) => {
        fixture.calls.push({ action, payload })
        if (action === 'archive_task') { if (scenario === 'error' && fixture.calls.length === 1) throw Error('Fiktivt raderingsfel. Försök igen.'); setOpen(false) }
        else if (action === 'complete_manually') setTask(previous => ({ ...previous, status: 'approved', completionMethod: 'manual', version: previous.version + 1 }))
        else if (action === 'transition') setTask(previous => ({ ...previous, status: payload.status as TaskView['status'], version: previous.version + 1 }))
      }} />}
  </main></UppdragScope>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
