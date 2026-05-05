import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { rebuildControlPointSearchIndex } from '@/lib/ai/controlPointSearchIndex'

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
    force?: unknown
  }

  try {
    const result = await rebuildControlPointSearchIndex(apiKey, {
      force: body.force === true,
    })
    return NextResponse.json(result)
  } catch (error) {
    console.error('[api/ai/control-point-search-index/rebuild] failed', error)
    return NextResponse.json(
      {
        error: 'Kunde inte bygga AI-indexet.',
        details: error instanceof Error ? error.message : 'Okant fel.',
      },
      { status: 500 }
    )
  }
}
