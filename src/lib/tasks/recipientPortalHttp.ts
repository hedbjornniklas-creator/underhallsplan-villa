import 'server-only'

import { NextResponse } from 'next/server'

const BAD_REQUEST_MESSAGES: Record<string, string> = {
  TASK_ACTION_INVALID: 'Åtgärden stöds inte.',
  TASK_COMMENT_REQUIRED: 'Skriv ett meddelande.',
  TASK_VERSION_REQUIRED: 'Uppgiften behöver laddas om innan den kan ändras.',
  TASK_TRANSITION_INVALID: 'Statusändringen är inte möjlig i det här läget.',
  TASK_TRANSITION_MESSAGE_REQUIRED: 'Beskriv orsaken till statusändringen.',
  TASK_WAITING_REASON_REQUIRED: 'Beskriv vad uppgiften väntar på.',
  TASK_FOLLOWUP_REQUIRED: 'Ange ett giltigt uppföljningsdatum.',
  TASK_FOLLOWUP_AFTER_DUE: 'Uppföljningen måste ligga senast på slutdatumet.',
  TASK_FOLLOWUP_INVALID: 'Ange ett uppföljningsdatum senast på slutdatumet.',
  TASK_EXTENSION_DATE_REQUIRED: 'Ange önskat nytt slutdatum.',
  TASK_EXTENSION_REASON_REQUIRED: 'Beskriv varför mer tid behövs.',
  TASK_EXTENSION_DATE_INVALID: 'Det nya datumet måste ligga efter nuvarande slutdatum.',
  TASK_DEADLINE_REQUEST_INVALID: 'Begäran om nytt slutdatum är ogiltig.',
  TASK_REQUIREMENTS_INCOMPLETE: 'Obligatoriskt underlag saknas.',
  TASK_PRESTART_REQUIREMENTS_INCOMPLETE: 'Offert, beställargodkännande eller garantiunderlag måste kontrolleras innan arbetet startas.',
  TASK_CHILDREN_INCOMPLETE: 'Alla aktiva underuppgifter måste vara klara först.',
  TASK_COMPLETION_EVIDENCE_REQUIRED: 'Lägg till efterfrågat färdigbevis först.',
  TASK_EVIDENCE_TEXT_REQUIRED: 'Skriv underlaget som ska sparas.',
  TASK_ATTACHMENT_EMPTY: 'Välj en fil med innehåll.',
  TASK_ATTACHMENT_TYPE_INVALID: 'Filtypen stöds inte.',
  TASK_COMPLETION_EVIDENCE_TYPE_INVALID: 'Filtypen motsvarar inte något valt krav på färdigbevis.',
  TASK_ATTACHMENT_TOO_LARGE: 'Filen är för stor. Maximal storlek är 25 MB.',
}

export function recipientPortalErrorResponse(
  error: unknown,
  fallbackMessage = 'Kunde inte hantera uppgiften just nu.'
) {
  const code = error instanceof Error ? error.message : 'TASK_RECIPIENT_PORTAL_FAILED'
  if (code === 'UNAUTHORIZED') {
    return NextResponse.json({ error: 'Du behöver logga in igen.', code }, { status: 401 })
  }
  if (code === 'TASK_NOT_FOUND' || code === 'TASK_ATTACHMENT_NOT_FOUND') {
    return NextResponse.json({ error: 'Uppgiften eller underlaget kunde inte hittas.', code }, { status: 404 })
  }
  if (code === 'TASK_RATE_LIMITED') {
    return NextResponse.json(
      { error: 'För många uppdateringar på kort tid. Vänta några minuter.', code },
      { status: 429 }
    )
  }
  if (code === 'TASK_VERSION_CONFLICT' || code === 'TASK_PARENT_VERSION_CONFLICT') {
    return NextResponse.json(
      { error: 'Uppgiften har ändrats. Ladda om sidan och försök igen.', code },
      { status: 409 }
    )
  }
  if (code === 'TASK_ATTACHMENT_LOCKED' || code === 'TASK_TERMINAL') {
    return NextResponse.json(
      { error: 'Uppgiften är inskickad eller avslutad och kan inte ändras.', code },
      { status: 409 }
    )
  }
  if (code.includes('FORBIDDEN') || code.includes('SCOPE_INVALID')) {
    return NextResponse.json({ error: 'Du har inte åtkomst till åtgärden.', code }, { status: 403 })
  }
  if (BAD_REQUEST_MESSAGES[code]) {
    return NextResponse.json({ error: BAD_REQUEST_MESSAGES[code], code }, { status: 400 })
  }
  if (
    code === 'TASK_RECIPIENT_PORTAL_SCOPE_FAILED' ||
    code === 'TASK_RECIPIENT_PORTAL_ACTOR_FAILED' ||
    code.includes('SCHEMA_REQUIRED')
  ) {
    return NextResponse.json(
      { error: 'Mottagarportalen är inte färdigkonfigurerad.', code },
      { status: 503 }
    )
  }
  return NextResponse.json({ error: fallbackMessage, code }, { status: 500 })
}
