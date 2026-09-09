import 'server-only'

import sharp from 'sharp'
import type { createSupabaseAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createSupabaseAdminClient>
type Content = { type: 'input_text'; text: string } | { type: 'input_image'; image_url: string; detail: 'high' } | { type: 'input_file'; filename: string; file_data: string }
const MAX_FILES = 20
const MAX_BYTES = 25 * 1024 * 1024
const DOCUMENT_TYPES = new Set([
  'application/pdf', 'text/plain', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])

export async function loadCostingAiFiles(admin: Admin, context: { orgId: string; caseId: string }, item: { id: string; scope_attachment_ids?: string[] | null }): Promise<Content[]> {
  try { return await readFiles(admin, context, item) }
  catch (error) {
    if (error instanceof Error && error.message === 'ACTION_CASE_AI_FILES_TOO_LARGE') throw error
    throw new Error('ACTION_CASE_AI_FILE_UNREADABLE')
  }
}

async function readFiles(admin: Admin, context: { orgId: string; caseId: string }, item: { id: string; scope_attachment_ids?: string[] | null }): Promise<Content[]> {
  const selected = item.scope_attachment_ids
  if (selected && selected.length > MAX_FILES) throw new Error('ACTION_CASE_AI_FILES_TOO_LARGE')
  if (selected?.length === 0) return []
  let query = admin.from('action_case_attachments')
    .select('id,attachment_type,file_name,title,content_type,file_size_bytes,storage_bucket,file_path')
    .eq('org_id', context.orgId).eq('action_case_id', context.caseId)
  query = selected ? query.in('id', selected) : query.eq('action_case_item_id', item.id)
  const { data: files, error } = await query.order('id').limit(MAX_FILES + 1)
  if (error || !files || (selected && (files.length !== selected.length || files.some((file) => !selected.includes(file.id))))) throw new Error('ACTION_CASE_AI_FILE_UNREADABLE')
  if (files.length > MAX_FILES || files.reduce((sum, file) => sum + Number(file.file_size_bytes), 0) > MAX_BYTES) throw new Error('ACTION_CASE_AI_FILES_TOO_LARGE')
  const content: Content[] = []
  let bytes = 0
  for (const file of files) {
    // Only existing, tenant-scoped storage objects; never follow a URL from the request or document.
    if (file.storage_bucket !== 'action-case-files' || !file.file_path.startsWith(`${context.orgId}/${context.caseId}/`)) throw new Error('ACTION_CASE_AI_FILE_UNREADABLE')
    const { data, error: downloadError } = await admin.storage.from(file.storage_bucket).download(file.file_path)
    if (downloadError || !data?.size) throw new Error('ACTION_CASE_AI_FILE_UNREADABLE')
    bytes += data.size
    if (bytes > MAX_BYTES) throw new Error('ACTION_CASE_AI_FILES_TOO_LARGE')
    const buffer = Buffer.from(await data.arrayBuffer())
    const name = String(file.file_name).replace(/[\u0000-\u001f\u007f/\\]+/g, '_').slice(0, 180)
    content.push({ type: 'input_text', text: JSON.stringify({ attachmentId: file.id, fileName: name, title: file.title }) })
    try {
      if (file.attachment_type === 'image') {
        const image = await sharp(buffer, { limitInputPixels: 40_000_000 }).rotate()
          .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 80 }).toBuffer()
        content.push({ type: 'input_image', image_url: `data:image/jpeg;base64,${image.toString('base64')}`, detail: 'high' })
      } else if (DOCUMENT_TYPES.has(file.content_type)) {
        content.push({ type: 'input_file', filename: name, file_data: `data:${file.content_type};base64,${buffer.toString('base64')}` })
      } else throw new Error('Unsupported file type')
    } catch { throw new Error('ACTION_CASE_AI_FILE_UNREADABLE') }
  }
  return content
}
