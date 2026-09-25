import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireOrgContext } from '@/lib/assignments/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { loadObOverview } from '@/lib/ob/overviewLoader'
import { InvalidOverviewQuery, parseOverviewQuery } from '@/lib/ob/overviewQuery'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'private, no-store' }
  try {
    const context = await requireOrgContext()
    const options = parseOverviewQuery(new URL(request.url).searchParams)
    const page = await loadObOverview({
      userClient: createSupabaseServerClient() as unknown as SupabaseClient,
      orgId: context.orgId, options,
    })
    return NextResponse.json(page, { headers })
  } catch (error) {
    if (error instanceof InvalidOverviewQuery) return NextResponse.json({ error: error.message }, { status: 400, headers })
    const code = error instanceof Error ? error.message : ''
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Logga in igen för att läsa dina uppdrag.' }, { status: 401, headers })
    if (code === 'ORG_MEMBERSHIP_REQUIRED') return NextResponse.json({ error: 'Du saknar tillgång till organisationens uppdrag.' }, { status: 403, headers })
    console.error('[ob.overview] Could not load overview', error)
    return NextResponse.json({ error: 'Uppdragslistan kunde inte hämtas. Försök igen.' }, { status: 500, headers })
  }
}
