type StoredReportNote = {
  note?: string | null
  risk_text?: string | null
  ftu_text?: string | null
  recommendation_text?: string | null
  comment_text?: string | null
}

// Status recommendations are written by the inspector; never reuse risk or FTU
// as recommendations, even if those older fields happen to contain text.
export function readInspectionReportNote(row: StoredReportNote, statusInspection = false) {
  return {
    note: row.note ?? '',
    risk_text: statusInspection ? '' : row.risk_text ?? '',
    ftu_text: statusInspection ? '' : row.ftu_text ?? '',
    ...(statusInspection
      ? { recommendationText: row.recommendation_text ?? '', commentText: row.comment_text ?? '' }
      : {}),
  }
}
