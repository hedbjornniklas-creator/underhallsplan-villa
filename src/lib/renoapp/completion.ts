export type CompletionItem = {
  id: string
  category: 'document' | 'participant'
  label: string
  correction: boolean
}

export type CompletionRequest = {
  id: string
  case_id: string
  items: CompletionItem[]
  message: string
  created_at: string
  submitted_at: string | null
  revision: number
  draft: { participantEntries?: unknown[]; replyMessage?: string }
  delivery_status: 'pending' | 'sent' | 'failed'
  delivery_error: string | null
  provider_message_id: string | null
}

export type CompletionSummary = Pick<CompletionRequest,
  'id' | 'items' | 'message' | 'created_at' | 'submitted_at' | 'delivery_status' | 'delivery_error'>

export function selectCompletionItems(
  rows: Array<{ id: string; category: 'document' | 'participant'; label: string; checked: boolean; requirementDecision: string | null }>,
  correctionIds: string[] = []
): CompletionItem[] {
  const corrections = new Set(correctionIds)
  return rows.filter(row => row.requirementDecision === 'requested' && (!row.checked || corrections.has(row.id)))
    .map(row => ({ id: row.id, category: row.category, label: row.label, correction: corrections.has(row.id) }))
}

export function completionMessage(items: CompletionItem[], note: string) {
  return [items.length ? `Följande ska kompletteras:\n${items.map(item =>
    `- ${item.category === 'document' ? 'Underlag' : 'Uppgifter'}: ${item.label}${item.correction ? ' (rättelse begärd)' : ''}`
  ).join('\n')}` : '', note.trim()].filter(Boolean).join('\n\n')
}

export function completionTargetId(item: CompletionItem) {
  return item.id.slice(item.id.indexOf(':') + 1)
}

export const COMPLETION_ERRORS: Record<string, string> = {
  COMPLETION_CHANGED: 'Begäran eller ansökan har ändrats. Ladda om sidan innan du fortsätter.',
  COMPLETION_DRAFT_CHANGED: 'Kompletteringen har sparats i en annan flik. Ladda om sidan för att läsa det senaste svaret.',
  COMPLETION_REQUIREMENTS_CHANGED: 'Underlagsvalen har ändrats. Ladda om ärendet och kontrollera begäran.',
  COMPLETION_PREVIOUS_DOCUMENT: 'Tidigare inskickade handlingar kan inte raderas. Ladda upp en ny version vid behov.',
}
