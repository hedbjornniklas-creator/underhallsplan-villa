import { NextResponse } from 'next/server'
import { requireConsultantReviewAccess } from '@/lib/renoapp/consultantReviewAccess'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { RULES_BUCKET } from '@/lib/renoapp/renovationRules'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ id: string; fileId: string }> }

export async function GET(_request: Request, context: Context) {
  try {
    const { id, fileId } = await context.params
    const order = await requireConsultantReviewAccess(id)
    const admin = createSupabaseAdminClient()
    const caseResult = await admin.from('renovation_cases').select('brf_id,rules_version_id').eq('id', id).single()
    if (caseResult.error || caseResult.data?.brf_id !== order.brf_id) throw new Error('CASE_NOT_FOUND')
    let bucket: string, path: string, name: string
    if (fileId === 'rules') {
      const result = await admin.from('renoapp_brf_rules_versions').select('file_path,file_name')
        .eq('id', caseResult.data.rules_version_id).eq('brf_id', order.brf_id).single()
      if (result.error || !result.data?.file_path) throw new Error('FILE_NOT_FOUND')
      bucket = RULES_BUCKET; path = result.data.file_path; name = result.data.file_name
    } else {
      const result = await admin.from('renovation_case_documents').select('storage_bucket,file_path,file_name')
        .eq('id', fileId).eq('case_id', id).single()
      if (result.error || !result.data) throw new Error('FILE_NOT_FOUND')
      bucket = result.data.storage_bucket; path = result.data.file_path; name = result.data.file_name
    }
    if (!bucket || !path) throw new Error('FILE_NOT_FOUND')
    const signed = await admin.storage.from(bucket).createSignedUrl(path, 120, { download: name || 'dokument' })
    if (signed.error || !signed.data?.signedUrl) throw new Error('FILE_NOT_FOUND')
    return NextResponse.redirect(signed.data.signedUrl, { headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' } })
  } catch {
    return new NextResponse('Filen hittades inte eller så saknar du behörighet.', { status: 404, headers: { 'Cache-Control': 'private, no-store' } })
  }
}
