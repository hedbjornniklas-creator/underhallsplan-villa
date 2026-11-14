import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { instructionSaveRequest, instructionUuid, type InstructionFile, type InstructionReceipt, type InstructionVersion, type InstructionWorkspace } from './workInstructions'

type Context = { orgId: string; userId: string }
function checked(error: { code?: string; message?: string } | null) {
  if (!error) return
  if (['42P01', '42703', '42883', 'PGRST202', 'PGRST205'].includes(error.code || '')) throw new Error('WORK_INSTRUCTIONS_SCHEMA')
  throw new Error(error.message?.match(/WORK_INSTRUCTIONS_[A-Z_]+|ACTION_CASE_FILE_[A-Z_]+/)?.[0] || 'WORK_INSTRUCTIONS_FAILED')
}
async function access(ctx: Context, caseId: string, itemId: string) {
  if (!instructionUuid(caseId) || !instructionUuid(itemId)) throw new Error('WORK_INSTRUCTIONS_INVALID')
  const db = createSupabaseAdminClient()
  const member = await db.from('org_members').select('profile_id').eq('org_id', ctx.orgId).eq('profile_id', ctx.userId).eq('is_active', true).maybeSingle()
  checked(member.error)
  if (!member.data) throw new Error('WORK_INSTRUCTIONS_FORBIDDEN')
  const project = await db.from('action_cases').select('id,status').eq('org_id', ctx.orgId).eq('id', caseId).maybeSingle()
  checked(project.error)
  const item = await db.from('action_case_items').select('id').eq('org_id', ctx.orgId).eq('action_case_id', caseId).eq('id', itemId).maybeSingle()
  checked(item.error)
  if (!project.data || !item.data) throw new Error('WORK_INSTRUCTIONS_NOT_FOUND')
  return { db, readOnly: ['completed', 'cancelled'].includes(project.data.status) }
}
type StoredFile = { position: number; revision: number; attachment_id: string | null; diary_photo_id: string | null; file_name: string; content_type: string; file_size_bytes: number }
async function versionFiles(db: ReturnType<typeof createSupabaseAdminClient>, itemId: string, revisions: number[]) {
  const rows: StoredFile[] = []
  for (let offset = 0; offset < revisions.length * 50; offset += 500) {
    const result = await db.from('action_case_instruction_files').select('*').eq('item_id', itemId).in('revision', revisions).order('revision').order('position').range(offset, offset + 499)
    checked(result.error); rows.push(...(result.data || []))
    if ((result.data || []).length < 500) break
  }
  return rows
}
function fileView(caseId: string, row: StoredFile, stamp: string): InstructionFile {
  const diary = Boolean(row.diary_photo_id), id = (row.diary_photo_id || row.attachment_id)!
  return { id: diary ? `diary:${id}` : id, sourceId: id, source: diary ? 'diary' : 'project', actionCaseItemId: null,
    type: row.content_type.startsWith('image/') ? 'image' : 'document', title: null, fileName: row.file_name,
    contentType: row.content_type, fileSizeBytes: Number(row.file_size_bytes), grantedParticipantIds: [], createdAt: stamp,
    url: `/api/action-cases/${caseId}/${diary ? 'diary/photos' : 'attachments'}/${id}` }
}
export async function getWorkInstructions(ctx: Context, caseId: string, itemId: string): Promise<InstructionWorkspace> {
  const { db, readOnly } = await access(ctx, caseId, itemId)
  const latest = await db.from('action_case_instruction_versions').select('revision,body,created_at,actor_name').eq('org_id', ctx.orgId).eq('action_case_id', caseId).eq('item_id', itemId).order('revision', { ascending: false }).limit(1)
  checked(latest.error)
  const row = latest.data?.[0]
  const files = await versionFiles(db, itemId, row ? [row.revision] : [])
  const projectFiles: InstructionFile[] = []
  for (let offset = 0; ; offset += 500) {
    const result = await db.from('action_case_attachments').select('id,file_name,title,content_type,file_size_bytes,created_at').eq('org_id', ctx.orgId).eq('action_case_id', caseId).is('question_id', null).order('created_at').order('id').range(offset, offset + 499)
    checked(result.error)
    projectFiles.push(...(result.data || []).map(file => ({ ...fileView(caseId, { ...file, attachment_id: file.id, diary_photo_id: null, position: 0, revision: 0 }, file.created_at), title: file.title })))
    if ((result.data || []).length < 500) break
  }
  return { revision: row?.revision || 0, body: row?.body || { text: '', files: [] }, files: row ? files.map(file => fileView(caseId, file, row.created_at)) : [],
    projectFiles, updatedAt: row?.created_at || null, updatedBy: row?.actor_name || '', cacheScope: `${ctx.orgId}:${ctx.userId}`, readOnly }
}
export async function getWorkInstructionHistory(ctx: Context, caseId: string, itemId: string, before: string | null) {
  const { db } = await access(ctx, caseId, itemId)
  if (before !== null && (!/^[1-9]\d*$/.test(before) || Number(before) > 2147483647)) throw new Error('WORK_INSTRUCTIONS_INVALID')
  let query = db.from('action_case_instruction_versions').select('revision,body,created_at,actor_name').eq('org_id', ctx.orgId).eq('action_case_id', caseId).eq('item_id', itemId)
  if (before) query = query.lt('revision', Number(before))
  const result = await query.order('revision', { ascending: false }).limit(21)
  checked(result.error)
  const rows = (result.data || []).slice(0, 20)
  const files = await versionFiles(db, itemId, rows.map(row => row.revision))
  const versions: InstructionVersion[] = rows.map(row => ({ revision: row.revision, body: row.body, actorName: row.actor_name, createdAt: row.created_at,
    files: files.filter(file => file.revision === row.revision).map(file => fileView(caseId, file, row.created_at)) }))
  return { versions, nextBeforeRevision: (result.data || []).length > 20 ? rows.at(-1)!.revision : null }
}
export async function saveWorkInstructions(ctx: Context, caseId: string, itemId: string, input: unknown): Promise<InstructionReceipt> {
  const { db } = await access(ctx, caseId, itemId)
  const result = await db.rpc('write_work_instructions', { p_org_id: ctx.orgId, p_case_id: caseId, p_item_id: itemId, p_actor_id: ctx.userId, p_data: instructionSaveRequest(input) })
  checked(result.error)
  const receipt = result.data as Omit<InstructionReceipt, 'files'>
  const files = await versionFiles(db, itemId, [receipt.revision])
  return { ...receipt, files: files.map(file => fileView(caseId, file, receipt.createdAt)) }
}
export async function uploadWorkInstructionFile(ctx: Context, caseId: string, itemId: string, input: Record<string, unknown>) {
  const { db, readOnly } = await access(ctx, caseId, itemId)
  if (readOnly) throw new Error('WORK_INSTRUCTIONS_CLOSED')
  const allowed = input.operation === 'prepare' ? ['operation','fileName','contentType','fileSize'] : ['operation','fileName','contentType','fileSize','filePath']
  if (!['prepare','complete'].includes(String(input.operation)) || Object.keys(input).some(key => !allowed.includes(key))) throw new Error('WORK_INSTRUCTIONS_INVALID')
  const { completeActionCaseUpload, createActionCaseSignedUpload } = await import('./server')
  const payload = { caseId, fileName: input.fileName, contentType: input.contentType, fileSize: input.fileSize }
  if (input.operation === 'prepare') return { upload: await createActionCaseSignedUpload(ctx, payload) }
  // Never associate uploads with scope or grant portal access from this endpoint.
  const id = await completeActionCaseUpload(ctx, { ...payload, filePath: input.filePath, itemId: null, participantIds: [] })
  const result = await db.from('action_case_attachments').select('id,file_name,content_type,file_size_bytes,created_at').eq('org_id', ctx.orgId).eq('action_case_id', caseId).eq('id', id).is('question_id', null).maybeSingle()
  checked(result.error)
  if (!result.data) throw new Error('WORK_INSTRUCTIONS_FILES')
  return { file: fileView(caseId, { ...result.data, attachment_id: id, diary_photo_id: null, position: 0, revision: 0 }, result.data.created_at) }
}
