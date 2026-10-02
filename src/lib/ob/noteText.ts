type StoredNoteText = {
  note?: string | null
  risk_text?: string | null
  ftu_text?: string | null
  recommendation_text?: string | null
  comment_text?: string | null
}

type OutcomeText = {
  note_template?: string | null
  risk_template?: string | null
  ftu_template?: string | null
}

// Empty saved fields are content, never a request to reread the catalogue.
export function readObNoteText(note: StoredNoteText) {
  return {
    note: note.note ?? '',
    risk_text: note.risk_text ?? '',
    ftu_text: note.ftu_text ?? '',
  }
}

// Use only when the inspector explicitly adds/selects a catalogue suggestion.
export function copyObOutcomeText(outcome: OutcomeText) {
  return readObNoteText({
    note: outcome.note_template,
    risk_text: outcome.risk_template,
    ftu_text: outcome.ftu_template,
  })
}

export function readStatusNoteText(note: StoredNoteText) {
  return {
    note: note.note ?? '',
    risk_text: '',
    ftu_text: '',
    recommendation_text: note.recommendation_text ?? '',
    comment_text: note.comment_text ?? '',
  }
}

// Status uses the catalogue's observation only. Recommendations and comments
// belong to the inspector and are never inferred from OB risk/FTU templates.
export function copyStatusOutcomeText(outcome: OutcomeText) {
  return readStatusNoteText({ note: outcome.note_template })
}

// Selecting a suggestion on an existing STB note changes its observation only.
// Hidden legacy OB text and the inspector's manual fields must be preserved.
export function copyExistingNoteOutcomeText(outcome: OutcomeText, statusInspection: boolean) {
  return statusInspection ? { note: outcome.note_template ?? '' } : copyObOutcomeText(outcome)
}
