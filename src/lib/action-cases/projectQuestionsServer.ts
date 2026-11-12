import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getTaskPeople } from '@/lib/tasks/server'
import { createTaskAttachmentSignedUrl } from '@/lib/tasks/attachments'
import { questionMutation, questionAssignmentMutation, questionDueDateMutation, questionFileUpdateMutation, questionAttachmentIds, questionUuid, questionParticipantSelection, questionParticipantDifference, type ProjectQuestion, type QuestionAssignee, type QuestionBody, type QuestionWorkspace, type QuestionTask, type QuestionDialogueAudit, type QuestionHistoryPerson } from './projectQuestions'

type Context = { orgId: string; userId: string }
function checked(error: { code?: string; message?: string } | null) {
  if (!error) return
  if (['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205'].includes(error.code || '')) throw new Error('PROJECT_QUESTION_SCHEMA')
  const taskError = error.message?.match(/(?:^|\s)(TASK_[A-Z_]+)/)?.[1]
  if (taskError) throw new Error(({ TASK_VERSION_CONFLICT: 'PROJECT_QUESTION_STALE', TASK_DETAILS_DELIVERY_PENDING: 'PROJECT_QUESTION_ASSIGNMENT_DELIVERY_PENDING',
    TASK_DETAILS_PENDING_REQUEST: 'PROJECT_QUESTION_ASSIGNMENT_PENDING_REQUEST', TASK_DETAILS_FORBIDDEN: 'PROJECT_QUESTION_FORBIDDEN',
    TASK_CHILD_AFTER_PARENT_DUE: 'PROJECT_QUESTION_DUE_PARENT', TASK_PARENT_DUE_BEFORE_CHILD: 'PROJECT_QUESTION_DUE_CHILDREN', TASK_DUE_EDIT_RECURRENCE: 'PROJECT_QUESTION_DUE_RECURRENCE',
    TASK_ASSIGNEE_TASK_ACCESS_REQUIRED: 'PROJECT_QUESTION_ASSIGNEE', TASK_CONTACT_METHOD_REQUIRED: 'PROJECT_QUESTION_ASSIGNEE' } as Record<string, string>)[taskError] || 'PROJECT_QUESTION_FAILED')
  const code = error.message?.match(/PROJECT_QUESTION_[A-Z_]+/)?.[0]
  throw new Error(code || 'PROJECT_QUESTION_FAILED')
}
async function requireProject(ctx: Context, caseId: string) {
  if (!questionUuid(caseId)) throw new Error('PROJECT_QUESTION_INVALID')
  const r = await createSupabaseAdminClient().from('action_cases').select('id').eq('org_id', ctx.orgId).eq('id', caseId).maybeSingle()
  checked(r.error)
  if (!r.data) throw new Error('PROJECT_QUESTION_NOT_FOUND')
}
// Explicit paging avoids silently dropping old answers at PostgREST's row limit.
async function pages<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { code?: string; message?: string } | null }>) {
  const all: T[] = []
  for (let from = 0; ; from += 500) {
    const r = await query(from, from + 499); checked(r.error); all.push(...r.data || [])
    if ((r.data?.length ?? 0) < 500) return all
  }
}
export async function questionAssignees(ctx: Context, caseId: string) {
  const people = (await getTaskPeople({ ...ctx, isOrgAdmin: false })).filter(p => p.isActive)
  const result = await createSupabaseAdminClient().rpc('project_question_customers', { p_org_id: ctx.orgId, p_case_id: caseId })
  const missing = ['42883', 'PGRST202'].includes(result.error?.code || '')
  if (!missing) checked(result.error)
  const customers: QuestionAssignee[] = (missing ? [] : result.data || []).map((c: { id: string; name: string; email: string | null }) => ({ id: c.id, name: c.name, email: c.email, kind: 'customer' }))
  return { customersAvailable: !missing, assignees: [...customers, ...people.map(p => ({ id: p.id, kind: p.kind, name: p.name, email: p.email }))] }
}
export async function getProjectQuestions(ctx: Context, caseId: string): Promise<QuestionWorkspace> {
  await requireProject(ctx, caseId)
  const db = createSupabaseAdminClient()
  const project = await db.from('action_cases').select('manager_profile_id').eq('org_id', ctx.orgId).eq('id', caseId).maybeSingle(); checked(project.error)
  const managerId: string | null = project.data?.manager_profile_id ?? null
  const directory = await questionAssignees(ctx, caseId)
  const ownMemberships = await pages<{ question_id: string }>((a, b) => db.from('action_case_question_participants').select('question_id').eq('org_id', ctx.orgId).eq('action_case_id', caseId).eq('person_kind', 'profile').eq('person_id', ctx.userId).eq('active', true).order('question_id').range(a, b))
  const visible = ownMemberships.map(m => m.question_id)
  const members = visible.length ? await pages<Record<string, unknown>>((a, b) => db.from('action_case_question_participants').select('id,question_id,person_kind,person_id,name,email,shared,active').eq('org_id', ctx.orgId).eq('action_case_id', caseId).in('question_id', visible).order('joined_at').order('id').range(a, b)) : []
  const rows = visible.length ? await pages<Record<string, unknown>>((a, b) => db.from('action_case_questions').select('id,number,revision,body,updated_at,attachment_ids').eq('org_id', ctx.orgId).eq('action_case_id', caseId).in('id', visible).order('number').range(a, b)) : []
  const events = visible.length ? await pages<Record<string, unknown>>((a, b) => db.from('action_case_question_events').select('id,question_id,revision,operation,actor_name,body,message,reported_by,task_id,created_at,files:action_case_question_files(attachment_id,file_name)').eq('org_id', ctx.orgId).eq('action_case_id', caseId).in('question_id', visible).order('created_at').order('id').range(a, b)) : []
  // These immutable requests describe saved selections, not necessarily the
  // complete effective roster before the first request. Do not invent a baseline.
  const dialogueRows = visible.length ? await pages<Record<string, unknown>>((a, b) => db.from('action_case_question_messages').select('id,question_id,operation,actor_name,created_at,request,snapshot,files:action_case_question_message_files(attachment_id,file_name)').in('question_id', visible).in('operation', ['participants', 'share']).order('created_at').order('id').range(a, b)) : []
  const shareIds = dialogueRows.filter(r => r.operation === 'share').map(r => String(r.id))
  const deliveries = shareIds.length ? await pages<Record<string, unknown>>((a, b) => db.from('action_case_question_deliveries').select('id,message_id,recipient_name,status,sent_at').in('message_id', shareIds).order('id').range(a, b)) : []
  const dialogueHistory = new Map<string, QuestionDialogueAudit[]>()
  const selections = new Map<string, QuestionHistoryPerson[] | null>()
  for (const row of dialogueRows) {
    const questionId = String(row.question_id)
    const names = new Map(members.filter(m => m.question_id === questionId).map(m => [`${m.person_kind}:${m.person_id}`, String(m.name)]))
    const selected = row.operation === 'participants' ? questionParticipantSelection((row.request as Record<string, unknown> | null)?.participants, names) : null
    const difference = questionParticipantDifference(selections.get(questionId) ?? null, selected)
    if (row.operation === 'participants') selections.set(questionId, selected)
    const entry: QuestionDialogueAudit = { id: String(row.id), operation: row.operation as QuestionDialogueAudit['operation'], actorName: String(row.actor_name), createdAt: String(row.created_at), selected: selected || [], ...difference,
      snapshot: row.operation === 'share' ? row.snapshot as QuestionDialogueAudit['snapshot'] : null,
      files: ((row.files || []) as Array<{ attachment_id: string; file_name: string }>).map(f => ({ id: f.attachment_id, name: f.file_name })),
      deliveries: deliveries.filter(d => d.message_id === row.id).map(d => ({ id: String(d.id), name: String(d.recipient_name), status: String(d.status), sentAt: d.sent_at as string | null })) }
    dialogueHistory.set(questionId, [...dialogueHistory.get(questionId) || [], entry])
  }
  const tasks = new Map<string, QuestionTask>()
  const sourceFiles = visible.length ? await pages<Record<string, unknown>>((a, b) => db.from('action_case_attachments').select('id,question_id,storage_bucket,file_path').eq('org_id', ctx.orgId).eq('action_case_id', caseId).or(`question_id.is.null,question_id.in.(${visible.join(',')})`).order('id').range(a, b)) : []
  const taskIds = [...new Set(events.flatMap(event => typeof event.task_id === 'string' ? [event.task_id] : []))]
  const rules = taskIds.length ? await pages<{ task_id: string; initial_dispatch_pending: boolean }>((a, b) => db.from('task_followup_rules').select('task_id,initial_dispatch_pending').eq('org_id', ctx.orgId).in('task_id', taskIds).order('task_id').range(a, b)) : []
  for (const event of events) {
    if (typeof event.task_id !== 'string') continue
    const tid = event.task_id
    const t = await db.from('operational_tasks').select('id,status,version,due_at,archived_at,issuer_profile_id,assignee_profile_id,assignee_contact_id').eq('org_id', ctx.orgId).eq('id', tid).maybeSingle(); checked(t.error)
    if (!t.data) continue
    const comments = await pages<Record<string, unknown>>((a, b) => db.from('task_events').select('id,event_type,actor_name,message,created_at').eq('org_id', ctx.orgId).eq('task_id', tid).in('event_type', ['comment', 'status_changed', 'task_submitted_for_review', 'task_approved', 'task_returned']).order('created_at').order('id').range(a, b))
    const files = await pages<Record<string, unknown>>((a, b) => db.from('task_attachments').select('id,file_name,title,text_content,created_at,storage_bucket,file_path,is_completion_evidence').eq('org_id', ctx.orgId).eq('task_id', tid).order('created_at').order('id').range(a, b))
    const recipient = t.data.assignee_profile_id === ctx.userId ? { kind: 'profile' as const, id: t.data.issuer_profile_id } : t.data.assignee_profile_id ? { kind: 'profile' as const, id: t.data.assignee_profile_id } : { kind: 'contact' as const, id: t.data.assignee_contact_id }
    const target = directory.assignees.find(p => p.kind === recipient.kind && p.id === recipient.id)
    const canReply = !t.data.archived_at && [t.data.issuer_profile_id, t.data.assignee_profile_id].includes(ctx.userId)
    const awaitingDispatch = rules.some(rule => rule.task_id === tid && rule.initial_dispatch_pending)
    tasks.set(tid, { id: tid, status: t.data.status, version: t.data.version, awaitingDispatch, active: !t.data.archived_at && !['approved', 'cancelled'].includes(t.data.status), dueAt: t.data.due_at,
      assigneeName: (rows.find(row => row.id === event.question_id)?.body as QuestionBody | undefined)?.assignee?.name || (event.body as QuestionBody).assignee?.name || '',
      replyTarget: !awaitingDispatch && canReply && target?.email?.trim() ? { taskId: tid, name: target.name, recipient: { ...recipient, email: target.email.trim().toLowerCase() } } : null,
      events: comments.map(c => ({ id: String(c.id), actorName: String(c.actor_name || 'Mottagare'), type: String(c.event_type), text: String(c.message || ''), createdAt: String(c.created_at) })),
      files: files.map(f => ({ id: String(f.id), name: String(f.file_name || f.title || 'Bilaga'), text: f.text_content as string | null, createdAt: String(f.created_at), sourceAttachmentId: !f.is_completion_evidence && f.file_path ? (sourceFiles.find(s => s.storage_bucket === f.storage_bucket && s.file_path === f.file_path && (!s.question_id || s.question_id === event.question_id))?.id as string | undefined) ?? null : null })) })
  }
  const questions: ProjectQuestion[] = rows.map(r => ({ id: String(r.id), number: Number(r.number), revision: Number(r.revision), ...(Array.isArray(r.attachment_ids) ? { attachmentIds: r.attachment_ids as string[] } : {}), body: r.body as QuestionBody,
    participants: members.filter(m => m.question_id === r.id && m.active).map(m => ({ id: String(m.id), kind: m.person_kind as QuestionAssignee['kind'], personId: String(m.person_id), name: String(m.name), email: m.email as string | null, shared: Boolean(m.shared) })),
    dialogueHistory: dialogueHistory.get(String(r.id)) || [],
    createdAt: (events.find(e => e.question_id === r.id && e.operation === 'create' && Number(e.revision) === 1)?.created_at as string | undefined) ?? null, updatedAt: String(r.updated_at),
    events: events.filter(e => e.question_id === r.id).map(e => ({ id: String(e.id), revision: Number(e.revision), operation: String(e.operation), actorName: String(e.actor_name), createdAt: String(e.created_at), text: String(e.message), reportedBy: String(e.reported_by), body: e.body as QuestionBody, taskId: e.task_id as string | null,
      files: ((e.files || []) as Array<{ attachment_id: string; file_name: string }>).map(f => ({ id: f.attachment_id, name: f.file_name })) })),
    tasks: events.filter(e => e.question_id === r.id && typeof e.task_id === 'string').flatMap(e => tasks.has(String(e.task_id)) ? [tasks.get(String(e.task_id))!] : []) }))
  for (const question of questions) question.attachmentIds = questionAttachmentIds(question)
  const privateRows = visible.length ? await pages<Record<string, unknown>>((a, b) => db.from('action_case_attachments').select('id,question_id,file_name,content_type,file_size_bytes,created_at,attachment_type').eq('org_id', ctx.orgId).eq('action_case_id', caseId).in('question_id', visible).order('created_at').order('id').range(a, b)) : []
  const privateFiles = privateRows.map(f => ({ id: String(f.id), questionId: String(f.question_id), fileName: String(f.file_name), contentType: String(f.content_type), fileSizeBytes: Number(f.file_size_bytes), type: f.attachment_type as 'image' | 'document', createdAt: String(f.created_at), actionCaseItemId: null, title: null, grantedParticipantIds: [] }))
  return { questions, privateFiles, userId: ctx.userId, managerId, canManageParticipants: managerId === ctx.userId, ...directory }
}
export async function mutateProjectQuestion(ctx: Context, caseId: string, payload: Record<string, unknown>) {
  if (payload.operation === 'share_files') {
    const request = questionFileUpdateMutation(payload)
    await requireProject(ctx, caseId)
    const result = await createSupabaseAdminClient().rpc('share_project_question_files', { p_org_id: ctx.orgId, p_case_id: caseId, p_actor_id: ctx.userId, p_request: request })
    checked(result.error)
    return { questionId: String(result.data) }
  }
  if (payload.operation === 'reschedule') {
    const request = questionDueDateMutation(payload)
    await requireProject(ctx, caseId)
    const result = await createSupabaseAdminClient().rpc('write_project_question_due_date', { p_org_id: ctx.orgId, p_case_id: caseId, p_actor_id: ctx.userId, p_request: request })
    checked(result.error)
    return { questionId: String(result.data) }
  }
  if (['reassign', 'dispatch_reassignment'].includes(String(payload.operation))) {
    const request = questionAssignmentMutation(payload)
    await requireProject(ctx, caseId)
    const result = await createSupabaseAdminClient().rpc('write_project_question_assignment', { p_org_id: ctx.orgId, p_case_id: caseId, p_actor_id: ctx.userId, p_request: request })
    checked(result.error)
    return { questionId: String(result.data) }
  }
  const request = questionMutation(payload)
  await requireProject(ctx, caseId)
  if (request.body?.assignee || request.operation === 'send') {
    const { assignees } = await questionAssignees(ctx, caseId)
    const b = request.body ?? (await getProjectQuestions(ctx, caseId)).questions.find(q => q.id === request.questionId)?.body
    const assignee = b?.assignee
    const person = assignees.find(p => p.id === assignee?.id && p.kind === assignee.kind)
    if (!person || (request.operation === 'send' && person.kind !== 'profile' && !person.email)) throw new Error('PROJECT_QUESTION_ASSIGNEE')
  }
  const r = await createSupabaseAdminClient().rpc('mutate_project_question', { p_org_id: ctx.orgId, p_case_id: caseId, p_actor_id: ctx.userId, p_request: request })
  checked(r.error)
  return { questionId: String(r.data) }
}
export async function projectQuestionTaskFile(ctx: Context, caseId: string, taskId: string, fileId: string) {
  await requireProject(ctx, caseId)
  if (!questionUuid(taskId) || !questionUuid(fileId)) throw new Error('PROJECT_QUESTION_INVALID')
  const db = createSupabaseAdminClient()
  const r = await db.from('action_case_question_events').select('id,question_id').eq('org_id', ctx.orgId).eq('action_case_id', caseId).eq('task_id', taskId).maybeSingle(); checked(r.error)
  if (!r.data) throw new Error('PROJECT_QUESTION_NOT_FOUND')
  const scope = await db.rpc('project_question_internal_participant', { p_org_id: ctx.orgId, p_case_id: caseId, p_question_id: r.data.question_id, p_profile_id: ctx.userId }); checked(scope.error)
  if (scope.data !== true) throw new Error('PROJECT_QUESTION_NOT_FOUND')
  return createTaskAttachmentSignedUrl({ orgId: ctx.orgId, taskId, attachmentId: fileId })
}
