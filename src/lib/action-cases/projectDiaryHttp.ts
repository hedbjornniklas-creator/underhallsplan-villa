import { NextResponse, type NextRequest } from 'next/server'
import { generateAssignmentToken } from '@/lib/assignments/tokens'
import { diaryCookie, DIARY_DEVICE_SECONDS, validDiaryDevice } from './projectDiaryLinks'
import { DIARY_MAX_PHOTOS } from './projectDiary'

export const diaryHeaders = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' }
export function diaryJson(body: unknown, status = 200) { return NextResponse.json(body, { status, headers: diaryHeaders }) }
export function diaryError(error: unknown) {
  const code = error instanceof Error ? error.message : ''
  const errors: Record<string, [number, string]> = {
    PROJECT_DIARY_SCHEMA: [503, 'Dagboken behöver aktiveras i databasen. Övriga projektet påverkas inte.'],
    PROJECT_DIARY_NOT_FOUND: [404, 'Dagbokslänken är stängd eller kunde inte hittas. Kontakta projektansvarig.'],
    PROJECT_DIARY_FORBIDDEN: [403, 'Du saknar behörighet till dagboken.'],
    PROJECT_DIARY_MANAGER: [403, 'Endast projektansvarig kan redigera dagboken, hantera QR-länken och lägga till rättelser.'],
    PROJECT_DIARY_EDIT_CLOSED: [409, 'De 48 timmarna för redigering har gått ut. Uppgifterna finns kvar. Lägg till en rättelse i stället.'],
    PROJECT_DIARY_REVISION_STALE: [409, 'Anteckningen har ändrats i en annan flik. Dina ändringar finns kvar. Stäng redigeringen och hämta den senaste versionen innan du fortsätter.'],
    PROJECT_DIARY_STALE: [409, 'QR-länken har ändrats. Hämta det sparade läget innan du fortsätter.'],
    PROJECT_DIARY_DEVICE: [401, 'Besöket kunde inte kännas igen. Öppna dagboken igen och tillåt cookies. Ditt utkast finns kvar.'],
    PROJECT_DIARY_PERSON: [400, 'Välj en person från projektets lista, eller lägg till namn och företag.'],
    PROJECT_DIARY_RELOAD: [410, 'Dagboken har förenklats. Ladda om sidan för att välja person utan mejlkod.'],
    PROJECT_DIARY_RATE_LIMITED: [429, 'För många försök. Vänta en stund innan du försöker igen.'],
    PROJECT_DIARY_INVALID: [400, 'Kontrollera person, arbetsdatum, tider och beskrivning. Tiderna ska vara inom samma dag och arbetsdatum får inte ligga framåt i tiden.'],
    PROJECT_DIARY_ITEM: [400, 'Momentet är inte tillgängligt i detta projekt. Välj ett annat moment eller lämna det tomt.'],
    PROJECT_DIARY_PHOTO: [400, `En bild kunde inte godkännas. Använd JPG, PNG eller WebP, högst 8 MB per bild och ${DIARY_MAX_PHOTOS} bilder per anteckning. En uppladdning gäller i 24 timmar.`],
    PROJECT_DIARY_REQUEST_CONFLICT: [409, 'Detta försök har redan registrerats med andra uppgifter. Ändra inte ett pågående inskickningsförsök. Kontakta projektansvarig om kvittot saknas.'],
    PROJECT_DIARY_UPLOAD: [503, 'Bilden kunde inte sparas. Dina uppgifter finns kvar. Försök igen.'],
    PROJECT_DIARY_ORIGIN: [403, 'Begäran kunde inte godkännas. Öppna formuläret via projektets QR-kod.'],
    PROJECT_DIARY_TOO_LARGE: [413, 'Begäran är för stor. Bilder ska laddas upp med bildknappen.'],
    PROJECT_DIARY_CONFIG: [503, 'Dagbokslänkarna behöver konfigureras av administratören.'],
    UNAUTHORIZED: [401, 'Logga in igen. Ditt utkast finns kvar.'],
    MODULE_ACCESS_REQUIRED: [403, 'Du saknar behörighet till Uppdrag.'],
    PRODUCT_ACCESS_REQUIRED: [403, 'Du saknar behörighet till Uppdrag.'],
    ORG_MEMBERSHIP_REQUIRED: [403, 'Du saknar behörighet till organisationen.'],
  }
  const [status, message] = errors[code] || [503, 'Åtgärden kunde inte bekräftas. Dina uppgifter finns kvar. Försök igen med samma uppgifter.']
  return diaryJson({ error: message, code: errors[code] ? code : 'PROJECT_DIARY_FAILED', definite: status === 400 || status === 413 || ['PROJECT_DIARY_EDIT_CLOSED','PROJECT_DIARY_REVISION_STALE'].includes(code) }, status)
}
export async function diaryRequestBody(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin || !request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new Error('PROJECT_DIARY_ORIGIN')
  if (Number(request.headers.get('content-length')) > 32768) throw new Error('PROJECT_DIARY_TOO_LARGE')
  const reader = request.body?.getReader()
  if (!reader) throw new Error('PROJECT_DIARY_INVALID')
  const chunks: Uint8Array[] = []; let length = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > 32768) { await reader.cancel(); throw new Error('PROJECT_DIARY_TOO_LARGE') }
      chunks.push(value)
    }
    const bytes = new Uint8Array(length); let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error()
    return body as Record<string, unknown>
  } catch (error) { if (error instanceof Error && error.message === 'PROJECT_DIARY_TOO_LARGE') throw error; throw new Error('PROJECT_DIARY_INVALID') }
}
export function diaryRequestCookie(request: NextRequest, token: string) { return request.cookies.get(diaryCookie(token))?.value }
export function rememberDiaryDevice(response: NextResponse, request: NextRequest, token: string) {
  const old = diaryRequestCookie(request, token), value = validDiaryDevice(old) ? old : generateAssignmentToken()
  response.cookies.set(diaryCookie(token), value, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: DIARY_DEVICE_SECONDS })
}
