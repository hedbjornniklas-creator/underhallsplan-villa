export type ObNoteSuggestion = {
  noteId: string
  note: string
  risk_text: string
  ftu_text: string
  category: string
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function parseObNoteSuggestion(inspectionId: string, value: unknown): ObNoteSuggestion | null {
  if (!uuid.test(inspectionId) || !value || typeof value !== 'object' || Array.isArray(value)) return null
  const body = value as Record<string, unknown>
  if (typeof body.noteId !== 'string' || !uuid.test(body.noteId)) return null
  if (!['note', 'risk_text', 'ftu_text', 'category'].every(key => typeof body[key] === 'string')) return null
  const text = Object.fromEntries(['note', 'risk_text', 'ftu_text', 'category'].map(key => [key, (body[key] as string).trim()]))
  if (!text.note || text.category.length > 200 || [text.note, text.risk_text, text.ftu_text].some(v => v.length > 20000)) return null
  return { noteId: body.noteId, note: text.note, risk_text: text.risk_text, ftu_text: text.ftu_text, category: text.category }
}

export async function submitObNoteSuggestion(inspectionId: string, suggestion: ObNoteSuggestion): Promise<void> {
  const response = await fetch(`/api/ob/inspections/${encodeURIComponent(inspectionId)}/note-suggestions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(suggestion),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || result.ok !== true) throw Error(result.error || 'Förslaget kunde inte skickas. Försök igen.')
}
