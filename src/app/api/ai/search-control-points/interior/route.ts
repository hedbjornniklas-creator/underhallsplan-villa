import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  CONTROL_POINT_EMBEDDING_MODEL,
  getControlPointSearchIndexCount,
  rebuildControlPointSearchIndex,
  searchControlPointIndex,
} from '@/lib/ai/controlPointSearchIndex'

const MAX_LIMIT = 15

export async function POST(request: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'OPENAI_API_KEY saknas pa servern.' },
      { status: 500 }
    )
  }

  const supabase = createSupabaseServerClient()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) {
    return NextResponse.json({ error: 'Inloggning kravs.' }, { status: 401 })
  }

  const body = (await request.json().catch(() => ({}))) as {
    query?: unknown
    limit?: unknown
  }
  const query = String(body.query ?? '').trim()
  const limit = Math.min(
    Math.max(Number(body.limit ?? 10) || 10, 1),
    MAX_LIMIT
  )

  if (query.length < 2) {
    return NextResponse.json(
      { error: 'query maste vara minst 2 tecken.' },
      { status: 400 }
    )
  }

  try {
    let rebuiltIndex = false
    const indexCount = await getControlPointSearchIndexCount()
    if (indexCount === 0) {
      await rebuildControlPointSearchIndex(apiKey)
      rebuiltIndex = true
    }

    const results = await searchControlPointIndex(apiKey, query, limit)
    return NextResponse.json({
      model: CONTROL_POINT_EMBEDDING_MODEL,
      index_rebuilt: rebuiltIndex,
      results,
    })
  } catch (error) {
    console.error('[api/ai/search-control-points/interior] embedding search failed', error)
    const message = error instanceof Error ? error.message : 'Okant fel.'
    return NextResponse.json(
      {
        error:
          'AI-sokningen misslyckades. Kontrollera att SQL-migrationen for AI-indexet ar kord.',
        details: message,
      },
      { status: 500 }
    )
  }
}
