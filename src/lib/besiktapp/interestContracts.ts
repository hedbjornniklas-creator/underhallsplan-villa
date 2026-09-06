export const INTEREST_LIMITS = { name: 120, email: 254, company: 160, phone: 40, message: 2000 } as const
export type InterestField = keyof typeof INTEREST_LIMITS
export type InterestFields = Record<InterestField, string>
export type InterestSubmission = InterestFields & { submissionId: string; website: string }
export type InterestValidation =
  | { ok: true; value: InterestSubmission }
  | { ok: false; field?: InterestField; message: string }

export function isInterestEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@<>\u0000-\u001f\u007f]+@[^\s@<>\u0000-\u001f\u007f]+\.[^\s@<>\u0000-\u001f\u007f]+$/.test(value)
}

export function validateInterestSubmission(input: unknown): InterestValidation {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, message: 'Kontrollera uppgifterna och försök igen.' }
  const body = input as Record<string, unknown>
  if (typeof body.website !== 'string' || body.website !== '') return { ok: false, message: 'Formuläret kunde inte skickas.' }
  if (typeof body.submissionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.submissionId)) return { ok: false, message: 'Ladda om sidan och försök igen.' }
  const fields = {} as InterestFields
  for (const field of Object.keys(INTEREST_LIMITS) as InterestField[]) {
    const raw = body[field]
    if (typeof raw !== 'string') return { ok: false, field, message: 'Kontrollera fältet.' }
    if (raw.length > INTEREST_LIMITS[field]) return { ok: false, field, message: `Använd högst ${INTEREST_LIMITS[field]} tecken.` }
    const value = raw.replace(/\r\n/g, '\n').trim()
    const invalidControl = field === 'message' ? /[\u0000-\u0008\u000b-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/
    if (invalidControl.test(value)) return { ok: false, field, message: 'Ta bort ogiltiga tecken i fältet.' }
    fields[field] = value
  }
  if (!fields.name) return { ok: false, field: 'name', message: 'Fyll i ditt namn.' }
  if (!isInterestEmail(fields.email)) return { ok: false, field: 'email', message: 'Fyll i en giltig e-postadress.' }
  return { ok: true, value: { ...fields, website: '', submissionId: body.submissionId.toLowerCase() } }
}
