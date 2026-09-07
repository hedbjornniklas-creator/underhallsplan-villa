import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getCaseAccessByToken, requireRenoAppViewerContext } from '@/lib/renoapp/server'
import { getRulesRow } from '@/lib/renoapp/renovationRulesServer'
import { RULES_BUCKET } from '@/lib/renoapp/renovationRules'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse('Dokumentet hittades inte.', { status: 404 })
    const row = await getRulesRow(id)
    const admin = createSupabaseAdminClient()
    const { data: brf, error } = await admin.from('brf_associations')
      .select('renovation_rules_version_id,is_public_apply_enabled').eq('id', row.brf_id).single()
    if (error) throw error
    let allowed = brf.is_public_apply_enabled && brf.renovation_rules_version_id === id
    const url = new URL(request.url)
    const token = url.searchParams.get('token')
    if (!allowed && token) {
      const access = await getCaseAccessByToken(token)
      if (access?.state === 'open' && access.access.allowedActions.includes('read')) {
        const { data: linkedCase } = await admin.from('renovation_cases')
          .select('brf_id,rules_version_id').eq('id', access.case.id).single()
        allowed = linkedCase?.brf_id === row.brf_id && (linkedCase.rules_version_id === id || brf.renovation_rules_version_id === id)
      }
    }
    if (!allowed) {
      const viewer = await requireRenoAppViewerContext().catch(() => null)
      allowed = viewer?.accessibleBrfIds?.includes(row.brf_id) === true
    }
    if (!allowed) return new NextResponse('Du saknar tillgång till dokumentet.', { status: 403 })
    if (row.format !== 'pdf' || !row.file_path) return new NextResponse('PDF saknas.', { status: 404 })
    const { data, error: signedError } = await admin.storage.from(RULES_BUCKET).createSignedUrl(row.file_path, 120,
      url.searchParams.get('download') === '1' ? { download: row.file_name || 'Renoveringsregler.pdf' } : undefined)
    if (signedError || !data) throw signedError
    return NextResponse.redirect(data.signedUrl, { headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' } })
  } catch {
    return new NextResponse('Dokumentet kunde inte hämtas. Försök igen.', { status: 404 })
  }
}
