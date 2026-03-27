import { NextResponse } from 'next/server'
import { getRenoAppPublicConfig } from '@/lib/renoapp/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

type RouteContext = {
  params: Promise<{
    slug: string
  }>
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { slug } = await context.params
    const config = await getRenoAppPublicConfig(slug)

    if (!config) {
      return jsonError('BRF hittades inte eller har inte publik ansökan aktiverad.', 404)
    }

    return NextResponse.json(config)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    return jsonError(message || 'Kunde inte hämta publik BRF-konfiguration.', 500)
  }
}
