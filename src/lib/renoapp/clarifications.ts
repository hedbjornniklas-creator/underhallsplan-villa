import type { CompletionItem } from './completion'

export const INVESTIGATE_OPTION_KEY = 'needs_investigation'
export const MUNICIPAL_QUESTION_KEY = 'har-du-fatt-besked-fran-kommunen-om-den-planerade-atgarden-kraver-anmalan'

export type Clarification = {
  question_id: string
  question_key: string
  label: string
  original_answer: string
  answer_label: string | null
  answer_note: string | null
  state: 'pending' | 'answered' | 'resolved' | 'not_relevant'
  requested: boolean
  revision: number
  review_note: string | null
}
export type ClarificationAnswer = { optionId: string; note: string }
export type ClarificationAnswers = Record<string, ClarificationAnswer>
export function parseClarificationAnswers(value: unknown): ClarificationAnswers {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_CLARIFICATION_ANSWERS')
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const result: ClarificationAnswers = {}
  for (const [key, raw] of Object.entries(value)) {
    if (!uuid.test(key) || !raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('INVALID_CLARIFICATION_ANSWERS')
    const row = raw as Record<string, unknown>
    if (typeof row.optionId !== 'string' || (row.optionId !== '' && !uuid.test(row.optionId)) ||
        typeof row.note !== 'string' || row.note.length > 4000) throw new Error('INVALID_CLARIFICATION_ANSWERS')
    result[key] = { optionId: row.optionId, note: row.note }
  }
  return result
}
export type ClarificationQuestion = {
  questionId: string
  label: string
  revision: number
  options: Array<{ id: string; key: string; label: string }>
}
export type ClarificationAction = 'request' | 'not_requested' | 'resolve' | 'not_relevant' | 'reopen'

export function isOpenClarification(row: Clarification) {
  return row.state === 'pending' || row.state === 'answered'
}

export function clarificationItems(rows: Clarification[]): CompletionItem[] {
  return rows.filter(row => row.requested && isOpenClarification(row)).map(row => ({
    id: `clarification:${row.question_id}`, category: 'clarification', label: row.label,
    correction: false, clarificationRevision: row.revision,
  }))
}

export function clarificationAnswerError(questions: ClarificationQuestion[], answers: ClarificationAnswers): string | null {
  for (const question of questions) {
    const answer = answers[question.questionId]
    const option = question.options.find(option => option.id === answer?.optionId)
    if (!option) return 'Besvara frågorna som styrelsen har bett dig klarlägga.'
    if (option.key === INVESTIGATE_OPTION_KEY && !answer.note.trim()) {
      return 'Beskriv vad som återstår att undersöka och varför du ännu inte kan lämna besked.'
    }
  }
  return null
}

export const CLARIFICATION_ERRORS: Record<string, string> = {
  CLARIFICATION_CHANGED: 'Klarläggandet har ändrats. Ladda om ärendet innan du fortsätter.',
  CLARIFICATION_ANSWER_REQUIRED: 'Besvara de begärda klarläggandena. Beskriv vad som återstår om frågan inte är utredd.',
  CLARIFICATION_REVIEW_REQUIRED: 'Ett svar behöver ha kommit in innan frågan kan markeras som klarlagd.',
  CLARIFICATION_NOTE_REQUIRED: 'Skriv en kort motivering till bedömningen.',
  CLARIFICATION_ROUND_OPEN: 'Sökanden har en pågående komplettering. Invänta svaret innan frågan bedöms.',
}
