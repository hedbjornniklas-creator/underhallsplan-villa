import { NextResponse } from 'next/server'
import {
  FlowAiServerError,
  pollRenoAppFlowAiProposal,
  startRenoAppFlowAiProposal,
} from '@/lib/renoapp/flowAiServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

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
  FLOW_AI_RESPONSE_ID_INVALID: 'AI-körningens id har ett ogiltigt format.',
  FLOW_AI_RESPONSE_ID_MISMATCH: 'AI-tjänsten returnerade fel körning.',
  FLOW_AI_RESPONSE_METADATA_INVALID: 'AI-körningen tillhör inte RenoApps flödesbyggare.',
  FLOW_AI_RESPONSE_OWNER_MISMATCH: 'AI-körningen startades av en annan administratör.',
  FLOW_AI_CONFIGURATION_CHANGED: 'AI-konfigurationen har ändrats. Starta en ny granskning.',
  OPENAI_API_KEY_MISSING: 'AI-funktionen är inte konfigurerad på servern ännu.',
  OPENAI_EMPTY_RESPONSE: 'AI:n returnerade inget granskningsförslag.',
  OPENAI_INVALID_RESPONSE: 'AI:n returnerade ett granskningsförslag med ogiltigt format.',
  OPENAI_REQUEST_TIMEOUT: 'AI-körningen kunde inte startas inom tidsgränsen. Försök igen.',
  OPENAI_REQUEST_FAILED: 'AI-tjänsten kunde inte skapa ett förslag just nu.',
  OPENAI_RETRIEVE_TIMEOUT: 'Kunde inte läsa AI-körningens status inom tidsgränsen.',
  OPENAI_RETRIEVE_FAILED: 'Kunde inte läsa AI-körningens status just nu.',
  OPENAI_RESPONSE_NOT_FOUND: 'AI-körningen finns inte längre. Starta en ny granskning.',
  OPENAI_RESPONSE_FAILED: 'AI-körningen misslyckades hos leverantören.',
  OPENAI_RESPONSE_INCOMPLETE: 'AI-svaret blev ofullständigt. Starta en ny granskning.',
  OPENAI_RESPONSE_CANCELLED: 'AI-körningen avbröts.',
  OPENAI_RATE_LIMITED: 'AI-tjänsten är tillfälligt belastad. Försök igen om en stund.',
}

function defaultStatus(code: string) {
  if (code === 'UNAUTHORIZED') return 401
  if (code === 'ADMIN_REQUIRED' || code === 'PROFILE_NOT_FOUND') return 403
  return 500
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const response = await startRenoAppFlowAiProposal(body)
    return NextResponse.json(response, {
      status: 202,
      headers: {
        'Cache-Control': 'no-store',
        ...(response.pollAfterMs > 0 ? { 'Retry-After': String(Math.ceil(response.pollAfterMs / 1_000)) } : {}),
      },
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

export async function GET(request: Request) {
  try {
    const responseId = new URL(request.url).searchParams.get('responseId')
    const response = await pollRenoAppFlowAiProposal(responseId)
    const status = response.status === 'queued' || response.status === 'in_progress'
      ? 202
      : response.status === 'failed' || response.status === 'incomplete'
        ? 502
        : response.status === 'cancelled'
          ? 409
          : 200
    return NextResponse.json(response, {
      status,
      headers: {
        'Cache-Control': 'no-store',
        ...(response.status === 'queued' || response.status === 'in_progress'
          ? { 'Retry-After': String(Math.ceil(response.pollAfterMs / 1_000)) }
          : {}),
      },
    })
  } catch (error) {
    const code = error instanceof Error ? error.message : 'FLOW_AI_UNKNOWN_ERROR'
    const status = error instanceof FlowAiServerError ? error.status : defaultStatus(code)
    const details = error instanceof FlowAiServerError ? error.details : undefined
    if (status >= 500 && !(error instanceof FlowAiServerError)) {
      console.error('[renoapp.flow-ai] Poll failed', error)
    }
    return NextResponse.json(
      {
        error: ERROR_MESSAGES[code] ?? 'Kunde inte läsa AI-körningen.',
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
