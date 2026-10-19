export const questionStatuses = { open: 'Öppen', investigating: 'Under utredning', answered: 'Besvarad', closed: 'Avslutad' } as const
export type QuestionStatus = keyof typeof questionStatuses
export type QuestionAssignee = { id: string; kind: 'profile' | 'contact' | 'customer'; name: string; email?: string | null }
export type QuestionBody = { title: string; description: string; source: string; meetingDate: string; assignee: QuestionAssignee | null; status: QuestionStatus }
export type QuestionFile = { id: string; name: string }
export type QuestionParticipant = { id: string; kind: QuestionAssignee['kind']; personId: string; name: string; email: string | null; shared: boolean }
export type QuestionEvent = { id: string; operation: string; actorName: string; createdAt: string; text: string; reportedBy: string; body: QuestionBody; files: QuestionFile[]; revision: number; taskId: string | null }
export type QuestionTask = { id: string; status: string; active?: boolean; dueAt: string; assigneeName: string; events: Array<{ id: string; actorName: string; type: string; text: string; createdAt: string }>; files: Array<{ id: string; name: string; text: string | null; createdAt: string }> }
export type ProjectQuestion = { id: string; number: number; revision: number; createdAt: string | null; updatedAt: string; body: QuestionBody; events: QuestionEvent[]; tasks: QuestionTask[]; participants: QuestionParticipant[] }
export type QuestionWorkspace = { questions: ProjectQuestion[]; assignees: QuestionAssignee[]; privateFiles?: Array<import('./contracts').ActionCaseAttachmentView & { questionId: string }>; customersAvailable?: boolean; userId: string; managerId: string | null; canManageParticipants: boolean }
export const emptyQuestion = (): QuestionBody => ({ title: '', description: '', source: '', meetingDate: '', assignee: null, status: 'open' })
export function questionAssigneeOptions(people: QuestionAssignee[], selected: QuestionAssignee | null) {
  const options = new Map<string, QuestionAssignee>()
  for (const person of people) {
    const key = person.kind === 'profile' ? `profile:${person.id}` : `${person.name.trim().toLocaleLowerCase('sv')}\n${(person.email || '').trim().toLowerCase()}`
    const previous = options.get(key)
    if (!previous || (person.id === selected?.id && person.kind === selected.kind) ||
      (person.kind === 'customer' && !(previous.id === selected?.id && previous.kind === selected.kind))) options.set(key, person)
  }
  return [...options.values()]
}
export const questionUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
export function questionDate(v: unknown): v is string {
  if (v === '') return true
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || v < '0001-01-01' || v > '9999-12-31') return false
  const d = new Date(`${v}T12:00:00Z`)
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v
}
function text(v: unknown, max: number, required = false) {
  if (typeof v !== 'string' || v.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v) || (required && !v.trim())) throw new Error('PROJECT_QUESTION_INVALID')
  return v.trim()
}
export function questionMutation(v: Record<string, unknown>) {
  if (!questionUuid(v.questionId) || !questionUuid(v.requestId) || !Number.isSafeInteger(v.revision) || Number(v.revision) < 0) throw new Error('PROJECT_QUESTION_INVALID')
  const operation = String(v.operation)
  if (!['create', 'update', 'answer', 'note', 'close', 'reopen', 'send'].includes(operation)) throw new Error('PROJECT_QUESTION_INVALID')
  if (!Array.isArray(v.fileIds) || v.fileIds.length > 20 || !v.fileIds.every(questionUuid) || new Set(v.fileIds).size !== v.fileIds.length) throw new Error('PROJECT_QUESTION_INVALID')
  let body: QuestionBody | null = null
  if (['create', 'update'].includes(operation)) {
    const b = v.body as QuestionBody
    if (!b || typeof b !== 'object' || !questionDate(b.meetingDate) || !['open', 'investigating', 'answered'].includes(b.status)) throw new Error('PROJECT_QUESTION_INVALID')
    if (b.assignee !== null && (!b.assignee || !questionUuid(b.assignee.id) || !['profile', 'contact', 'customer'].includes(b.assignee.kind))) throw new Error('PROJECT_QUESTION_INVALID')
    body = { title: text(b.title, 250, true), description: text(b.description, 12000, true), source: text(b.source, 500), meetingDate: b.meetingDate, assignee: b.assignee ? { id: b.assignee.id, kind: b.assignee.kind, name: '' } : null, status: b.status }
  }
  const message = text(v.text ?? '', 12000, ['answer', 'note', 'close', 'reopen'].includes(operation))
  const reportedBy = text(v.reportedBy ?? '', 250)
  if (reportedBy && operation !== 'answer') throw new Error('PROJECT_QUESTION_INVALID')
  let dueAt: string | null = null, followupAt: string | null = null
  if (operation === 'send') {
    for (const key of ['dueAt', 'followupAt']) {
      const value = v[key]
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !questionDate(value.slice(0, 10)) || !Number.isFinite(Date.parse(value))) throw new Error('PROJECT_QUESTION_DATES')
    }
    dueAt = new Date(String(v.dueAt)).toISOString(); followupAt = new Date(String(v.followupAt)).toISOString()
    if (followupAt > dueAt || v.confirmed !== true) throw new Error('PROJECT_QUESTION_DATES')
  }
  return { questionId: v.questionId, requestId: v.requestId, revision: Number(v.revision), operation, body, text: message, reportedBy, fileIds: v.fileIds as string[], dueAt, followupAt }
}
