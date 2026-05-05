import { NextRequest, NextResponse } from 'next/server'

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'
const TEST_MODEL = 'gpt-4o-mini'

type OpenAiResponse = {
  output_text?: string
  output?: Array<{
    content?: Array<{
      type?: string
      text?: string
    }>
  }>
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

export async function POST(request: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'OPENAI_API_KEY saknas på servern.' },
      { status: 500 }
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'Ogiltig JSON-body.' },
      { status: 400 }
    )
  }

  const text =
    body && typeof body === 'object' && 'text' in body
      ? String((body as { text?: unknown }).text ?? '').trim()
      : ''

  if (!text) {
    return NextResponse.json(
      { error: 'text måste anges.' },
      { status: 400 }
    )
  }

  try {
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: TEST_MODEL,
        instructions:
          'Du är ett kort test av AI-kopplingen i en svensk besiktningsapp. Svara med högst två meningar.',
        input: text,
        max_output_tokens: 120,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[api/ai/test] OpenAI request failed', {
        status: response.status,
        body: errorText.slice(0, 500),
      })
      return NextResponse.json(
        { error: 'OpenAI-anropet misslyckades.' },
        { status: 500 }
      )
    }

    const payload = (await response.json()) as OpenAiResponse
    const result = extractText(payload)

    return NextResponse.json({
      model: TEST_MODEL,
      result: result || 'Modellen returnerade inget textsvar.',
    })
  } catch (error) {
    console.error('[api/ai/test] unexpected error', error)
    return NextResponse.json(
      { error: 'Kunde inte anropa OpenAI.' },
      { status: 500 }
    )
  }
}
