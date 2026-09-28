import { NextResponse } from 'next/server'
import { hashAssignmentToken } from '@/lib/assignments/tokens'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { isReportSnapshotPayloadV1 } from '@/lib/report/reportSnapshotPayload'
import { environmentalFileResponse } from '@/lib/ob/environmentalServer'
import type { EnvironmentalAppendix } from '@/lib/ob/environmentalProtocol'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params
  if (token.length < 20 || token.length > 200) return new NextResponse(null, { status: 404 })
  const { data, error } = await createSupabaseAdminClient().from('inspection_report_links')
    .select('inspection_id,org_id,revoked_at,snapshot_payload').eq('token_hash', hashAssignmentToken(token)).maybeSingle()
  if (error) return new NextResponse(null, { status: 503 })
  if (!data || data.revoked_at || !isReportSnapshotPayloadV1(data.snapshot_payload)) return new NextResponse(null, { status: 404 })
  const appendices = data.snapshot_payload.reportData.mock?.appendices?.environmental as EnvironmentalAppendix[] | undefined
  const fileId = new URL(request.url).searchParams.get('file')
  // Resolve exclusively from the immutable snapshot, never the current protocol or a caller-supplied path.
  const file = (Array.isArray(appendices) ? appendices : []).flatMap(appendix => appendix.files || []).find(file => file.id === fileId)
  if (!file || !file.path.startsWith(`${data.org_id}/${data.inspection_id}/`) || file.path.includes('..')) return new NextResponse(null, { status: 404 })
  return environmentalFileResponse(file)
}
