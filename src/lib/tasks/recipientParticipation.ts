import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { questionUuid } from '@/lib/action-cases/projectQuestions'
import { recipientQuestionMember } from '@/lib/action-cases/questionDialogueServer'
import type { RecipientPortalSession } from './recipientPortal'

export type RecipientSharedItem = {
  id: string
  kind: 'question' | 'task'
  title: string
  contextLabel: string
  status: 'open' | 'closed'
  href: string
  sharedAt: string
  assignedTaskIds?: string[]
}
export type RecipientTaskParticipation = {
  grant_id: string; org_id: string; contact_id: string; task_id: string; question_id: string | null
  shared_from: string; shared_until: string
  snapshot: { title?: string; description?: string | null; contextLabel?: string | null; dueAt?: string | null; closed?: boolean }
}
type QuestionScope = { id: string; org_id: string; action_case_id: string; question_id: string; contact_id: string }
const rows = <T>(value: unknown) => (Array.isArray(value) ? value : []) as T[]
const checked = (error: { message?: string } | null) => { if (error) throw new Error('TASK_PARTICIPATION_READ_FAILED') }
const text = (value: unknown) => typeof value === 'string' ? value : ''
async function all<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message?: string } | null }>) {
  const result: T[] = []
  for (let offset = 0; ; offset += 500) {
    const page = await query(offset, offset + 499)
    checked(page.error)
    result.push(...page.data || [])
    if ((page.data?.length || 0) < 500) return result
  }
}

export async function recipientTaskParticipations(authUserId: string, taskId: string | null = null) {
  if (!questionUuid(authUserId) || (taskId !== null && !questionUuid(taskId))) throw new Error('TASK_NOT_FOUND')
  const result = await all<RecipientTaskParticipation>((from, to) => createSupabaseAdminClient().rpc('resolve_recipient_task_participation', { p_auth_user_id: authUserId, p_task_id: taskId }).order('grant_id').range(from, to))
  return [...new Map(result.filter(row => questionUuid(row.task_id) && questionUuid(row.contact_id) && Number.isFinite(Date.parse(row.shared_from)) && Date.parse(row.shared_until) >= Date.parse(row.shared_from)).map(row => [row.grant_id, row])).values()]
}

export async function getRecipientSharedItems(session: RecipientPortalSession, assignedTaskIds: readonly string[] = []): Promise<RecipientSharedItem[]> {
  const db = createSupabaseAdminClient()
  const members = await all<QuestionScope>((from, to) => db.rpc('resolve_recipient_question_scope', { p_auth_user_id: session.authUserId, p_question_id: null }).order('id').range(from, to))
  const ids = [...new Set(members.map(row => row.question_id).filter(questionUuid))]
  const result: RecipientSharedItem[] = []
  for (let offset = 0; offset < ids.length; offset += 200) {
    const batch = ids.slice(offset, offset + 200)
    const questions = await db.from('action_case_questions').select('id,number,action_case_id,status:body->>status').in('id', batch)
    checked(questions.error)
    const conversations = await db.from('action_case_question_conversations').select('question_id,shared_body,shared_at').in('question_id', batch)
    checked(conversations.error)
    const projects = await db.from('action_cases').select('id,title').in('id', [...new Set(members.filter(row => batch.includes(row.question_id)).map(row => row.action_case_id))])
    checked(projects.error)
    const published = new Map(rows<{ question_id: string; shared_body: { title?: string }; shared_at: string | null }>(conversations.data).map(row => [row.question_id, row]))
    const labels = new Map(rows<{ id: string; title: string }>(projects.data).map(row => [row.id, row.title]))
    const linkedTasks = new Map<string, Set<string>>()
    for (let taskOffset = 0; taskOffset < assignedTaskIds.length; taskOffset += 200) {
      const ownTasks = assignedTaskIds.slice(taskOffset, taskOffset + 200)
      const links = await all<{ question_id: string; task_id: string }>((from, to) => db.from('action_case_question_events')
        .select('id,question_id,task_id').in('question_id', batch).in('task_id', ownTasks).order('id').range(from, to))
      for (const link of links) {
        const set = linkedTasks.get(link.question_id) || new Set<string>()
        set.add(link.task_id); linkedTasks.set(link.question_id, set)
      }
    }
    for (const q of rows<{ id: string; number: number; action_case_id: string; status: string }>(questions.data)) {
      const c = published.get(q.id)
      if (!c?.shared_at || !c.shared_body?.title) continue
      result.push({ id: q.id, kind: 'question', title: `F-${String(q.number).padStart(3, '0')} ${c.shared_body.title}`,
        contextLabel: labels.get(q.action_case_id) || 'Projektfråga', status: q.status === 'closed' ? 'closed' : 'open',
        href: `/mina-uppdrag/fragor/${q.id}`, sharedAt: c.shared_at, assignedTaskIds: [...linkedTasks.get(q.id) || []] })
    }
  }
  const questionIds = new Set(result.map(row => row.id))
  for (const p of await recipientTaskParticipations(session.authUserId)) {
    if (p.question_id && questionIds.has(p.question_id)) continue
    result.push({ id: p.task_id, kind: 'task', title: text(p.snapshot?.title) || 'Delat uppdrag',
      contextLabel: text(p.snapshot?.contextLabel), status: p.snapshot?.closed ? 'closed' : 'open', href: `/mina-uppdrag/delade-uppdrag/${p.task_id}`, sharedAt: p.shared_until })
  }
  // Recheck membership after assembling the public projections. No bearer URL,
  // participant nonce or private question body is ever included in this result.
  const current = await all<QuestionScope>((from, to) => db.rpc('resolve_recipient_question_scope', { p_auth_user_id: session.authUserId, p_question_id: null }).order('id').range(from, to))
  const active = new Set(current.map(row => row.question_id))
  const taskAccess = new Set((await recipientTaskParticipations(session.authUserId)).map(row => row.task_id))
  return result.filter(row => row.kind === 'question' ? active.has(row.id) : taskAccess.has(row.id))
    .sort((a, b) => b.sharedAt.localeCompare(a.sharedAt) || a.id.localeCompare(b.id))
}

export async function getRecipientTaskParticipation(session: RecipientPortalSession, taskId: string) {
  const scope = (await recipientTaskParticipations(session.authUserId, taskId))[0]
  if (!scope) throw new Error('TASK_NOT_FOUND')
  const db = createSupabaseAdminClient()
  const task = await db.from('operational_tasks').select('issuer_profile_id').eq('org_id', scope.org_id).eq('id', taskId).maybeSingle()
  checked(task.error)
  if (!task.data) throw new Error('TASK_NOT_FOUND')
  const issuerProfileId = task.data.issuer_profile_id
  const events = await all<Record<string, unknown>>((from, to) => db.from('task_events').select('id,event_type,actor_type,actor_contact_id,actor_name,message,created_at')
    .eq('org_id', scope.org_id).eq('task_id', taskId).gte('created_at', scope.shared_from).lte('created_at', scope.shared_until)
    .in('event_type', ['comment', 'status_changed', 'deadline_change_requested', 'deadline_change_approved', 'deadline_change_rejected'])
    .order('created_at').order('id').range(from, to))
  const files = await all<Record<string, unknown>>((from, to) => db.from('task_attachments').select('id,file_name,title,attachment_type,created_at')
    .eq('org_id', scope.org_id).eq('task_id', taskId).lte('created_at', scope.shared_until)
    .or(`uploaded_by_contact_id.eq.${scope.contact_id},and(is_completion_evidence.eq.false,uploaded_by_profile_id.eq.${issuerProfileId})`)
    .order('created_at').order('id').range(from, to))
  if (!(await recipientTaskParticipations(session.authUserId, taskId)).some(row => row.grant_id === scope.grant_id)) throw new Error('TASK_NOT_FOUND')
  return {
    id: taskId, title: text(scope.snapshot?.title) || 'Delat uppdrag', description: text(scope.snapshot?.description),
    contextLabel: text(scope.snapshot?.contextLabel), sharedUntil: scope.shared_until,
    events: rows<{ id: string; event_type: string; actor_type: string; actor_contact_id: string | null; actor_name: string; message: string | null; created_at: string }>(events)
      .filter(row => row.actor_type === 'profile' || row.actor_contact_id === scope.contact_id || row.event_type !== 'comment')
      .map(row => ({ id: row.id, actorName: row.actor_name, message: text(row.message), createdAt: row.created_at })),
    files: rows<{ id: string; file_name: string; title: string | null; attachment_type: string }>(files)
      .map(row => ({ id: row.id, name: row.file_name || row.title || 'Bilaga', type: row.attachment_type })),
  }
}

export async function recipientQuestionTaskLinks(session: RecipientPortalSession, questionId: string) {
  const member = await recipientQuestionMember(session.authUserId, questionId), db = createSupabaseAdminClient()
  const events = await all<{ task_id: string | null }>((from, to) => db.from('action_case_question_events').select('id,task_id')
    .eq('org_id', member.org_id).eq('question_id', questionId).not('task_id', 'is', null).order('id').range(from, to))
  const taskIds = new Set(events.map(row => row.task_id))
  const owned = await all<{ task_id: string }>((from, to) => db.rpc('resolve_task_recipient_portal_scope', { p_auth_user_id: session.authUserId, p_task_id: null }).order('grant_id').range(from, to))
  const active = owned.filter(row => taskIds.has(row.task_id))
  const prior = (await recipientTaskParticipations(session.authUserId)).filter(row => row.question_id === questionId && !active.some(item => item.task_id === row.task_id))
  await recipientQuestionMember(session.authUserId, questionId)
  return [...active.map(row => ({ id: row.task_id, href: `/mina-uppdrag/uppdrag/${row.task_id}`, label: 'Mitt enskilda uppdrag' })),
    ...prior.map(row => ({ id: row.task_id, href: `/mina-uppdrag/delade-uppdrag/${row.task_id}`, label: 'Mitt tidigare uppdrag och dess historik' }))]
}

export async function recipientParticipationFile(session: RecipientPortalSession, taskId: string, fileId: string) {
  if (!questionUuid(fileId)) throw new Error('TASK_NOT_FOUND')
  const scope = (await recipientTaskParticipations(session.authUserId, taskId))[0]
  if (!scope) throw new Error('TASK_NOT_FOUND')
  const db = createSupabaseAdminClient()
  const task = await db.from('operational_tasks').select('issuer_profile_id').eq('org_id', scope.org_id).eq('id', taskId).maybeSingle()
  checked(task.error)
  if (!task.data) throw new Error('TASK_NOT_FOUND')
  const file = await db.from('task_attachments').select('storage_bucket,file_path').eq('org_id', scope.org_id).eq('task_id', taskId).eq('id', fileId)
    .lte('created_at', scope.shared_until).or(`uploaded_by_contact_id.eq.${scope.contact_id},and(is_completion_evidence.eq.false,uploaded_by_profile_id.eq.${task.data.issuer_profile_id})`).maybeSingle()
  checked(file.error)
  if (!file.data?.storage_bucket || !file.data.file_path) throw new Error('TASK_NOT_FOUND')
  const signed = await db.storage.from(file.data.storage_bucket).createSignedUrl(file.data.file_path, 60)
  checked(signed.error)
  if (!signed.data?.signedUrl || !(await recipientTaskParticipations(session.authUserId, taskId)).some(row => row.grant_id === scope.grant_id)) throw new Error('TASK_NOT_FOUND')
  return signed.data.signedUrl
}
