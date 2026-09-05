import { NextResponse } from 'next/server'

const ERRORS: Record<string, [string, number]> = {
  UNAUTHORIZED: ['Logga in för att fortsätta.', 401],
  ADMIN_REQUIRED: ['Adminbehörighet krävs.', 403], MODULE_ACCESS_REQUIRED: ['Adminbehörighet krävs.', 403],
  RENOAPP_MEMBERSHIP_REQUIRED: ['Du saknar åtkomst till föreningen.', 403],
  BRF_NOT_FOUND: ['Föreningen hittades inte.', 404], INVITE_NOT_FOUND: ['Inbjudan hittades inte.', 404],
  BRF_ORG_NUMBER_EXISTS: ['En förening med detta organisationsnummer finns redan. Öppna den i BRF-listan.', 409],
  ORG_NUMBER_INVALID: ['Ange organisationsnummer i formatet XXXXXX-XXXX.', 400],
  CREATION_KEY_REQUIRED: ['Ladda om sidan innan du skapar föreningen.', 400],
  INVALID_ACTION: ['Ogiltig åtgärd.', 400],
  BRF_ACTIVATION_REQUIRED: ['Styrelsen måste slutföra aktiveringen innan ansökningssidan kan öppnas.', 409],
  EMAIL_INVALID: ['Ange en giltig e-postadress.', 400],
  EMAIL_ALREADY_MEMBER: ['E-postadressen tillhör redan en aktiv medlem.', 409],
  EMAIL_ALREADY_INVITED: ['Det finns redan en aktiv inbjudan. Använd Skicka ny länk.', 409],
  INVITE_ALREADY_ACCEPTED: ['Inbjudan har redan accepterats.', 409],
  CANNOT_REMOVE_SELF: ['Du kan inte ta bort ditt eget medlemskap här.', 409],
  CANNOT_REMOVE_LAST_MEMBER: ['Föreningens sista medlem kan inte tas bort. Bjud in en ersättare först.', 409],
  MEMBER_NOT_FOUND: ['Medlemmen hittades inte.', 404],
}
export function brfApiError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Ett oväntat fel uppstod.'
  const mapped = ERRORS[message]
  if (mapped) return NextResponse.json({ error: mapped[0] }, { status: mapped[1] })
  if (/schema cache|does not exist|Could not find the function/i.test(message)) {
    return NextResponse.json({ error: 'BRF-administrationen behöver databasuppdateringen från 2026-09-05.' }, { status: 503 })
  }
  return NextResponse.json({ error: message }, { status: /^Ange |^Obligatoriska |^Föreningsuppgifter/.test(message) ? 400 : 500 })
}
