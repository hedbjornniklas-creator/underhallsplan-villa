import React from 'react'
import { createRoot } from 'react-dom/client'
import TaskDashboardClient from '../../src/components/tasks/TaskDashboardClient'
import { AppToastProvider } from '../../src/components/ui/AppToastProvider'
import type { TaskPerson, TaskView, TaskWorkspace } from '../../src/lib/tasks/contracts'

const people: TaskPerson[] = ['self', 'other'].map((id, i) => ({ id, kind: 'profile', name: i ? 'Bo Exempel' : 'Anna Exempel', email: `${id}@example.test`, phone: null, companyName: null, whatsappNumber: null, isActive: true }))
const make = (id: string, title: string, estimatedMinutes: number | null, patch: Partial<TaskView> = {}): TaskView => ({
  id, rootTaskId: id, parentTaskId: null, depth: 0, title, estimatedMinutes, estimateVersion: estimatedMinutes === null ? 0 : 1, canEditEstimate: true,
  description: 'Fiktiv uppgift för granskning av tidsuppskattning.', contextLabel: null, taskKind: 'simple', status: 'assigned', risk: 'green', ballHolder: 'assignee',
  dueAt: null, dueTimeZone: 'Europe/Stockholm', nextFollowupAt: null, recurrenceInterval: null, recurrenceSequence: null, primaryChannel: 'email', fallbackChannel: null,
  evidenceRequirement: 'optional', evidenceRequirements: [], initialDispatchPending: false, issuerId: 'self', issuerName: people[0].name,
  canDelete: true, canCompleteManually: true, assignee: people[0], reviewRound: 1, version: 1, childCount: 0, openChildCount: 0,
  requirements: [], events: [], deadlineRequests: [], attachments: [], aiSuggestions: [], unreadMessageCount: 0, latestMessage: null, latestIncomingMessageEventId: null,
  notificationDeliveries: [], notificationDeliveryProblemCount: 0, createdAt: '2026-10-30T08:00:00Z', updatedAt: '2026-10-30T08:00:00Z', ...patch,
})
const initialTasks = [
  make('scb', 'Kontrollera meddelande från SCB', 5), make('book', 'Boka ett besök', 10), make('supplier', 'Ring leverantören', 15),
  make('proposal', 'Skriv kostnadsförslag', 30), make('other', 'Inväntar Bo', 5, { assignee: people[1] }),
  make('waiting', 'Väntar på leverans', 5, { status: 'waiting' }), make('closed', 'Redan klart', 5, { status: 'cancelled', ballHolder: 'nobody', canEditEstimate: false }),
  make('unknown', 'Undersök underlaget', null), make('root', 'Större ärende', 120, { childCount: 1, openChildCount: 1 }),
  make('child', 'Kontrollera en detalj', 5, { rootTaskId: 'root', parentTaskId: 'root', depth: 1 }),
]
const storageKey = `test:task-estimates:${new URLSearchParams(location.search).get('suite') ?? 'default'}`
let tasks: TaskView[] = JSON.parse(localStorage.getItem(storageKey) ?? 'null') ?? initialTasks
const workspace = (): TaskWorkspace => ({
  timeEstimatesAvailable: true, timeZone: 'Europe/Stockholm', currentUser: { id: 'self', name: people[0].name, isOrgAdmin: false }, tasks, people,
  summary: { totalActive: tasks.length - 1, userHasBall: tasks.length - 2, awaitingReview: 0, overdue: 0, green: tasks.length, yellow: 0, red: 0, unreadMessages: 0 },
  analytics: { asOf: '2026-10-30T08:00:00Z', defaultPeriod: '90d' } as TaskWorkspace['analytics'],
  limits: { maxDepth: 2, maxOpenChildren: 5, maxActiveDescendants: 15 },
})
let failNext = false
window.fetch = async (url, options) => {
  if (String(url) !== '/api/tasks') return new Response(JSON.stringify({ error: 'Testet tillåter endast Uppgifter.' }), { status: 400 })
  if (!options?.method || options.method === 'GET') return Response.json({ workspace: workspace() })
  const body = JSON.parse(String(options.body))
  const payload = body.payload ?? {}
  let createdTaskId: string | undefined
  if (failNext) { failNext = false; return Response.json({ error: 'Fiktivt sparfel. Din tid är inte sparad.' }, { status: 503 }) }
  if (body.action === 'set_time_estimate') {
    const t = tasks.find(item => item.id === payload.taskId)!
    if (payload.estimateVersion !== t.estimateVersion || payload.version !== t.version) return Response.json({ error: 'Tidsuppskattningen har ändrats i en annan flik. Din ändring är kvar.' }, { status: 409 })
    tasks = tasks.map(item => item.id === t.id ? { ...item, estimatedMinutes: payload.estimatedMinutes, estimateVersion: (item.estimateVersion ?? 0) + 1 } : item)
  } else if (body.action === 'create_task') {
    createdTaskId = crypto.randomUUID()
    tasks = [...tasks, make(createdTaskId, payload.title, payload.estimatedMinutes ?? null)]
  } else return Response.json({ error: 'Åtgärden är inte aktiv i testet.' }, { status: 400 })
  localStorage.setItem(storageKey, JSON.stringify(tasks))
  return Response.json({ workspace: workspace(), notice: 'Tidsuppskattning sparad.', createdTaskId })
}

function Fixture() {
  return <AppToastProvider><div className="uppdrag-scope"><details className="border-b p-2 text-xs"><summary>Fiktivt test, inga utskick</summary>
    <button aria-label="Nästa sparning misslyckas" onClick={() => { failNext = true }}>Nästa sparning misslyckas</button>
    <button aria-label="Ändra SCB i annan flik" onClick={() => { tasks = tasks.map(item => item.id === 'scb' ? { ...item, estimatedMinutes: 7, estimateVersion: (item.estimateVersion ?? 0) + 1 } : item); localStorage.setItem(storageKey, JSON.stringify(tasks)) }}>Ändra SCB i annan flik</button>
  </details></div><TaskDashboardClient initialWorkspace={workspace()} initialError={null} initialActionCases={null} initialActionCasesError={null} initialView="current" /></AppToastProvider>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
