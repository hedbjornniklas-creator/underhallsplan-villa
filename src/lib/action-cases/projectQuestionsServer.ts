import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getTaskPeople } from '@/lib/tasks/server'
import { createTaskAttachmentSignedUrl } from '@/lib/tasks/attachments'
import { questionMutation, questionUuid, type ProjectQuestion, type QuestionBody, type QuestionWorkspace, type QuestionTask } from './projectQuestions'

type Context = { orgId: string; userId: string }
function checked(error: { code?: string; message?: string } | null) {
  if (!error) return
  if (['42P01', '42883', 'PGRST202', 'PGRST205'].includes(error.code || '')) throw new Error('PROJECT_QUESTION_SCHEMA')
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
export async function questionAssignees(ctx: Context) {
  return (await getTaskPeople({ ...ctx, isOrgAdmin: false })).filter(p => p.isActive).map(p => ({ id: p.id, kind: p.kind, name: p.name, email: p.email }))
}
export async function getProjectQuestions(ctx: Context, caseId: string): Promise<QuestionWorkspace> {
  await requireProject(ctx, caseId)
  const db = createSupabaseAdminClient()
  const rows = await pages<Record<string, unknown>>((a, b) => db.from('action_case_questions').select('id,number,revision,body,updated_at').eq('org_id', ctx.orgId).eq('action_case_id', caseId).order('number').range(a, b))
  const events = await pages<Record<string, unknown>>((a, b) => db.from('action_case_question_events').select('id,question_id,revision,operation,actor_name,body,message,reported_by,task_id,created_at,files:action_case_question_files(attachment_id,file_name)').eq('org_id', ctx.orgId).eq('action_case_id', caseId).order('created_at').order('id').range(a, b))
  const tasks = new Map<string, QuestionTask>()
  for (const event of events) {
    if (typeof event.task_id !== 'string') continue
    const tid = event.task_id
    const t = await db.from('operational_tasks').select('id,status,due_at,archived_at').eq('org_id', ctx.orgId).eq('id', tid).maybeSingle(); checked(t.error)
    if (!t.data) continue
    const comments = await pages<Record<string, unknown>>((a, b) => db.from('task_events').select('id,event_type,actor_name,message,created_at').eq('org_id', ctx.orgId).eq('task_id', tid).in('event_type', ['comment', 'status_changed', 'task_submitted_for_review', 'task_approved', 'task_returned']).order('created_at').order('id').range(a, b))
    const files = await pages<Record<string, unknown>>((a, b) => db.from('task_attachments').select('id,file_name,title,text_content,created_at').eq('org_id', ctx.orgId).eq('task_id', tid).order('created_at').order('id').range(a, b))
    tasks.set(tid, { id: tid, status: t.data.status, active: !t.data.archived_at && !['approved', 'cancelled'].includes(t.data.status), dueAt: t.data.due_at, assigneeName: (event.body as QuestionBody).assignee?.name || '',
      events: comments.map(c => ({ id: String(c.id), actorName: String(c.actor_name || 'Mottagare'), type: String(c.event_type), text: String(c.message || ''), createdAt: String(c.created_at) })),
      files: files.map(f => ({ id: String(f.id), name: String(f.file_name || f.title || 'Bilaga'), text: f.text_content as string | null, createdAt: String(f.created_at) })) })
  }
  const questions: ProjectQuestion[] = rows.map(r => ({ id: String(r.id), number: Number(r.number), revision: Number(r.revision), body: r.body as QuestionBody, updatedAt: String(r.updated_at),
    events: events.filter(e => e.question_id === r.id).map(e => ({ id: String(e.id), revision: Number(e.revision), operation: String(e.operation), actorName: String(e.actor_name), createdAt: String(e.created_at), text: String(e.message), reportedBy: String(e.reported_by), body: e.body as QuestionBody, taskId: e.task_id as string | null,
      files: ((e.files || []) as Array<{ attachment_id: string; file_name: string }>).map(f => ({ id: f.attachment_id, name: f.file_name })) })),
    tasks: events.filter(e => e.question_id === r.id && typeof e.task_id === 'string').flatMap(e => tasks.has(String(e.task_id)) ? [tasks.get(String(e.task_id))!] : []) }))
  return { questions, assignees: await questionAssignees(ctx) }
}
export async function mutateProjectQuestion(ctx: Context, caseId: string, payload: Record<string, unknown>) {
  const request = questionMutation(payload)
  await requireProject(ctx, caseId)
  if (request.body?.assignee || request.operation === 'send') {
    const people = await getTaskPeople({ ...ctx, isOrgAdmin: false })
    const b = request.body ?? (await getProjectQuestions(ctx, caseId)).questions.find(q => q.id === request.questionId)?.body
    const assignee = b?.assignee
    const person = people.find(p => p.id === assignee?.id && p.kind === assignee.kind && p.isActive)
    if (!person || (request.operation === 'send' && person.kind === 'contact' && !person.email)) throw new Error('PROJECT_QUESTION_ASSIGNEE')
  }
  const r = await createSupabaseAdminClient().rpc('mutate_project_question', { p_org_id: ctx.orgId, p_case_id: caseId, p_actor_id: ctx.userId, p_request: request })
  checked(r.error)
  return { questionId: String(r.data) }
}
export async function projectQuestionTaskFile(ctx: Context, caseId: string, taskId: string, fileId: string) {
  await requireProject(ctx, caseId)
  if (!questionUuid(taskId) || !questionUuid(fileId)) throw new Error('PROJECT_QUESTION_INVALID')
  const r = await createSupabaseAdminClient().from('action_case_question_events').select('id').eq('org_id', ctx.orgId).eq('action_case_id', caseId).eq('task_id', taskId).maybeSingle(); checked(r.error)
  if (!r.data) throw new Error('PROJECT_QUESTION_NOT_FOUND')
  return createTaskAttachmentSignedUrl({ orgId: ctx.orgId, taskId, attachmentId: fileId })
}
