import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ObNoteSuggestion } from './noteSuggestion'
import type { sendAssignmentEmail } from '../assignments/mailer'

// Same default administrator as existing HusHub operational notifications.
export const OB_NOTE_SUGGESTION_ADMIN_EMAIL = 'jn@hedbjorn.se'
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export class NoteSuggestionError extends Error {
  readonly status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}

export async function sendObNoteSuggestion(input: {
  db: SupabaseClient
  actorId: string
  inspectionId: string
  suggestion: ObNoteSuggestion
  from: string | undefined
  recipient?: string
  send: typeof sendAssignmentEmail
}) {
  const { db, actorId, inspectionId, suggestion } = input
  const { data: inspection, error: inspectionError } = await db.from('inspections')
    .select('property_id,inspection_family,type').eq('id', inspectionId).maybeSingle()
  if (inspectionError) throw Error('NOTE_SUGGESTION_LOOKUP_FAILED')
  if (!inspection || (inspection.inspection_family ?? inspection.type) !== 'OB') throw new NoteSuggestionError('Besiktningen hittades inte.', 404)
  const { data: property, error: propertyError } = await db.from('properties')
    .select('owner').eq('id', inspection.property_id).eq('owner', actorId).maybeSingle()
  if (propertyError) throw Error('NOTE_SUGGESTION_LOOKUP_FAILED')
  if (!property) throw new NoteSuggestionError('Du får bara skicka förslag från dina egna besiktningar.', 403)
  const { data: note, error: noteError } = await db.from('inspection_control_items')
    .select('id,control_point_id').eq('inspection_id', inspectionId).eq('id', suggestion.noteId).maybeSingle()
  if (noteError) throw Error('NOTE_SUGGESTION_LOOKUP_FAILED')
  if (!note || note.control_point_id !== null) throw new NoteSuggestionError('Den fria noteringen hittades inte. Uppdatera sidan och försök igen.', 409)

  const from = input.from?.trim()
  const to = input.recipient?.trim() || OB_NOTE_SUGGESTION_ADMIN_EMAIL
  if (!from || !emailPattern.test(to)) throw new NoteSuggestionError('Mejlutskick till admin är inte konfigurerat.', 503)
  const { data: profile, error: profileError } = await db.from('profiles').select('email').eq('id', actorId).maybeSingle()
  if (profileError) throw Error('NOTE_SUGGESTION_LOOKUP_FAILED')
  const replyTo = typeof profile?.email === 'string' && emailPattern.test(profile.email.trim()) ? profile.email.trim() : null
  const text = [
    'Förslag till ÖB:s noteringsbibliotek',
    'För granskning av admin. Inget har lagts till i biblioteket automatiskt.',
    `Avsändare: ${replyTo ?? 'Inloggad besiktningsman'}`,
    suggestion.category ? `Rum eller byggnadsdel: ${suggestion.category}` : '',
    '', 'Notering:', suggestion.note,
    ...(suggestion.risk_text ? ['', 'Risk:', suggestion.risk_text] : []),
    ...(suggestion.ftu_text ? ['', 'Fortsatt teknisk utredning:', suggestion.ftu_text] : []),
  ].join('\n')
  const mail = { to, from, replyTo, subject: 'HusHub ÖB: förslag till noteringsbiblioteket', text,
    html: `<div style="white-space:pre-wrap;font-family:Arial,sans-serif">${escapeHtml(text)}</div>` }
  // Identical copies use the same provider key, including after an uncertain response.
  const idempotencyKey = `ob-note-suggestion-${createHash('sha256').update(JSON.stringify([actorId, inspectionId, suggestion.noteId, mail])).digest('hex')}`
  await input.send({ ...mail, idempotencyKey })
}

// Bounded per-instance brake, not a distributed rate limiter. Provider keys also deduplicate retries.
export function createNoteSuggestionLimit() {
  const entries = new Map<string, { count: number; until: number }>()
  return (actorId: string, now = Date.now()) => {
    for (const [key, entry] of entries) if (entry.until <= now) entries.delete(key)
    const entry = entries.get(actorId) ?? { count: 0, until: now + 3600000 }
    if (entry.count >= 20 || (!entries.has(actorId) && entries.size >= 1000)) return false
    entry.count++
    entries.set(actorId, entry)
    return true
  }
}
