export const questionStatuses = { open: 'Öppen', investigating: 'Under utredning', answered: 'Besvarad', closed: 'Avslutad' } as const
export type QuestionStatus = keyof typeof questionStatuses
export type QuestionAssignee = { id: string; kind: 'profile' | 'contact' | 'customer'; name: string; email?: string | null }
export type QuestionBody = { title: string; description: string; source: string; meetingDate: string; assignee: QuestionAssignee | null; status: QuestionStatus }
export type QuestionFile = { id: string; name: string }
export type QuestionParticipant = { id: string; kind: QuestionAssignee['kind']; personId: string; name: string; email: string | null; shared: boolean }
export type QuestionEvent = { id: string; operation: string; actorName: string; createdAt: string; text: string; reportedBy: string; body: QuestionBody; files: QuestionFile[]; revision: number; taskId: string | null }
export type QuestionHistoryPerson = { key: string; name: string }
export type QuestionDialogueAudit = {
  id: string; operation: 'participants' | 'share'; actorName: string; createdAt: string;
  selected: QuestionHistoryPerson[]; added: QuestionHistoryPerson[] | null; removed: QuestionHistoryPerson[] | null;
  snapshot: { title: string; description: string } | null; files: QuestionFile[];
  deliveries: Array<{ id: string; name: string; status: string; sentAt: string | null }>;
}
export type QuestionTaskReplyTarget = { taskId: string; name: string; recipient: { kind: 'contact' | 'profile'; id: string; email: string | null } }
export type QuestionTask = { id: string; status: string; active?: boolean; dueAt: string; assigneeName: string; replyTarget?: QuestionTaskReplyTarget | null; events: Array<{ id: string; actorName: string; type: string; text: string; createdAt: string }>; files: Array<{ id: string; name: string; text: string | null; createdAt: string }> }
export type ProjectQuestion = { id: string; number: number; revision: number; createdAt: string | null; updatedAt: string; body: QuestionBody; events: QuestionEvent[]; tasks: QuestionTask[]; participants: QuestionParticipant[]; dialogueHistory?: QuestionDialogueAudit[] }
export type QuestionWorkspace = { questions: ProjectQuestion[]; assignees: QuestionAssignee[]; privateFiles?: Array<import('./contracts').ActionCaseAttachmentView & { questionId: string }>; customersAvailable?: boolean; userId: string; managerId: string | null; canManageParticipants: boolean }
export const emptyQuestion = (): QuestionBody => ({ title: '', description: '', source: '', meetingDate: '', assignee: null, status: 'open' })
export const questionDeliveryLabels: Record<string, string> = { pending: 'Köad', sending: 'Skickas', sent: 'Överlämnad till e-posttjänsten', failed: 'Utskicket misslyckades', cancelled: 'Återkallad' }
export function questionTaskEventText(event: QuestionTask['events'][number]) {
  return event.text || ({ status_changed: 'Status ändrad i Gizmo', task_submitted_for_review: 'Svar lämnat för granskning', task_approved: 'Hanteringen godkänd', task_returned: 'Komplettering begärd' } as Record<string, string>)[event.type] || 'Händelse registrerad i Gizmo'
}
export function questionParticipantSelection(value: unknown, names: Map<string, string>): QuestionHistoryPerson[] | null {
  if (!Array.isArray(value) || value.some(p => !p || !['profile', 'contact', 'customer'].includes(p.kind) || !questionUuid(p.id))) return null
  return [...new Set(value.map(p => `${p.kind}:${p.id}`))].map(key => ({ key, name: names.get(key) || key }))
}
export function questionParticipantDifference(previous: QuestionHistoryPerson[] | null, selected: QuestionHistoryPerson[] | null) {
  if (!previous || !selected) return { added: null, removed: null }
  return { added: selected.filter(p => !previous.some(old => old.key === p.key)), removed: previous.filter(p => !selected.some(next => next.key === p.key)) }
}
export function questionSendRequirements(value: { assignee: QuestionAssignee | null; dueAt: string | null; followupAt: string | null; hasFollowup?: boolean; confirmed: boolean }) {
  const missing: Array<{ field: string; message: string }> = []
  if (!value.assignee) missing.push({ field: 'assignee', message: 'Välj ansvarig' })
  else if (value.assignee.kind !== 'profile' && !value.assignee.email?.trim()) missing.push({ field: 'assignee', message: 'Ansvarig saknar e-postadress' })
  if (!value.dueAt) missing.push({ field: 'due', message: 'Ange svarsdatum och klockslag' })
  if (value.hasFollowup && !value.followupAt) missing.push({ field: 'followup', message: 'Ange giltigt datum och klockslag för uppföljningen, eller lämna datumet tomt' })
  if (value.dueAt && value.followupAt && value.followupAt > value.dueAt) missing.push({ field: 'followup', message: 'Uppföljningen får inte ligga efter svarsdatumet' })
  if (!value.confirmed) missing.push({ field: 'confirmation', message: 'Bekräfta granskningen inför utskick' })
  return missing
}
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
export function questionTaskReplyMutation(value: Record<string, unknown>) {
  const recipient = value.recipient as Record<string, unknown> | undefined
  if (!questionUuid(value.taskId) || !questionUuid(value.requestId) || !recipient || !['profile', 'contact'].includes(String(recipient.kind)) || !questionUuid(recipient.id) || (recipient.email !== null && (typeof recipient.email !== 'string' || recipient.email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.email))) || (value.fileIds !== undefined && (!Array.isArray(value.fileIds) || value.fileIds.length))) throw new Error('PROJECT_QUESTION_INVALID')
  return { taskId: value.taskId, requestId: value.requestId, recipient: { kind: String(recipient.kind), id: recipient.id, email: typeof recipient.email === 'string' ? recipient.email.trim().toLowerCase() : null }, text: text(value.text, 12000, true) }
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
      if (key === 'followupAt' && (value === undefined || value === null || value === '')) continue
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !questionDate(value.slice(0, 10)) || !Number.isFinite(Date.parse(value))) throw new Error('PROJECT_QUESTION_DATES')
    }
    dueAt = new Date(String(v.dueAt)).toISOString()
    // The shared task engine requires a checkpoint. Using the deadline when no
    // extra follow-up is chosen adds no earlier status check; due reminders win.
    followupAt = v.followupAt ? new Date(String(v.followupAt)).toISOString() : dueAt
    if (followupAt > dueAt || v.confirmed !== true) throw new Error('PROJECT_QUESTION_DATES')
  }
  return { questionId: v.questionId, requestId: v.requestId, revision: Number(v.revision), operation, body, text: message, reportedBy, fileIds: v.fileIds as string[], dueAt, followupAt }
}
