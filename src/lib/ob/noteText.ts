type StoredNoteText = {
  note?: string | null
  risk_text?: string | null
  ftu_text?: string | null
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
