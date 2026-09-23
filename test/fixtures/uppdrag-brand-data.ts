import type { TaskAnalyticsScope, TaskView, TaskWorkspace } from '@/lib/tasks/contracts'
import type { ExternalTaskWorkspace } from '@/lib/tasks/external'
import type { RecipientPortalOverview } from '@/lib/tasks/recipientPortal'
import { requestFixture } from './action-case-requests'

const date = '2026-09-16T09:00:00Z'
const delivery = { approvedCount: 0, measuredCount: 0, unknownCount: 0, onTimeCount: 0, lateCount: 0, onTimePercent: null, limitedSample: true, taskIds: { approved: [], onTime: [], late: [], unknown: [] } }
const scope: TaskAnalyticsScope = {
  current: { activeCount: 1, overdueCount: 0, dueWithin7DaysCount: 0, awaitingReviewCount: 0, taskIds: { active: ['brand-task'], overdue: [], dueWithin7Days: [], awaitingReview: [] } },
  deliveryByPeriod: { '30d': delivery, '90d': delivery, '12m': delivery, all: delivery },
}
const assignee = { id: 'brand-person', kind: 'contact' as const, name: 'Anna Exempel', companyName: 'Exempelbygg AB', email: 'anna@example.test', phone: null, whatsappNumber: null, isActive: true }
export const task: TaskView = {
  id: 'brand-task', parentTaskId: null, rootTaskId: 'brand-task', depth: 0,
  title: 'Montera och måla innervägg', description: 'Montera vägg enligt arbetsbeskrivningen. Dokumentera arbetet med bilder.',
  contextLabel: 'Exempelgatan 12', taskKind: 'general', status: 'assigned', risk: 'green', ballHolder: 'assignee',
  dueAt: '2027-01-20T15:00:00Z', dueTimeZone: 'Europe/Stockholm', nextFollowupAt: '2027-01-18T09:00:00Z',
  recurrenceInterval: null, recurrenceSequence: null, primaryChannel: 'email', fallbackChannel: null,
  evidenceRequirement: 'photo', evidenceRequirements: ['photo'], initialDispatchPending: false,
  issuerId: 'brand-issuer', issuerName: 'Testansvarig', canDelete: true, assignee,
  reviewRound: 0, version: 1, childCount: 0, openChildCount: 0, requirements: [], events: [], deadlineRequests: [],
  attachments: [], aiSuggestions: [], unreadMessageCount: 0, latestMessage: null, latestIncomingMessageEventId: null,
  notificationDeliveries: [], notificationDeliveryProblemCount: 0, createdAt: date, updatedAt: date,
}
export const workspace: TaskWorkspace = {
  timeZone: 'Europe/Stockholm', currentUser: { id: 'brand-issuer', name: 'Testansvarig', isOrgAdmin: true },
  tasks: [task], people: [assignee], summary: { totalActive: 1, userHasBall: 0, awaitingReview: 0, overdue: 0, green: 1, yellow: 0, red: 0, unreadMessages: 0 },
  analytics: { asOf: date, defaultPeriod: '90d', self: scope, issuedByMe: { ...scope, assignees: [{ ...scope, assignee }] } },
  limits: { maxDepth: 5, maxOpenChildren: 20, maxActiveDescendants: 100 },
}
export const external: ExternalTaskWorkspace = {
  accessState: 'open', timeZone: 'Europe/Stockholm', recipientName: assignee.name,
  recipientAccount: { state: 'first_login', emailHint: 'a***@example.test' }, canDelegate: true,
  task: { ...task, assigneeName: assignee.name, attachments: [] }, children: [],
}
export const overview: RecipientPortalOverview = {
  recipientName: assignee.name, email: assignee.email,
  tasks: [{ ...task, organizationName: 'Exempelbygg AB' }],
  summary: { active: 1, needsAction: 1, overdue: 0, completed: 0, unreadMessages: 0 },
  analytics: { asOf: date, defaultPeriod: '90d', self: scope },
}
export const cases = { cases: [requestFixture], summary: { active: 1, pricingNeeded: 2, waitingSubcontractor: 0, awaitingCustomer: 0, readyToSchedule: 0, readyToInvoice: 0 } }

// Server-page dependencies are replaced only in the isolated browser fixture.
export async function getActionCasePortal() {
  return { accessState: new URLSearchParams(location.search).has('expired') ? 'expired' : 'open', actionCase: requestFixture, participant: assignee }
}
export async function getRfqPublicView() {
  if (new URLSearchParams(location.search).has('expired')) return null
  return { subject: 'Panel och målning vid entrén', propertyAddress: requestFixture.propertyAddress, supplierName: assignee.name,
    expiresAt: '2027-01-20', body: 'Byt skadade brädor och måla två gånger. Lämna ett samlat pris för arbete och material.', files: requestFixture.attachments }
}
