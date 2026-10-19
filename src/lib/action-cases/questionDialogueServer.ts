import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { sendTaskAccessLinkEmail } from '@/lib/tasks/automation'
import { buildTaskEmailHtml } from '@/lib/tasks/emailTemplates'
import { dialogueMutation, type QuestionDialogue, type DialogueMessage } from './questionDialogue'
import { parseQuestionLink, questionLinkToken } from './questionDialogueLinks'
import { questionUuid, type QuestionParticipant } from './projectQuestions'

type Context = { orgId: string; userId: string }
type Member = { id: string; org_id: string; action_case_id: string; question_id: string; person_kind: 'profile' | 'contact' | 'customer'; person_id: string; name: string; email: string | null; contact_id: string | null; shared: boolean; link_nonce: string; link_expires_at: string | null }
type ErrorRow = { code?: string; message?: string }
function checked(error: ErrorRow | null) {
  if (!error) return
  if (['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205'].includes(error.code || '')) throw new Error('PROJECT_QUESTION_SCHEMA')
  throw new Error(error.message?.match(/PROJECT_QUESTION_[A-Z_]+/)?.[0] || 'PROJECT_QUESTION_FAILED')
}
async function pages<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: ErrorRow | null }>) {
  const rows: T[] = []
  for (let from = 0; ; from += 500) {
    const result = await query(from, from + 499); checked(result.error); rows.push(...result.data || [])
    if ((result.data?.length ?? 0) < 500) return rows
  }
}
export async function requireQuestionParticipant(ctx: Context, caseId: string, questionId: string) {
  if (!questionUuid(caseId) || !questionUuid(questionId)) throw new Error('PROJECT_QUESTION_INVALID')
  const result = await createSupabaseAdminClient().rpc('project_question_internal_participant', { p_org_id: ctx.orgId, p_case_id: caseId, p_question_id: questionId, p_profile_id: ctx.userId })
  checked(result.error)
  if (result.data !== true) throw new Error('PROJECT_QUESTION_NOT_FOUND')
}
async function publicMember(token: string): Promise<Member> {
  const { participantId, nonce } = parseQuestionLink(token), db = createSupabaseAdminClient()
  const result = await db.from('action_case_question_participants').select('*').eq('id', participantId).eq('link_nonce', nonce).eq('active', true).eq('shared', true).gt('link_expires_at', new Date().toISOString()).maybeSingle()
  checked(result.error)
  const member = result.data as Member | null
  if (!member || member.person_kind === 'profile' || !member.contact_id) throw new Error('PROJECT_QUESTION_NOT_FOUND')
  const contact = await db.from('organization_contacts').select('email,recipient_identity_id').eq('org_id', member.org_id).eq('id', member.contact_id).eq('is_active', true).maybeSingle()
  checked(contact.error)
  if (!contact.data || contact.data.email?.trim().toLowerCase() !== member.email?.trim().toLowerCase()) throw new Error('PROJECT_QUESTION_NOT_FOUND')
  if (contact.data.recipient_identity_id) {
    const identity = await db.from('task_recipient_identities').select('status').eq('id', contact.data.recipient_identity_id).maybeSingle(); checked(identity.error)
    if (!identity.data || identity.data.status === 'disabled') throw new Error('PROJECT_QUESTION_NOT_FOUND')
  }
  return member
}
async function readDialogue(orgId: string, caseId: string, questionId: string, viewerId: string, internal: boolean): Promise<QuestionDialogue> {
  const db = createSupabaseAdminClient()
  const question = await db.from('action_case_questions').select('body').eq('org_id', orgId).eq('action_case_id', caseId).eq('id', questionId).maybeSingle(); checked(question.error)
  const conversation = await db.from('action_case_question_conversations').select('version,shared_body,shared_at').eq('question_id', questionId).maybeSingle(); checked(conversation.error)
  if (!question.data || !conversation.data) throw new Error('PROJECT_QUESTION_NOT_FOUND')
  const participantRows = await pages<Member>((a, b) => db.from('action_case_question_participants').select('*').eq('org_id', orgId).eq('action_case_id', caseId).eq('question_id', questionId).eq('active', true).order('joined_at').order('id').range(a, b))
  const participants: QuestionParticipant[] = participantRows.filter(p => internal || p.shared).map(p => ({ id: p.id, kind: p.person_kind, personId: internal ? p.person_id : '', name: p.name, email: internal ? p.email : null, shared: p.shared }))
  const messages = await pages<Record<string, unknown>>((a, b) => db.from('action_case_question_messages').select('id,participant_id,operation,actor_name,actor_method,message,snapshot,created_at,files:action_case_question_message_files(attachment_id,file_name)').eq('question_id', questionId).in('operation', ['share', 'reply']).order('created_at').order('id').range(a, b))
  const mapped: DialogueMessage[] = messages.map(m => ({ id: String(m.id), participantId: String(m.participant_id), operation: m.operation as DialogueMessage['operation'], actorName: String(m.actor_name), actorMethod: m.actor_method as DialogueMessage['actorMethod'], text: String(m.message), snapshot: m.snapshot as DialogueMessage['snapshot'], createdAt: String(m.created_at), files: ((m.files || []) as Array<{ attachment_id: string; file_name: string }>).map(f => ({ id: f.attachment_id, name: f.file_name })) }))
  let managerId: string | null = null
  let deliveries: QuestionDialogue['deliveries'] = []
  if (internal) {
    const project = await db.from('action_cases').select('manager_profile_id').eq('org_id', orgId).eq('id', caseId).maybeSingle(); checked(project.error)
    managerId = project.data?.manager_profile_id || null
    if (messages.length) {
      const result = await pages<{ id: string; recipient_name: string; status: string }>((a, b) => db.from('action_case_question_deliveries').select('id,recipient_name,status').in('message_id', messages.map(m => String(m.id))).order('id').range(a, b))
      deliveries = result.map(d => ({ id: d.id, name: d.recipient_name, status: d.status }))
    }
  }
  const viewer = participantRows.find(p => internal ? p.person_kind === 'profile' && p.person_id === viewerId : p.id === viewerId && p.shared)
  if (!viewer) throw new Error('PROJECT_QUESTION_NOT_FOUND')
  if (internal) await requireQuestionParticipant({ orgId, userId: viewerId }, caseId, questionId)
  return { questionId, version: conversation.data.version, sharedAt: conversation.data.shared_at, snapshot: conversation.data.shared_body, status: question.data.body.status, managerId, canManage: internal && managerId === viewerId, viewerId: viewer.id, participants, messages: mapped, deliveries }
}
export async function getQuestionDialogue(ctx: Context, caseId: string, questionId: string) {
  await requireQuestionParticipant(ctx, caseId, questionId)
  return readDialogue(ctx.orgId, caseId, questionId, ctx.userId, true)
}
export async function getPublicQuestionDialogue(token: string) {
  const member = await publicMember(token)
  const result = await readDialogue(member.org_id, member.action_case_id, member.question_id, member.id, false)
  await publicMember(token)
  return result
}
export async function writeQuestionDialogue(ctx: Context, caseId: string, questionId: string, body: Record<string, unknown>) {
  await requireQuestionParticipant(ctx, caseId, questionId)
  const result = await createSupabaseAdminClient().rpc('mutate_project_question_dialogue', { p_org_id: ctx.orgId, p_case_id: caseId, p_question_id: questionId, p_profile_id: ctx.userId, p_participant_id: null, p_nonce: null, p_request: dialogueMutation(body) })
  checked(result.error)
  return { messageId: String(result.data), questionId }
}
export async function writePublicQuestionDialogue(token: string, body: Record<string, unknown>) {
  const member = await publicMember(token), request = dialogueMutation(body)
  if (request.operation !== 'reply' || request.fileIds.length) throw new Error('PROJECT_QUESTION_FORBIDDEN')
  const result = await createSupabaseAdminClient().rpc('mutate_project_question_dialogue', { p_org_id: member.org_id, p_case_id: member.action_case_id, p_question_id: member.question_id, p_profile_id: null, p_participant_id: member.id, p_nonce: member.link_nonce, p_request: request })
  checked(result.error)
  return { messageId: String(result.data), questionId: member.question_id }
}
export async function questionDialogueFile(caseId: string, questionId: string, fileId: string, identity: Context | string) {
  const db = createSupabaseAdminClient()
  let orgId: string
  if (typeof identity === 'string') {
    const member = await publicMember(identity)
    if (member.question_id !== questionId || member.action_case_id !== caseId) throw new Error('PROJECT_QUESTION_NOT_FOUND')
    orgId = member.org_id
  } else { await requireQuestionParticipant(identity, caseId, questionId); orgId = identity.orgId }
  if (!questionUuid(fileId)) throw new Error('PROJECT_QUESTION_NOT_FOUND')
  const messages = await pages<{ id: string }>((a, b) => db.from('action_case_question_messages').select('id').eq('question_id', questionId).in('operation', ['share', 'reply']).order('id').range(a, b))
  if (!messages.length) throw new Error('PROJECT_QUESTION_NOT_FOUND')
  const refs = await db.from('action_case_question_message_files').select('attachment_id').eq('attachment_id', fileId).in('message_id', messages.map(m => m.id)).limit(1); checked(refs.error)
  if (!refs.data?.length) throw new Error('PROJECT_QUESTION_NOT_FOUND')
  const file = await db.from('action_case_attachments').select('storage_bucket,file_path').eq('org_id', orgId).eq('action_case_id', caseId).eq('id', fileId).maybeSingle(); checked(file.error)
  if (!file.data) throw new Error('PROJECT_QUESTION_NOT_FOUND')
  const signed = await db.storage.from(file.data.storage_bucket).createSignedUrl(file.data.file_path, 60)
  if (signed.error || !signed.data?.signedUrl) throw new Error('PROJECT_QUESTION_FAILED')
  return signed.data.signedUrl
}
export async function publicQuestionFile(token: string, fileId: string) {
  const member = await publicMember(token)
  return questionDialogueFile(member.action_case_id, member.question_id, fileId, token)
}
function baseUrl() {
  const configured = process.env.APP_BASE_URL?.trim()
  if (!configured) throw new Error('PROJECT_QUESTION_LINK_CONFIG')
  const url = new URL(configured)
  if (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('PROJECT_QUESTION_LINK_CONFIG')
  return url.origin
}
export async function deliverQuestionMessages(questionId?: string) {
  const db = createSupabaseAdminClient(), started = Date.now()
  let sent = 0, failed = 0
  for (let i = 0; i < 5 && Date.now() - started < 7000; i++) {
    const claimed = await db.rpc('claim_project_question_delivery', { p_question_id: questionId || null })
    if (['42883', 'PGRST202'].includes(claimed.error?.code || '')) return { sent, failed }
    checked(claimed.error)
    const delivery = claimed.data?.[0]
    if (!delivery) break
    let providerId: string | null = null
    try {
      const result = await db.from('action_case_question_participants').select('*').eq('id', delivery.participant_id).eq('link_nonce', delivery.link_nonce).eq('active', true).eq('shared', true).maybeSingle(); checked(result.error)
      const member = result.data as Member | null
      if (!member || member.email !== delivery.recipient_email) throw new Error('PROJECT_QUESTION_NOT_FOUND')
      if (member.person_kind === 'profile') await requireQuestionParticipant({ orgId: member.org_id, userId: member.person_id }, member.action_case_id, member.question_id)
      const path = member.person_kind === 'profile' ? `/uppdrag/${member.action_case_id}?view=questions` : `/fraga/${questionLinkToken(member.id, member.link_nonce)}`
      if (member.person_kind !== 'profile') await publicMember(questionLinkToken(member.id, member.link_nonce))
      const url = `${baseUrl()}${path}`
      const mailed = await sendTaskAccessLinkEmail({ to: delivery.recipient_email, replyTo: null, subject: `Projektfråga: ${delivery.question_title}`, text: `${delivery.body_text}\n\n${delivery.question_title}\n\nÖppna frågan: ${url}\n\nPersonlig länk. Vidarebefordra den inte.`, html: buildTaskEmailHtml({ previewText: delivery.body_text, eyebrow: 'Frågor och beslut', heading: delivery.question_title, recipientName: delivery.recipient_name, lead: delivery.body_text, taskTitle: delivery.question_title, itemLabel: 'Fråga', dueLabel: null, actionUrl: url, actionLabel: 'Öppna frågan', notice: 'Den personliga länken ger bara åtkomst till denna fråga. Vidarebefordra den inte.' }), idempotencyKey: `project-question:${delivery.id}` })
      providerId = mailed.providerMessageId; sent++
    } catch { failed++ }
    const finished = await db.rpc('finish_project_question_delivery', { p_id: delivery.id, p_attempt: delivery.attempts, p_provider_id: providerId }); checked(finished.error)
  }
  return { sent, failed }
}
