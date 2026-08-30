export type TaskStatus =
  | 'draft'
  | 'assigned'
  | 'in_progress'
  | 'waiting'
  | 'ready_for_review'
  | 'returned'
  | 'approved'
  | 'cancelled'

export type TaskKind = 'simple' | 'paid_external' | 'warranty' | 'general'

export type TaskChannel = 'email' | 'whatsapp'

export const TASK_RECURRENCE_INTERVALS = ['weekly', 'monthly', 'quarterly', 'yearly'] as const
export type TaskRecurrenceInterval = (typeof TASK_RECURRENCE_INTERVALS)[number]

export type TaskEvidenceRequirement = 'optional' | 'text' | 'photo' | 'document' | 'any'

export const TASK_COMPLETION_EVIDENCE_TYPES = ['photo', 'document', 'text'] as const
export type TaskCompletionEvidenceType = (typeof TASK_COMPLETION_EVIDENCE_TYPES)[number]

export function evidenceTypesFromLegacyRequirement(
  requirement: TaskEvidenceRequirement
): TaskCompletionEvidenceType[] {
  return requirement === 'text' || requirement === 'photo' || requirement === 'document'
    ? [requirement]
    : []
}

export function legacyRequirementFromEvidenceTypes(
  requirements: readonly TaskCompletionEvidenceType[]
): TaskEvidenceRequirement {
  if (requirements.length === 0) return 'optional'
  if (requirements.length === 1) return requirements[0]
  return 'any'
}

export type TaskRequirementStatus =
  | 'pending'
  | 'evidence_detected'
  | 'verified'
  | 'not_required'
  | 'waived'

export type TaskRisk = 'green' | 'yellow' | 'red'

export type TaskBallHolder = 'issuer' | 'assignee' | 'nobody'

export type TaskEventAuthorSide = 'self' | 'other' | 'system'

export type TaskPerson = {
  id: string
  kind: 'profile' | 'contact'
  name: string
  companyName: string | null
  email: string | null
  phone: string | null
  whatsappNumber: string | null
  isActive: boolean
}

export const TASK_ANALYTICS_PERIODS = ['30d', '90d', '12m', 'all'] as const
export type TaskAnalyticsPeriod = (typeof TASK_ANALYTICS_PERIODS)[number]

export type TaskDeliveryStats = {
  approvedCount: number
  measuredCount: number
  unknownCount: number
  onTimeCount: number
  lateCount: number
  onTimePercent: number | null
  limitedSample: boolean
  taskIds: {
    approved: string[]
    onTime: string[]
    late: string[]
    unknown: string[]
  }
}

export type TaskCurrentStats = {
  activeCount: number
  overdueCount: number
  dueWithin7DaysCount: number
  awaitingReviewCount: number
  taskIds: {
    active: string[]
    overdue: string[]
    dueWithin7Days: string[]
    awaitingReview: string[]
  }
}

export type TaskAnalyticsScope = {
  current: TaskCurrentStats
  deliveryByPeriod: Record<TaskAnalyticsPeriod, TaskDeliveryStats>
}

export type TaskAssigneeAnalytics = TaskAnalyticsScope & {
  assignee: TaskPerson
}

export type TaskWorkspaceAnalytics = {
  asOf: string
  defaultPeriod: '90d'
  self: TaskAnalyticsScope
  issuedByMe: TaskAnalyticsScope & {
    assignees: TaskAssigneeAnalytics[]
  }
}

export type TaskRecipientAnalytics = {
  asOf: string
  defaultPeriod: '90d'
  self: TaskAnalyticsScope
}

export type TaskRequirementView = {
  id: string
  key: string
  label: string
  status: TaskRequirementStatus
  required: boolean
  verifiedAt: string | null
  verifiedByName: string | null
}

export type TaskEventView = {
  id: string
  type: string
  actorName: string
  message: string | null
  fromStatus: TaskStatus | null
  toStatus: TaskStatus | null
  createdAt: string
  authorSide: TaskEventAuthorSide
}

export type TaskLatestMessageView = {
  id: string
  actorName: string
  message: string
  createdAt: string
  authorSide: TaskEventAuthorSide
}

export type TaskNotificationDeliveryStatus =
  | 'queued'
  | 'processing'
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'replied'
  | 'failed'
  | 'cancelled'
  | 'ambiguous'

export type TaskNotificationDeliveryView = {
  id: string
  label: string
  channel: TaskChannel | 'in_app' | null
  status: TaskNotificationDeliveryStatus
  stage: 'outbox' | 'channel'
  isFallback: boolean
  statusAt: string
  requiresAttention: boolean
}

export type TaskDeadlineRequestView = {
  id: string
  requestedDueAt: string
  reason: string
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  decidedAt: string | null
  decisionNote: string | null
  createdAt: string
}

export type TaskAttachmentView = {
  id: string
  type: 'photo' | 'document' | 'audio' | 'text'
  title: string | null
  fileName: string | null
  contentType: string | null
  textContent: string | null
  transcriptText: string | null
  canEditTranscript: boolean
  isCompletionEvidence: boolean
  createdAt: string
}

export type TaskAiSuggestionView = {
  id: string
  type: 'create_subtask'
  title: string
  description: string | null
  rationale: string | null
  status: 'pending'
  createdAt: string
}

export type TaskView = {
  id: string
  parentTaskId: string | null
  rootTaskId: string
  depth: number
  title: string
  description: string | null
  contextLabel: string | null
  taskKind: TaskKind
  status: TaskStatus
  risk: TaskRisk
  ballHolder: TaskBallHolder
  dueAt: string
  dueTimeZone: string
  nextFollowupAt: string
  recurrenceInterval: TaskRecurrenceInterval | null
  recurrenceSequence: number | null
  primaryChannel: TaskChannel
  fallbackChannel: TaskChannel | null
  evidenceRequirement: TaskEvidenceRequirement
  evidenceRequirements: TaskCompletionEvidenceType[]
  initialDispatchPending: boolean
  issuerId: string
  issuerName: string
  canDelete: boolean
  assignee: TaskPerson
  reviewRound: number
  version: number
  childCount: number
  openChildCount: number
  requirements: TaskRequirementView[]
  events: TaskEventView[]
  deadlineRequests: TaskDeadlineRequestView[]
  attachments: TaskAttachmentView[]
  aiSuggestions: TaskAiSuggestionView[]
  unreadMessageCount: number
  latestMessage: TaskLatestMessageView | null
  latestIncomingMessageEventId: string | null
  notificationDeliveries: TaskNotificationDeliveryView[]
  notificationDeliveryProblemCount: number
  createdAt: string
  updatedAt: string
}

export type TaskWorkspaceSummary = {
  totalActive: number
  userHasBall: number
  awaitingReview: number
  overdue: number
  green: number
  yellow: number
  red: number
  unreadMessages: number
}

export type TaskWorkspace = {
  /** Current organization zone; individual deadlines use task.dueTimeZone. */
  timeZone: string
  currentUser: {
    id: string
    name: string
    isOrgAdmin: boolean
  }
  tasks: TaskView[]
  people: TaskPerson[]
  summary: TaskWorkspaceSummary
  analytics: TaskWorkspaceAnalytics
  limits: {
    maxDepth: number
    maxOpenChildren: number
    maxActiveDescendants: number
  }
}

export type TaskActionResponse = {
  workspace: TaskWorkspace
  notice?: string
  warning?: string
  accessUrl?: string
  createdTaskId?: string
}
