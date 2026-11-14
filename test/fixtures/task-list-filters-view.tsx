import React from 'react'
import { createRoot } from 'react-dom/client'
import TaskDashboardClient from '../../src/components/tasks/TaskDashboardClient'
import { AppToastProvider } from '../../src/components/ui/AppToastProvider'
import type { TaskPerson, TaskView, TaskWorkspace } from '../../src/lib/tasks/contracts'

const people: TaskPerson[] = ['anna', 'bo'].map((id, i) => ({ id, kind: 'profile', name: i ? 'Bo Exempel' : 'Anna Exempel',
  email: `${id}@example.invalid`, phone: null, companyName: null, whatsappNumber: null, isActive: true }))
const make = (id: string, title: string, patch: Partial<TaskView> = {}): TaskView => ({
  id, rootTaskId: id, parentTaskId: null, depth: 0, title, estimatedMinutes: 15, estimateVersion: 1,
  description: null, contextLabel: 'Östra skolan', taskKind: 'simple', status: 'assigned', risk: 'green', ballHolder: 'assignee',
  dueAt: '2026-12-01T12:00:00Z', dueTimeZone: 'Europe/Stockholm', nextFollowupAt: null, recurrenceInterval: null, recurrenceSequence: null,
  primaryChannel: 'email', fallbackChannel: null, evidenceRequirement: 'optional', evidenceRequirements: [], initialDispatchPending: false,
  issuerId: people[0].id, issuerName: people[0].name, canDelete: false, assignee: people[0], reviewRound: 1, version: 1,
  childCount: 0, openChildCount: 0, requirements: [], events: [], deadlineRequests: [], attachments: [], aiSuggestions: [],
  unreadMessageCount: 0, latestMessage: null, latestIncomingMessageEventId: null, notificationDeliveries: [], notificationDeliveryProblemCount: 0,
  createdAt: '2026-11-01T08:00:00Z', updatedAt: '2026-11-02T08:00:00Z', ...patch,
})
const tasks: TaskView[] = [
  make('root', 'Samordna renoveringen', { childCount: 3, openChildCount: 3 }),
  make('bo-window', 'Kontrollera fönster', { rootTaskId: 'root', parentTaskId: 'root', depth: 1, assignee: people[1], status: 'in_progress' }),
  make('bo-delivery', 'Invänta leveransen', { rootTaskId: 'root', parentTaskId: 'root', depth: 1, assignee: people[1], status: 'waiting' }),
  make('anna-review', 'Kontrollera färgsättningen', { rootTaskId: 'root', parentTaskId: 'root', depth: 1, status: 'ready_for_review', ballHolder: 'issuer' }),
  make('bo-single', 'Besök Björkvägen', { contextLabel: 'Björkvägen 4', assignee: people[1], issuerId: 'bo', issuerName: people[1].name }),
  make('ball-anna', 'Godkänn provet', { contextLabel: 'Björkvägen 4', assignee: people[1], ballHolder: 'issuer' }),
  make('personal', 'Ring leverantören', { contextLabel: null, dueAt: null, estimatedMinutes: 5 }),
  make('closed', 'Avslutat ärende', { contextLabel: null, status: 'approved', ballHolder: 'nobody' }),
  ...Array.from({length: 12}, (_, index) => make(`other-${index}`, `Underlag ${index + 1}`, { contextLabel: 'Björkvägen 4', estimatedMinutes: null })),
]
const workspace: TaskWorkspace = {
  timeEstimatesAvailable: true, timeZone: 'Europe/Stockholm', currentUser: { id: 'anna', name: people[0].name, isOrgAdmin: false }, tasks, people,
  summary: { totalActive: tasks.length - 1, userHasBall: tasks.length - 4, awaitingReview: 1, overdue: 0, green: tasks.length, yellow: 0, red: 0, unreadMessages: 0 },
  analytics: { asOf: '2026-11-14T08:00:00Z', defaultPeriod: '90d' } as TaskWorkspace['analytics'],
  limits: { maxDepth: 2, maxOpenChildren: 5, maxActiveDescendants: 15 },
}
const checks = { writes: [] as unknown[], tasks }
;(window as typeof window & { __taskFilterTest: typeof checks }).__taskFilterTest = checks
window.fetch = async (_url, options) => {
  if (options?.method && options.method !== 'GET') {
    checks.writes.push(options.body)
    return Response.json({ error: 'Inga skrivningar eller utskick i denna förhandsvisning.' }, { status: 400 })
  }
  return Response.json({ workspace })
}
createRoot(document.getElementById('root')!).render(<AppToastProvider><TaskDashboardClient initialWorkspace={workspace}
  initialError={null} initialActionCases={null} initialActionCasesError={null} initialView="current" /></AppToastProvider>)
