import { NextResponse } from 'next/server'
import { FlowAiServerError, generateRenoAppFlowAiProposal } from '@/lib/renoapp/flowAiServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 180

const ERROR_MESSAGES: Record<string, string> = {
  UNAUTHORIZED: 'Inte inloggad.',
  ADMIN_REQUIRED: 'Endast admin har åtkomst.',
  PROFILE_NOT_FOUND: 'Ingen profil hittades för användaren.',
  FLOW_AI_REQUEST_INVALID: 'Begäran har ett ogiltigt format.',
  FLOW_AI_INSTRUCTION_REQUIRED: 'Skriv vad AI:n ska skapa eller granska.',
  FLOW_AI_INSTRUCTION_TOO_LONG: 'Instruktionen är för lång.',
  FLOW_AI_SNAPSHOT_INVALID: 'Flödesunderlaget är ofullständigt. Ladda om sidan och försök igen.',
  FLOW_AI_SNAPSHOT_CIRCULAR: 'Flödesunderlaget innehåller en ogiltig cirkulär referens.',
  FLOW_AI_SNAPSHOT_TOO_LARGE: 'Flödesunderlaget är för stort för AI-granskning.',
  FLOW_AI_FINGERPRINT_INVALID: 'Flödesversionen har ett ogiltigt format.',
  FLOW_AI_OPTIMISTIC_LOCK_INCOMPLETE: 'Flödesunderlag och versionsfingeravtryck måste skickas tillsammans.',
  FLOW_AI_FINGERPRINT_MISMATCH: 'Flödesversionen stämmer inte med underlaget. Ladda om sidan.',
  FLOW_AI_SNAPSHOT_STALE: 'Flödet har ändrats sedan sidan laddades. Ladda om innan du granskar med AI.',
  FLOW_AI_ACTION_TYPE_REQUIRED: 'Välj vilket flöde som ska granskas eller utökas.',
  OPENAI_API_KEY_MISSING: 'AI-funktionen är inte konfigurerad på servern ännu.',
  OPENAI_EMPTY_RESPONSE: 'AI:n returnerade inget granskningsförslag.',
  OPENAI_INVALID_RESPONSE: 'AI:n returnerade ett granskningsförslag med ogiltigt format.',
  OPENAI_REQUEST_TIMEOUT: 'AI-granskningen tog för lång tid. Försök igen.',
  OPENAI_REQUEST_FAILED: 'AI-tjänsten kunde inte skapa ett förslag just nu.',
}

function defaultStatus(code: string) {
  if (code === 'UNAUTHORIZED') return 401
  if (code === 'ADMIN_REQUIRED' || code === 'PROFILE_NOT_FOUND') return 403
  return 500
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const response = await generateRenoAppFlowAiProposal(body)
    return NextResponse.json(response, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    const code = error instanceof Error ? error.message : 'FLOW_AI_UNKNOWN_ERROR'
    const status = error instanceof FlowAiServerError ? error.status : defaultStatus(code)
    const details = error instanceof FlowAiServerError ? error.details : undefined
    if (status >= 500 && !(error instanceof FlowAiServerError)) {
      console.error('[renoapp.flow-ai] Proposal failed', error)
    }
    return NextResponse.json(
      {
        error: ERROR_MESSAGES[code] ?? 'Kunde inte skapa AI-förslaget.',
        code,
        ...(details ?? {}),
      },
      {
        status,
        headers: { 'Cache-Control': 'no-store' },
      }
    )
  }
}
