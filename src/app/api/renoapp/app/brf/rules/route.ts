import { NextResponse } from 'next/server'
import { requireRenoAppViewerContext } from '@/lib/renoapp/server'
import { getPublishedRules, prepareRulesUpload, publishRules } from '@/lib/renoapp/renovationRulesServer'
import { RULES_ERRORS } from '@/lib/renoapp/renovationRules'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function authorize(brfId: string) {
  const context = await requireRenoAppViewerContext()
  if (!context.accessibleBrfIds?.includes(brfId)) throw new Error('RULES_FORBIDDEN')
  return context.profile.id
}

function failure(error: unknown) {
  const code = error instanceof Error ? error.message : ''
  const known = RULES_ERRORS[code]
  if (known) return NextResponse.json({ error: known.message, code }, { status: known.status })
  if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Logga in för att fortsätta.' }, { status: 401 })
  if (code === 'RENOAPP_MEMBERSHIP_REQUIRED' || code === 'PROFILE_NOT_FOUND') {
    return NextResponse.json({ error: 'Du saknar tillgång till föreningen.' }, { status: 403 })
  }
  console.error('[renoapp.rules]', code)
  return NextResponse.json({ error: 'Kunde inte hantera renoveringsreglerna. Försök igen.' }, { status: 500 })
}

export async function GET(request: Request) {
  try {
    const brfId = new URL(request.url).searchParams.get('brfId') ?? ''
    await authorize(brfId)
    return NextResponse.json({ rules: await getPublishedRules(brfId) })
  } catch (error) { return failure(error) }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>
    const brfId = String(body.brfId ?? '')
    const actorId = await authorize(brfId)
    if (body.action === 'prepare_upload') {
      return NextResponse.json({ upload: await prepareRulesUpload(brfId, actorId) })
    }
    if (body.action !== 'publish' || !['text', 'pdf', 'none'].includes(String(body.format))) {
      return NextResponse.json({ error: 'Ogiltigt val.' }, { status: 400 })
    }
    const rules = await publishRules({
      brfId, actorId, expectedVersion: typeof body.expectedVersion === 'string' ? body.expectedVersion : null,
      format: body.format as 'text' | 'pdf' | 'none',
      body: typeof body.body === 'string' ? body.body : undefined,
      uploadPath: typeof body.uploadPath === 'string' ? body.uploadPath : undefined,
      fileName: typeof body.fileName === 'string' ? body.fileName : undefined,
    })
    return NextResponse.json({ rules })
  } catch (error) { return failure(error) }
}
