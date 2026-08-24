export type TaskStatus =
  | 'draft'
  | 'assigned'
  | 'in_progress'
  | 'waiting'
  | 'ready_for_review'
  | 'returned'
  | 'approved'
  | 'cancelled'

export type TaskKind = 'simple' | 'paid_external' | 'warranty'

export type TaskChannel = 'email' | 'whatsapp'

export type TaskEvidenceRequirement = 'optional' | 'text' | 'photo' | 'document' | 'any'

export type TaskRequirementStatus =
  | 'pending'
  | 'evidence_detected'
  | 'verified'
  | 'not_required'
  | 'waived'

export type TaskRisk = 'green' | 'yellow' | 'red'

export type TaskBallHolder = 'issuer' | 'assignee' | 'nobody'

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
  nextFollowupAt: string
  primaryChannel: TaskChannel
  fallbackChannel: TaskChannel | null
  evidenceRequirement: TaskEvidenceRequirement
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
}

export type TaskWorkspace = {
  currentUser: {
    id: string
    name: string
    isOrgAdmin: boolean
  }
  tasks: TaskView[]
  people: TaskPerson[]
  summary: TaskWorkspaceSummary
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
