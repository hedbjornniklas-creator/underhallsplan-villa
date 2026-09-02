import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { requireRenoAppViewerContext } from '@/lib/renoapp/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SIGNED_URL_TTL_SECONDS = 120

function notFoundResponse() {
  return new NextResponse('Not found', { status: 404 })
}

type RouteContext = {
  params: Promise<{
    id: string
    documentId: string
  }>
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id, documentId } = await context.params
    const viewer = await requireRenoAppViewerContext()
    const admin = createSupabaseAdminClient()

    const { data: caseRow, error: caseError } = await admin
      .from('renovation_cases')
      .select('id,brf_id')
      .eq('id', id)
      .maybeSingle()

    if (caseError || !caseRow) {
      return notFoundResponse()
    }

    const brfId = String(caseRow.brf_id ?? '')
    if (viewer.authorizedBrfIds && !viewer.authorizedBrfIds.includes(brfId)) {
      return notFoundResponse()
    }

    const { data: documentRow, error: documentError } = await admin
      .from('renovation_case_documents')
      .select('id,case_id,storage_bucket,file_path,file_name')
      .eq('id', documentId)
      .eq('case_id', id)
      .maybeSingle()

    if (documentError || !documentRow) {
      return notFoundResponse()
    }

    const bucket = String(documentRow.storage_bucket ?? '').trim()
    const path = String(documentRow.file_path ?? '').trim()
    const fileName = String(documentRow.file_name ?? 'dokument').trim() || 'dokument'

    if (!bucket || !path) {
      return notFoundResponse()
    }

    const { data, error } = await admin.storage.from(bucket).createSignedUrl(path, SIGNED_URL_TTL_SECONDS, {
      download: fileName,
    })

    if (error || !data?.signedUrl) {
      return notFoundResponse()
    }

    return NextResponse.redirect(data.signedUrl)
  } catch {
    return notFoundResponse()
  }
}
