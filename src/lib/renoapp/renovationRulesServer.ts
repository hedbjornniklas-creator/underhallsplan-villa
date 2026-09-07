import 'server-only'
import { randomUUID } from 'node:crypto'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { RULES_BUCKET, RULES_MAX_FILE_BYTES, RULES_MAX_TEXT_LENGTH, type RenovationRulesAcceptance, type RenovationRulesVersion } from './renovationRules'

type RulesRow = {
  id: string; brf_id: string; version: number; format: 'text' | 'pdf'; body: string | null
  file_path: string | null; file_name: string | null; published_at: string
}
const fields = 'id,brf_id,version,format,body,file_path,file_name,published_at'

function mapVersion(row: RulesRow): RenovationRulesVersion {
  return { id: row.id, brfId: row.brf_id, version: row.version, format: row.format,
    body: row.body, fileName: row.file_name, publishedAt: row.published_at }
}

export async function getRulesRow(id: string): Promise<RulesRow> {
  const { data, error } = await createSupabaseAdminClient().from('renoapp_brf_rules_versions').select(fields).eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('RULES_NOT_FOUND')
  return data as RulesRow
}

export async function getPublishedRules(brfId: string): Promise<RenovationRulesVersion | null> {
  const { data, error } = await createSupabaseAdminClient().from('brf_associations')
    .select('renovation_rules_version_id').eq('id', brfId).single()
  if (error) throw new Error(error.message)
  return data.renovation_rules_version_id ? mapVersion(await getRulesRow(data.renovation_rules_version_id)) : null
}

// Only expose unpublished versions after checking the user's access to the BRF.
export async function getLatestSavedRules(brfId: string): Promise<RenovationRulesVersion | null> {
  const { data, error } = await createSupabaseAdminClient().from('renoapp_brf_rules_versions')
    .select(fields).eq('brf_id', brfId).order('version', { ascending: false }).limit(1).maybeSingle()
  if (error) throw new Error(error.message)
  return data ? mapVersion(data as RulesRow) : null
}

// Call only after the caller has verified access to the case.
export async function getCaseRulesAcceptance(caseId: string): Promise<RenovationRulesAcceptance> {
  const { data, error } = await createSupabaseAdminClient().from('renovation_cases')
    .select('rules_version_id,rules_accepted_at,rules_accepted_name,rules_accepted_email,rules_checked_at').eq('id', caseId).single()
  if (error) throw new Error(error.message)
  return {
    version: data.rules_version_id ? mapVersion(await getRulesRow(data.rules_version_id)) : null,
    acceptedAt: data.rules_accepted_at, acceptedName: data.rules_accepted_name,
    acceptedEmail: data.rules_accepted_email, checkedAt: data.rules_checked_at,
  }
}

export async function prepareRulesUpload(brfId: string, actorId: string) {
  const path = `${brfId}/uploads/${actorId}/${randomUUID()}.pdf`
  const { data, error } = await createSupabaseAdminClient().storage.from(RULES_BUCKET).createSignedUploadUrl(path, { upsert: false })
  if (error || !data) throw new Error(error?.message ?? 'RULES_UPLOAD_INVALID')
  return { bucket: RULES_BUCKET, path, token: data.token }
}

export async function publishRules(input: {
  brfId: string; actorId: string; expectedVersion: string | null; format: 'text' | 'pdf' | 'none'
  body?: string; uploadPath?: string; fileName?: string; reuseVersionId?: string
}) {
  const admin = createSupabaseAdminClient()
  let content: Record<string, string> | null = null
  let publishedPath: string | null = null
  if (input.format === 'text') {
    const body = input.body?.trim() ?? ''
    if (!body || body.length > RULES_MAX_TEXT_LENGTH) throw new Error('RULES_TEXT_REQUIRED')
    content = { format: 'text', body }
  } else if (input.format === 'pdf' && input.reuseVersionId && !input.uploadPath) {
    const saved = await getRulesRow(input.reuseVersionId)
    if (saved.brf_id !== input.brfId) throw new Error('RULES_FORBIDDEN')
    if (saved.format !== 'pdf' || !saved.file_path?.startsWith(`${input.brfId}/published/`)) throw new Error('RULES_UPLOAD_INVALID')
    // Each version owns a unique path; keep the accepted version's original file intact.
    publishedPath = `${input.brfId}/published/${randomUUID()}.pdf`
    const { error: copyError } = await admin.storage.from(RULES_BUCKET).copy(saved.file_path, publishedPath)
    if (copyError) throw new Error(copyError.message)
    content = { format: 'pdf', file_path: publishedPath, file_name: saved.file_name ?? 'Renoveringsregler.pdf' }
  } else if (input.format === 'pdf') {
    const prefix = `${input.brfId}/uploads/${input.actorId}/`
    if (!input.uploadPath?.startsWith(prefix) || !/^[0-9a-f-]{36}\.pdf$/.test(input.uploadPath.slice(prefix.length))) {
      throw new Error('RULES_UPLOAD_INVALID')
    }
    const { data: file, error } = await admin.storage.from(RULES_BUCKET).download(input.uploadPath)
    if (error || !file) throw new Error('RULES_UPLOAD_INVALID')
    const bytes = Buffer.from(await file.arrayBuffer())
    if (!bytes.length || bytes.length > RULES_MAX_FILE_BYTES || !bytes.subarray(0, 8).toString('ascii').startsWith('%PDF-')
      || !bytes.subarray(-1024).toString('ascii').includes('%%EOF')) throw new Error('RULES_PDF_INVALID')
    publishedPath = `${input.brfId}/published/${randomUUID()}.pdf`
    const { error: uploadError } = await admin.storage.from(RULES_BUCKET).upload(publishedPath, bytes, { contentType: 'application/pdf', upsert: false })
    if (uploadError) throw new Error(uploadError.message)
    const fileName = (input.fileName ?? 'Renoveringsregler.pdf').replace(/[\r\n\/\\]/g, '_').slice(0, 200)
    content = { format: 'pdf', file_path: publishedPath, file_name: fileName || 'Renoveringsregler.pdf' }
  }
  const { data: versionId, error } = await admin.rpc('renoapp_publish_brf_rules', {
    p_actor: input.actorId, p_brf_id: input.brfId, p_expected_version: input.expectedVersion, p_content: content,
  })
  if (error) {
    // Only clean up after a definite rollback. A timed-out RPC may still commit later.
    const rolledBack = error.message === 'RULES_VERSION_CHANGED' || ['23514', '23503', '23505', '22P02'].includes(error.code)
    if (publishedPath && rolledBack) {
      const check = await admin.from('renoapp_brf_rules_versions').select('id').eq('file_path', publishedPath).maybeSingle()
      if (!check.error && !check.data) await admin.storage.from(RULES_BUCKET).remove([publishedPath])
    }
    throw new Error(error.message)
  }
  if (input.format === 'pdf' && input.uploadPath) await admin.storage.from(RULES_BUCKET).remove([input.uploadPath])
  return versionId ? mapVersion(await getRulesRow(versionId)) : null
}
