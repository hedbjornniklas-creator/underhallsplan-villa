import { NextResponse } from 'next/server'
import { getDashboardData } from '@/lib/dashboard/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const headers = { 'Cache-Control': 'private, no-store' }

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams
    if ([...params.keys()].some(key => key !== 'orgId') || params.getAll('orgId').length > 1) {
      return NextResponse.json({ error: 'Välj en giltig organisation.' }, { status: 400, headers })
    }
    return NextResponse.json(await getDashboardData(params.has('orgId') ? params.get('orgId') : undefined), { headers })
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Logga in igen för att läsa översikten.' }, { status: 401, headers })
    if (code === 'ORG_SELECTION_INVALID') return NextResponse.json({ error: 'Välj en giltig organisation.' }, { status: 400, headers })
    if (code === 'DASHBOARD_ORGANIZATION_UNSUPPORTED') {
      return NextResponse.json({ error: 'Startsidan visar din standardorganisation. Öppna respektive arbetsområde för att byta organisation.' }, { status: 400, headers })
    }
    if (code === 'ORG_MEMBERSHIP_REQUIRED' || code === 'MODULE_ACCESS_REQUIRED') {
      return NextResponse.json({ error: 'Du saknar behörighet till den valda organisationens översikt.' }, { status: 403, headers })
    }
    console.error('[dashboard] Could not load overview', error)
    return NextResponse.json({ error: 'Översikten kunde inte hämtas. Försök igen.' }, { status: 500, headers })
  }
}
