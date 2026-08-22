import { NextResponse } from 'next/server'
import { getRecipientActivationPreview } from '@/lib/tasks/recipientAuth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ token: string }>
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { token } = await context.params
    const preview = await getRecipientActivationPreview(token)
    if (!preview) {
      return NextResponse.json(
        { error: 'Aktiveringslänken är ogiltig, använd eller har gått ut.' },
        { status: 404, headers: { 'Cache-Control': 'no-store' } }
      )
    }
    return NextResponse.json(preview, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[tasks.recipient.activation.preview] failed', {
      message: error instanceof Error ? error.message : 'UnknownError',
    })
    return NextResponse.json(
      { error: 'Kunde inte läsa aktiveringslänken just nu.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}
