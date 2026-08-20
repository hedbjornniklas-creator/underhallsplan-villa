import { NextResponse, after } from 'next/server'
import { getExternalTaskWorkspace, performExternalTaskAction } from '@/lib/tasks/external'
import { runTaskFollowupBatch } from '@/lib/tasks/automation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number, code: string) {
  return NextResponse.json({ error: message, code }, { status })
}

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : 'TASK_UNKNOWN_ERROR'
  const messages: Record<string, string> = {
    TASK_COMMENT_REQUIRED: 'Skriv ett meddelande.',
    TASK_TITLE_REQUIRED: 'Ange vad som ska göras i underuppgiften.',
    TASK_DUE_REQUIRED: 'Ange ett giltigt slutdatum.',
    TASK_CREATE_INPUT_INVALID: 'Kontrollera ansvarig, datum och kanaler.',
    TASK_CONTACT_NAME_REQUIRED: 'Ange namn på den nya ansvariga.',
    TASK_CONTACT_METHOD_REQUIRED: 'Ange e-post eller telefon till den nya ansvariga.',
    TASK_CONTACT_EMAIL_REQUIRED: 'E-post krävs för den valda kanalen.',
    TASK_CONTACT_WHATSAPP_REQUIRED: 'Telefonnummer krävs för WhatsApp.',
    TASK_CHANNELS_MUST_DIFFER: 'Reservkanalen måste skilja sig från huvudkanalen.',
    TASK_PARENT_CLOSED: 'Det går inte att delegera från ett stängt uppdrag.',
    TASK_PARENT_VERSION_REQUIRED: 'Uppgiften behöver laddas om innan delegering.',
    TASK_MAX_DEPTH_EXCEEDED: 'Maximalt djup för underuppgifter är uppnått.',
    TASK_MAX_OPEN_CHILDREN_EXCEEDED: 'Uppgiften har redan maximalt antal öppna underuppgifter.',
    TASK_MAX_ACTIVE_DESCENDANTS_EXCEEDED: 'Uppdragsträdet har redan maximalt antal aktiva underuppgifter.',
    TASK_TRANSITION_INVALID: 'Statusändringen är inte möjlig i det här läget.',
    TASK_VERSION_REQUIRED: 'Uppgiften behöver laddas om innan den kan ändras.',
    TASK_TRANSITION_MESSAGE_REQUIRED: 'Beskriv orsaken till statusändringen.',
    TASK_WAITING_REASON_REQUIRED: 'Beskriv vad uppgiften väntar på.',
    TASK_FOLLOWUP_REQUIRED: 'Ange ett giltigt uppföljningsdatum.',
    TASK_FOLLOWUP_AFTER_DUE: 'Uppföljningen måste ligga senast på slutdatumet.',
    TASK_REQUIREMENTS_INCOMPLETE: 'Obligatoriskt underlag saknas. Kontakta uppdragsgivaren eller komplettera uppgiften.',
    TASK_PRESTART_REQUIREMENTS_INCOMPLETE: 'Offert, beställargodkännande eller garantiunderlag måste kontrolleras innan arbetet startas.',
    TASK_CHILDREN_INCOMPLETE: 'Alla aktiva underuppgifter måste vara godkända först.',
    TASK_COMPLETION_EVIDENCE_REQUIRED: 'Lägg till efterfrågat färdigbevis först.',
    TASK_FOLLOWUP_INVALID: 'Ange ett giltigt uppföljningsdatum senast på slutdatumet.',
    TASK_EXTENSION_DATE_REQUIRED: 'Ange önskat nytt slutdatum.',
    TASK_EXTENSION_REASON_REQUIRED: 'Beskriv varför mer tid behövs.',
    TASK_EXTENSION_DATE_INVALID: 'Det nya datumet måste ligga efter nuvarande slutdatum.',
    TASK_DEADLINE_REQUEST_INVALID: 'Begäran om nytt slutdatum är ogiltig.',
    TASK_TERMINAL: 'Uppgiften är stängd och kan inte ändras.',
  }
  if (code === 'TASK_ACCESS_NOT_FOUND' || code === 'TASK_NOT_FOUND') {
    return jsonError('Länken eller uppgiften kunde inte hittas.', 404, code)
  }
  if (code === 'TASK_ACCESS_CLOSED') return jsonError('Länken har gått ut eller återkallats.', 410, code)
  if (code === 'MISSING_ENV:APP_BASE_URL' || code === 'INVALID_ENV:APP_BASE_URL') {
    return jsonError('Den publika adressen för nya uppdragslänkar är inte konfigurerad.', 503, code)
  }
  if (
    code === 'TASK_EXTERNAL_ACTION_FORBIDDEN' ||
    code === 'TASK_ACCESS_SCOPE_INVALID' ||
    code === 'TASK_EXTERNAL_DELEGATION_FORBIDDEN'
  ) {
    return jsonError('Länken ger inte behörighet till åtgärden.', 403, code)
  }
  if (code === 'TASK_VERSION_CONFLICT' || code === 'TASK_PARENT_VERSION_CONFLICT') {
    return jsonError('Uppgiften har ändrats. Ladda om sidan och försök igen.', 409, code)
  }
  if (code === 'TASK_RATE_LIMITED') {
    return jsonError('För många uppdateringar på kort tid. Vänta några minuter.', 429, code)
  }
  if (messages[code]) return jsonError(messages[code], 400, code)
  return jsonError('Kunde inte uppdatera uppgiften just nu.', 500, code)
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params
    const workspace = await getExternalTaskWorkspace(token)
    if (!workspace) return jsonError('Länken kunde inte hittas.', 404, 'TASK_ACCESS_NOT_FOUND')
    return NextResponse.json({ workspace })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const contentLength = Number(request.headers.get('content-length'))
    if (Number.isFinite(contentLength) && contentLength > 64 * 1024) {
      return jsonError('Begäran är för stor.', 413, 'TASK_REQUEST_TOO_LARGE')
    }
    const { token } = await context.params
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const action = typeof body.action === 'string' ? body.action : ''
    const payload =
      body.payload && typeof body.payload === 'object'
        ? (body.payload as Record<string, unknown>)
        : {}
    const result = await performExternalTaskAction({
      token,
      action,
      payload,
      requestOrigin: new URL(request.url).origin,
    })
    after(async () => {
      try {
        await runTaskFollowupBatch({ limit: 5 })
      } catch {
        console.error('[tasks.signe] opportunistic follow-up failed', {
          code: 'TASK_AUTOMATION_BATCH_FAILED',
        })
      }
    })
    return NextResponse.json(result)
  } catch (error) {
    return errorResponse(error)
  }
}
