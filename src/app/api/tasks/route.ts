import { NextResponse, after } from 'next/server'
import { requireModuleAccess } from '@/lib/access/server'
import { requireOrgContext } from '@/lib/assignments/server'
import { getTaskWorkspace, performTaskInternalAction } from '@/lib/tasks/server'
import { runTaskFollowupBatch } from '@/lib/tasks/automation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code: code ?? null }, { status })
}

async function requireTaskContext() {
  const org = await requireOrgContext()
  await requireModuleAccess({
    productKey: 'dashboard',
    moduleKey: 'tasks',
    scopeType: 'organization',
    scopeId: org.orgId,
  })
  return {
    orgId: org.orgId,
    userId: org.userId,
    isOrgAdmin: org.role === 'admin',
  }
}

function taskErrorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : 'TASK_UNKNOWN_ERROR'
  const badRequest: Record<string, string> = {
    TASK_TITLE_REQUIRED: 'Ange vad som ska göras.',
    TASK_CREATE_INPUT_INVALID: 'Kontrollera titel, mottagare, datum och kanaler.',
    TASK_REQUIREMENTS_INPUT_INVALID: 'Kontrollpunkterna är ogiltiga.',
    TASK_EVIDENCE_CHECKLIST_INVALID: 'Kontrollera valen för färdigbevis.',
    TASK_DUE_REQUIRED: 'Ange ett giltigt slutdatum.',
    TASK_FOLLOWUP_REQUIRED: 'Ange när Signe ska följa upp nästa gång.',
    TASK_FOLLOWUP_AFTER_DUE: 'Nästa uppföljning måste ligga senast på slutdatumet.',
    TASK_ASSIGNEE_REQUIRED: 'Välj en mottagare.',
    TASK_ASSIGNEE_NOT_IN_ORG: 'Den interna mottagaren tillhör inte organisationen.',
    TASK_CONTACT_NOT_FOUND: 'Den externa kontakten kunde inte hittas.',
    TASK_CONTACT_NAME_REQUIRED: 'Ange namn på den externa mottagaren.',
    TASK_CONTACT_METHOD_REQUIRED: 'Ange e-post eller telefonnummer till mottagaren.',
    TASK_CONTACT_EMAIL_REQUIRED: 'En extern mottagare måste ha e-post för Mina uppdrag.',
    TASK_CONTACT_WHATSAPP_REQUIRED: 'Telefonnummer krävs för WhatsApp.',
    TASK_EXTERNAL_ASSIGNEE_REQUIRED: 'Uppgiften är tilldelad en intern användare och behöver ingen extern länk.',
    TASK_CHILD_AFTER_PARENT_DUE: 'Underuppgiften får inte ha ett senare slutdatum än huvuduppgiften.',
    TASK_MAX_DEPTH: 'Maximalt djup för underuppgifter är uppnått.',
    TASK_MAX_OPEN_CHILDREN: 'Uppgiften har redan maximalt antal öppna underuppgifter.',
    TASK_MAX_DESCENDANTS: 'Huvuduppdraget har redan maximalt antal aktiva underuppgifter.',
    TASK_MAX_DEPTH_EXCEEDED: 'Maximalt djup för underuppgifter är uppnått.',
    TASK_MAX_OPEN_CHILDREN_EXCEEDED: 'Uppgiften har redan maximalt antal öppna underuppgifter.',
    TASK_MAX_ACTIVE_DESCENDANTS_EXCEEDED: 'Huvuduppdraget har redan maximalt antal aktiva underuppgifter.',
    TASK_PARENT_CLOSED: 'Det går inte att skapa underuppgifter till ett stängt uppdrag.',
    TASK_PARENT_VERSION_REQUIRED: 'Föräldrauppgiften behöver laddas om.',
    TASK_STATUS_INVALID: 'Ogiltig status.',
    TASK_VERSION_REQUIRED: 'Uppgiftens version saknas. Ladda om sidan och försök igen.',
    TASK_TRANSITION_INVALID: 'Statusändringen är inte tillåten i det här läget.',
    TASK_TRANSITION_MESSAGE_REQUIRED: 'Beskriv orsaken till statusändringen.',
    TASK_WAITING_REASON_REQUIRED: 'Beskriv vad eller vem uppgiften väntar på.',
    TASK_RETURN_REASON_REQUIRED: 'Beskriv vad som behöver rättas.',
    TASK_REQUIREMENTS_INCOMPLETE: 'Alla obligatoriska kontrollpunkter måste vara klara först.',
    TASK_PRESTART_REQUIREMENTS_INCOMPLETE: 'Offert, beställargodkännande eller garantiunderlag måste kontrolleras innan arbetet startas.',
    TASK_CHILDREN_INCOMPLETE: 'Alla aktiva underuppgifter måste vara godkända först.',
    TASK_COMPLETION_EVIDENCE_REQUIRED: 'Obligatoriskt färdigbevis saknas.',
    TASK_FOLLOWUP_INVALID: 'Ange ett giltigt uppföljningsdatum senast på slutdatumet.',
    TASK_COMMENT_REQUIRED: 'Skriv en kommentar.',
    TASK_REQUIREMENT_STATUS_INVALID: 'Ogiltigt läge för kontrollpunkten.',
    TASK_REQUIREMENT_DECISION_INVALID: 'Kontrollbeslutet är ogiltigt.',
    TASK_REQUIREMENT_DECISION_LOCKED: 'Kontrollpunkten är låst eftersom uppgiften är stängd.',
    TASK_REQUIREMENT_REASON_REQUIRED: 'Ange ett skäl för undantaget.',
    TASK_REQUIREMENT_EVIDENCE_REQUIRED: 'Lägg till ett underlag innan kontrollpunkten verifieras.',
    TASK_REQUIREMENT_EVIDENCE_INVALID: 'Det valda underlaget hör inte till kontrollpunkten.',
    TASK_REQUIREMENT_EVIDENCE_NOT_ALLOWED: 'Underlag kan inte kopplas när kontrollpunkten återställs.',
    TASK_EXTENSION_DATE_REQUIRED: 'Ange önskat nytt slutdatum.',
    TASK_EXTENSION_REASON_REQUIRED: 'Motivera varför slutdatumet behöver flyttas.',
    TASK_EXTENSION_DATE_INVALID: 'Det nya slutdatumet måste ligga efter nuvarande slutdatum.',
    TASK_EXTENSION_DECISION_INVALID: 'Ogiltigt beslut om förlängning.',
    TASK_EXTENSION_NOT_PENDING: 'Förlängningen är redan behandlad eller saknas.',
    TASK_DEADLINE_REQUEST_INVALID: 'Begäran om nytt slutdatum är ogiltig.',
    TASK_DEADLINE_REQUEST_NOT_PENDING: 'Förlängningen är redan behandlad eller saknas.',
    TASK_TERMINAL: 'Uppgiften är stängd och kan inte ändras.',
    SIGNE_MAX_DEPTH: 'Signe kan inte föreslå fler nivåer av underuppgifter för den här uppgiften.',
    SIGNE_CHILD_BUDGET_REACHED: 'Uppgiften har redan maximalt antal öppna underuppgifter och förslag.',
    SIGNE_PENDING_BUDGET_REACHED: 'Huvuduppdraget har redan maximalt antal väntande Signe-förslag.',
    SIGNE_DESCENDANT_BUDGET_REACHED: 'Huvuduppdraget har redan maximalt antal aktiva underuppgifter och förslag.',
    TASK_AI_MAX_DEPTH_EXCEEDED: 'Signe kan inte föreslå fler nivåer av underuppgifter för den här uppgiften.',
    TASK_AI_CHILD_BUDGET_EXCEEDED: 'Uppgiften har redan maximalt antal öppna underuppgifter och förslag.',
    TASK_AI_PENDING_BUDGET_EXCEEDED: 'Huvuduppdraget har redan maximalt antal väntande Signe-förslag.',
    TASK_AI_ACTIVE_DESCENDANT_BUDGET_EXCEEDED: 'Huvuduppdraget har redan maximalt antal aktiva underuppgifter och förslag.',
    TASK_AI_SUGGESTION_PARENT_REQUIRED: 'Ett Signe-förslag kan bara användas för en underuppgift.',
    SIGNE_TASK_CLOSED: 'Signe kan inte analysera ett avslutat uppdrag.',
    SIGNE_REJECTION_REASON_REQUIRED: 'Beskriv varför förslaget avvisas.',
    TASK_ACTION_INVALID: 'Åtgärden stöds inte.',
    TASK_INITIAL_DISPATCH_TERMINAL: 'Uppgiften är stängd och kan inte skickas.',
    TASK_INITIAL_DISPATCH_FINALIZE_INPUT_INVALID: 'Uppgiften kunde inte förberedas för utskick.',
  }
  const forbidden = new Set([
    'TASK_SUBTASK_FORBIDDEN',
    'TASK_REVIEW_FORBIDDEN',
    'TASK_CANCEL_FORBIDDEN',
    'TASK_ASSIGNEE_ACTION_FORBIDDEN',
    'TASK_COMMENT_FORBIDDEN',
    'TASK_REQUIREMENT_VERIFY_FORBIDDEN',
    'TASK_EXTENSION_REQUEST_FORBIDDEN',
    'TASK_EXTENSION_DECIDE_FORBIDDEN',
    'TASK_ACCESS_ISSUE_FORBIDDEN',
    'TASK_ACCESS_BEARER_ISSUE_FORBIDDEN',
    'TASK_ACCESS_ROTATION_CREATOR_FORBIDDEN',
    'TASK_DISPATCH_FORBIDDEN',
    'TASK_ARCHIVE_FORBIDDEN',
    'TASK_REVIEW_ACTION_FORBIDDEN',
    'TASK_ACTOR_NOT_IN_ORG',
    'TASK_CREATE_FORBIDDEN',
    'TASK_CREATE_WITH_DISPATCH_CONTROL_FORBIDDEN',
    'TASK_INITIAL_DISPATCH_FINALIZE_FORBIDDEN',
    'TASK_SUBTASK_CREATE_FORBIDDEN',
    'TASK_REQUIREMENT_DECISION_FORBIDDEN',
    'SIGNE_ANALYZE_FORBIDDEN',
    'SIGNE_REVIEW_FORBIDDEN',
    'TASK_AI_SUGGESTION_ACCEPT_FORBIDDEN',
  ])

  if (code === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401, code)
  if (code === 'ORG_MEMBERSHIP_REQUIRED' || code === 'MODULE_ACCESS_REQUIRED') {
    return jsonError('Du saknar behörighet till Uppdrag.', 403, code)
  }
  if (code === 'MISSING_ENV:APP_BASE_URL' || code === 'INVALID_ENV:APP_BASE_URL') {
    return jsonError('Den publika adressen för personliga uppdragslänkar är inte konfigurerad.', 503, code)
  }
  if (code === 'MISSING_ENV:OPENAI_API_KEY') {
    return jsonError('Signe är inte konfigurerad på servern ännu.', 503, code)
  }
  if (code === 'SIGNE_PROVIDER_UNAVAILABLE' || code === 'SIGNE_RESPONSE_INVALID') {
    return jsonError('Signe kunde inte svara just nu. Försök igen om en stund.', 502, code)
  }
  if (
    code === 'SIGNE_RUN_CREATE_FAILED' ||
    code === 'SIGNE_RUN_COMPLETE_FAILED' ||
    code === 'SIGNE_SUGGESTIONS_SAVE_FAILED' ||
    code === 'SIGNE_SUGGESTION_REJECT_FAILED' ||
    code === 'SIGNE_ANALYSIS_FAILED'
  ) {
    return jsonError('Signe kunde inte spara resultatet just nu. Försök igen om en stund.', 500, code)
  }
  if (forbidden.has(code)) return jsonError('Du får inte utföra den här åtgärden.', 403, code)
  if (code === 'TASK_NOT_FOUND') return jsonError('Uppgiften kunde inte hittas.', 404, code)
  if (code === 'SIGNE_SUGGESTION_NOT_FOUND') return jsonError('Signe-förslaget kunde inte hittas.', 404, code)
  if (code === 'SIGNE_ALREADY_RUNNING') {
    return jsonError('Signe analyserar redan uppgiften. Vänta en kort stund och försök igen.', 409, code)
  }
  if (code === 'TASK_ARCHIVE_CHILDREN_EXIST') {
    return jsonError('Uppdraget har underuppgifter och kan inte raderas. Radera underuppgifterna först.', 409, code)
  }
  if (code === 'SIGNE_SUGGESTION_NOT_PENDING' || code === 'TASK_AI_SUGGESTION_NOT_PENDING') {
    return jsonError('Förslaget har redan behandlats. Ladda om uppgiften.', 409, code)
  }
  if (code === 'TASK_VERSION_CONFLICT' || code === 'TASK_PARENT_VERSION_CONFLICT') {
    return jsonError('Uppgiften ändrades av någon annan. Ladda om och försök igen.', 409, code)
  }
  if (code === 'TASK_ACCESS_LINK_ASSIGNEE_INVALID') {
    return jsonError('Uppdragets mottagare har ändrats. Ladda om och försök igen.', 409, code)
  }
  if (badRequest[code]) return jsonError(badRequest[code], 400, code)
  if (
    code.includes('operational_tasks') ||
    code.includes('organization_contacts') ||
    code === 'TASKS_SCHEMA_REQUIRED' ||
    code === 'TASK_RECIPIENT_IDENTITY_ENSURE_FAILED' ||
    code === 'TASK_RECIPIENT_PORTAL_GRANT_FAILED' ||
    code === 'TASK_RECIPIENT_ACTIVATION_CREATE_FAILED' ||
    code === 'TASK_ARCHIVE_FAILED' ||
    code === 'TASK_AI_SUGGESTIONS_READ_FAILED' ||
    code === 'SIGNE_SCHEMA_REQUIRED'
  ) {
    return jsonError('Uppdrag-modulens databasmigration behöver köras.', 503, 'TASKS_SCHEMA_REQUIRED')
  }
  return jsonError(code || 'Kunde inte hantera uppgiften.', 500, code)
}

export async function GET() {
  try {
    const context = await requireTaskContext()
    const workspace = await getTaskWorkspace(context)
    return NextResponse.json({ workspace })
  } catch (error) {
    return taskErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get('content-length'))
    if (Number.isFinite(contentLength) && contentLength > 64 * 1024) {
      return jsonError('Begäran är för stor.', 413, 'TASK_REQUEST_TOO_LARGE')
    }
    const context = await requireTaskContext()
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const action = typeof body.action === 'string' ? body.action : ''
    const payload =
      body.payload && typeof body.payload === 'object'
        ? (body.payload as Record<string, unknown>)
        : {}
    const result = await performTaskInternalAction({
      ...context,
      action,
      payload,
      requestOrigin: new URL(request.url).origin,
    })
    const assignmentDeferred =
      (action === 'create_task' || action === 'create_subtask') && payload.sendAssignment === false
    if (!assignmentDeferred) {
      after(async () => {
        try {
          await runTaskFollowupBatch({ limit: 5 })
        } catch {
          console.error('[tasks.api] opportunistic follow-up failed', {
            code: 'TASK_AUTOMATION_BATCH_FAILED',
          })
        }
      })
    }
    return NextResponse.json(result)
  } catch (error) {
    return taskErrorResponse(error)
  }
}
