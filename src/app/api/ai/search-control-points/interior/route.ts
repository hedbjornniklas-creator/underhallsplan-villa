import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'
const AI_SEARCH_MODEL = 'gpt-4o-mini'
const MAX_CANDIDATES = 220
const MAX_LIMIT = 15

type ControlPointCandidate = {
  id: string
  key: string
  title: string | null
  label: string | null
  description: string | null
  scope: string | null
  exterior_item_key: string | null
  tags: unknown
  trigger_room_types: unknown
  applies_to: unknown
}

type OutcomeRow = {
  control_point_id: string | null
  label: string | null
  note_template: string | null
  risk_template: string | null
  ftu_template: string | null
}

type OpenAiResponse = {
  output_text?: string
  output?: Array<{
    content?: Array<{
      text?: string
    }>
  }>
}

type AiMatch = {
  id?: unknown
  score?: unknown
  reason?: unknown
}

const extractText = (payload: OpenAiResponse) => {
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim()
  }

  return (
    payload.output
      ?.flatMap(item => item.content ?? [])
      .map(content => content.text)
      .find((text): text is string => typeof text === 'string' && text.trim().length > 0)
      ?.trim() ?? ''
  )
}

const truncate = (value: string | null | undefined, maxLength: number) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

const asStringList = (value: unknown) => {
  if (Array.isArray(value)) {
    return value
      .map(item => String(item ?? '').trim())
      .filter(Boolean)
      .slice(0, 8)
  }
  if (value && typeof value === 'object') {
    return Object.values(value)
      .map(item => String(item ?? '').trim())
      .filter(Boolean)
      .slice(0, 8)
  }
  return []
}

const parseAiMatches = (text: string): AiMatch[] => {
  try {
    const parsed = JSON.parse(text) as { matches?: unknown }
    return Array.isArray(parsed.matches) ? (parsed.matches as AiMatch[]) : []
  } catch {
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return []
    try {
      const parsed = JSON.parse(match[0]) as { matches?: unknown }
      return Array.isArray(parsed.matches) ? (parsed.matches as AiMatch[]) : []
    } catch {
      return []
    }
  }
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'OPENAI_API_KEY saknas på servern.' },
      { status: 500 }
    )
  }

  const supabase = createSupabaseServerClient()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) {
    return NextResponse.json({ error: 'Inloggning krävs.' }, { status: 401 })
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
      { error: 'query måste vara minst 2 tecken.' },
      { status: 400 }
    )
  }

  const { data: controlPoints, error: controlPointsError } = await supabase
    .from('settings_control_points')
    .select('id, key, title, label, description, scope, exterior_item_key, tags, trigger_room_types, applies_to')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .limit(MAX_CANDIDATES)

  if (controlPointsError) {
    console.error('[api/ai/search-control-points/interior] control point fetch failed', controlPointsError)
    return NextResponse.json(
      { error: 'Kunde inte hämta kontrollpunkter.' },
      { status: 500 }
    )
  }

  const candidates = (controlPoints ?? []) as ControlPointCandidate[]
  const candidateIds = candidates.map(candidate => candidate.id)

  const { data: outcomes, error: outcomesError } = candidateIds.length
    ? await supabase
        .from('settings_control_point_outcomes')
        .select('control_point_id, label, note_template, risk_template, ftu_template')
        .eq('is_active', true)
        .in('control_point_id', candidateIds)
    : { data: [], error: null }

  if (outcomesError) {
    console.error('[api/ai/search-control-points/interior] outcomes fetch failed', outcomesError)
    return NextResponse.json(
      { error: 'Kunde inte hämta kontrollpunktsutfall.' },
      { status: 500 }
    )
  }

  const outcomesByControlPointId = ((outcomes ?? []) as OutcomeRow[]).reduce<Record<string, OutcomeRow[]>>(
    (acc, outcome) => {
      if (!outcome.control_point_id) return acc
      const current = acc[outcome.control_point_id] ?? []
      current.push(outcome)
      acc[outcome.control_point_id] = current
      return acc
    },
    {}
  )

  const candidatePayload = candidates.map(candidate => {
    const outcomeText = (outcomesByControlPointId[candidate.id] ?? [])
      .slice(0, 8)
      .map(outcome =>
        [
          outcome.label,
          outcome.note_template,
          outcome.risk_template,
          outcome.ftu_template,
        ]
          .map(value => truncate(value, 140))
          .filter(Boolean)
          .join(' | ')
      )
      .filter(Boolean)
      .join(' / ')

    return {
      id: candidate.id,
      title: candidate.title || candidate.label || candidate.key,
      scope: candidate.scope,
      exterior_item_key: candidate.exterior_item_key,
      text: [
        candidate.key,
        candidate.title,
        candidate.label,
        candidate.description,
        `scope: ${candidate.scope ?? ''}`,
        candidate.exterior_item_key ? `utsidesdel: ${candidate.exterior_item_key}` : '',
        asStringList(candidate.trigger_room_types).join(', '),
        asStringList(candidate.tags).join(', '),
        outcomeText,
      ]
        .map(value => truncate(value, 500))
        .filter(Boolean)
        .join('\n'),
    }
  })

  try {
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: AI_SEARCH_MODEL,
        instructions:
          'Du rankar svenska besiktningskontrollpunkter efter semantisk relevans. Returnera strikt JSON och bara id:n som finns i kandidatlistan.',
        input: JSON.stringify({
          task:
            'Välj de mest relevanta kontrollpunkterna för sökfrasen. Det är okej att föreslå både insida och utsida om det passar specialfallet.',
          query,
          limit,
          response_format: {
            matches: [
              {
                id: 'control_point_id',
                score: 'number 0-1',
                reason: 'kort svensk motivering',
              },
            ],
          },
          candidates: candidatePayload,
        }),
        max_output_tokens: 900,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[api/ai/search-control-points/interior] OpenAI request failed', {
        status: response.status,
        body: errorText.slice(0, 500),
      })
      return NextResponse.json(
        { error: 'AI-sökningen misslyckades.' },
        { status: 500 }
      )
    }

    const payload = (await response.json()) as OpenAiResponse
    const aiText = extractText(payload)
    const candidateById = new Map(candidates.map(candidate => [candidate.id, candidate]))
    const seen = new Set<string>()
    const results = parseAiMatches(aiText)
      .map(match => {
        const id = typeof match.id === 'string' ? match.id : ''
        const candidate = candidateById.get(id)
        if (!candidate || seen.has(id)) return null
        seen.add(id)
        const score = typeof match.score === 'number' ? match.score : null
        const reason = typeof match.reason === 'string' ? match.reason.trim() : ''
        return {
          ...candidate,
          search_hint: [
            score !== null ? `AI-träff ${Math.round(score * 100)}%` : 'AI-träff',
            reason,
          ].filter(Boolean).join(': '),
        }
      })
      .filter((result): result is ControlPointCandidate & { search_hint: string } => Boolean(result))
      .slice(0, limit)

    return NextResponse.json({
      model: AI_SEARCH_MODEL,
      results,
    })
  } catch (error) {
    console.error('[api/ai/search-control-points/interior] unexpected error', error)
    return NextResponse.json(
      { error: 'Kunde inte genomföra AI-sökningen.' },
      { status: 500 }
    )
  }
}
