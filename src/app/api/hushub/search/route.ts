import { NextResponse } from 'next/server'
import { searchHusHub } from '@/lib/globalSearch/server'
import { InvalidGlobalSearchQuery } from '@/lib/globalSearch/model'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' }

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams
    if ([...params.keys()].some(key => key !== 'q' && key !== 'orgId') || params.getAll('q').length !== 1 || params.getAll('orgId').length > 1) {
      return NextResponse.json({ error: 'Ange en giltig sökning och organisation.' }, { status: 400, headers })
    }
    return NextResponse.json(await searchHusHub(params.get('q'), params.has('orgId') ? params.get('orgId') : undefined, request.signal), { headers })
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    if (error instanceof InvalidGlobalSearchQuery) return NextResponse.json({ error: error.message }, { status: 400, headers })
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Logga in igen för att söka i HusHub.' }, { status: 401, headers })
    if (code === 'ORG_SELECTION_INVALID') return NextResponse.json({ error: 'Välj en giltig organisation.' }, { status: 400, headers })
    if (code === 'GLOBAL_SEARCH_ORGANIZATION_UNSUPPORTED') return NextResponse.json({ error: 'Startsidan söker i din standardorganisation. Öppna arbetsområdet för att välja en annan organisation.' }, { status: 400, headers })
    if (code === 'GLOBAL_SEARCH_TIMEOUT') return NextResponse.json({ error: 'Sökningen tog för lång tid. Förfina sökningen eller försök igen.' }, { status: 504, headers })
    if (code === 'GLOBAL_SEARCH_ABORTED') return NextResponse.json({ error: 'Sökningen avbröts.' }, { status: 499, headers })
    if (['ORG_MEMBERSHIP_REQUIRED', 'MODULE_ACCESS_REQUIRED', 'PRODUCT_ACCESS_REQUIRED'].includes(code)) {
      return NextResponse.json({ error: 'Du saknar behörighet till den valda organisationen.' }, { status: 403, headers })
    }
    console.error('[global-search] Search failed', code || 'UNKNOWN')
    return NextResponse.json({ error: 'Sökningen kunde inte hämtas. Försök igen.' }, { status: 500, headers })
  }
}
