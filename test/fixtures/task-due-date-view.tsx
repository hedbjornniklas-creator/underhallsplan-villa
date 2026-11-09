import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import TaskDetailSheet from '../../src/components/tasks/TaskDetailSheet'
import type { TaskView, TaskWorkspace } from '../../src/lib/tasks/contracts'

const key = 'fixture:personal-due-date'
const initial: TaskView = {
  id: 'personal', rootTaskId: 'personal', parentTaskId: null, depth: 0, title: 'Kontrollera ett meddelande',
  description: 'Fiktiv egen att-göra-uppgift.', contextLabel: null, taskKind: 'simple', status: 'assigned', risk: 'green', ballHolder: 'assignee',
  dueAt: null, dueTimeZone: 'Europe/Stockholm', nextFollowupAt: null, recurrenceInterval: null, recurrenceSequence: null, primaryChannel: 'email', fallbackChannel: null,
  evidenceRequirement: 'optional', evidenceRequirements: [], initialDispatchPending: false, issuerId: 'self', issuerName: 'Anna Exempel',
  canDelete: false, canCompleteManually: false, canEditDueDate: true, canRemoveDueDate: true, followupActive: false,
  assignee: { id: 'self', kind: 'profile', name: 'Anna Exempel', email: 'self@example.test', phone: null, whatsappNumber: null, companyName: null, isActive: true },
  reviewRound: 1, version: 1, childCount: 0, openChildCount: 0, requirements: [], events: [], deadlineRequests: [], attachments: [], aiSuggestions: [], unreadMessageCount: 0,
  latestMessage: null, latestIncomingMessageEventId: null, notificationDeliveries: [], notificationDeliveryProblemCount: 0, createdAt: '2026-11-09T08:00:00Z', updatedAt: '2026-11-09T08:00:00Z',
}
let stored: TaskView = JSON.parse(localStorage.getItem(key) ?? 'null') ?? initial
let failNext = false
const calls: unknown[] = []
Object.assign(window, { fixture: {
  fail() { failNext = true },
  conflict() { stored = { ...stored, version: stored.version + 1 }; localStorage.setItem(key, JSON.stringify(stored)) },
  data() { return stored }, calls,
} })
function Fixture() {
  const [task, setTask] = useState(stored), [open, setOpen] = useState(true), [busy, setBusy] = useState(false)
  const workspace = { timeZone: 'Europe/Stockholm', currentUser: { id: 'self', name: 'Anna Exempel', isOrgAdmin: false }, tasks: [task], people: [task.assignee],
    limits: { maxDepth: 2, maxOpenChildren: 5, maxActiveDescendants: 15 } } as TaskWorkspace
  return <main className="uppdrag-scope"><h1>Fiktivt test av uppgiftsdatum</h1><button onClick={() => setOpen(true)}>Öppna uppgiften</button>
    {open && <TaskDetailSheet task={task} workspace={workspace} busy={busy} onClose={() => setOpen(false)}
      onUpload={async () => {}} onUpdateTranscript={async () => {}} onCreateSubtask={() => {}} onSelectTask={() => {}}
      onReload={async () => { setTask(stored) }}
      onAction={async (action, payload) => {
        if (action !== 'set_personal_due_date') return
        setBusy(true)
        try {
          await new Promise(resolve => setTimeout(resolve, 100))
          if (failNext) { failNext = false; throw Error('Fiktivt sparfel. Försök igen.') }
          if (payload.version !== stored.version) throw Error('Uppgiften ändrades i en annan flik. Hämta sparad uppgift.')
          calls.push({ action, payload })
          const dueAt = payload.dueAt as string | null
          stored = { ...stored, dueAt, nextFollowupAt: dueAt, version: stored.version + 1,
            events: [...stored.events, { id: crypto.randomUUID(), type: 'due_date_changed', actorName: 'Anna Exempel', message: `Sluttiden ändrades till ${dueAt ?? 'utan datum'}.`, fromStatus: null, toStatus: null, createdAt: new Date().toISOString(), authorSide: 'self' }] }
          localStorage.setItem(key, JSON.stringify(stored)); setTask(stored)
        } finally { setBusy(false) }
      }} />}
  </main>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
