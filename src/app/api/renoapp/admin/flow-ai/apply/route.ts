import { NextResponse } from 'next/server'
import { applyRenoAppFlowAiChanges } from '@/lib/renoapp/flowAiApplyServer'
import { FlowAiServerError } from '@/lib/renoapp/flowAiServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const ERROR_MESSAGES: Record<string, string> = {
  UNAUTHORIZED: 'Inte inloggad.',
  ADMIN_REQUIRED: 'Endast admin har åtkomst.',
  OPENAI_API_KEY_MISSING: 'AI-funktionen är inte konfigurerad på servern.',
  FLOW_AI_APPLY_REQUEST_INVALID: 'Begäran om att tillämpa förslaget har ett ogiltigt format.',
  FLOW_AI_APPLY_SELECTION_INVALID: 'Välj mellan 1 och 64 unika ändringar.',
  FLOW_AI_APPLY_TOKEN_INVALID: 'Förslaget kan inte verifieras. Skapa ett nytt AI-förslag.',
  FLOW_AI_APPLY_TOKEN_EXPIRED: 'Förslaget har gått ut. Skapa ett nytt AI-förslag.',
  FLOW_AI_APPLY_CHANGE_INVALID: 'En vald ändring har ett ogiltigt format.',
  FLOW_AI_APPLY_DEPENDENCY_MISSING: 'En vald ändring saknar en nödvändig beroendeändring. Välj även den berörda frågan, rollen eller kopplingen.',
  FLOW_AI_APPLY_RISK_ACK_REQUIRED: 'Bekräfta den särskilda granskningen av riskmarkerade ändringar.',
  FLOW_AI_SNAPSHOT_STALE: 'Flödet har ändrats sedan AI-förslaget skapades. Ladda om och skapa ett nytt förslag.',
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const result = await applyRenoAppFlowAiChanges(body)
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const code = error instanceof Error ? error.message : 'FLOW_AI_APPLY_UNKNOWN_ERROR'
    const status = error instanceof FlowAiServerError ? error.status : 500
    const details = error instanceof FlowAiServerError ? error.details : undefined
    if (!(error instanceof FlowAiServerError)) console.error('[renoapp.flow-ai] Apply failed', error)
    return NextResponse.json(
      { error: ERROR_MESSAGES[code] ?? 'Kunde inte tillämpa AI-förslaget.', code, ...(details ?? {}) },
      { status, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}
