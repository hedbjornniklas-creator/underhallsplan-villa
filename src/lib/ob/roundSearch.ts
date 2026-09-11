export const normalize = (value: unknown) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
const synonyms = [
  ['plat', 'stal', 'metall'],
  ['lackage', 'lacker', 'vattenlacka'],
  ['spricka', 'sprickor', 'sprickbildning'],
  ['fukt', 'fuktigt', 'fuktskada'],
]
export function matchesWords(text: string, query: string) {
  const source = normalize(text)
  return normalize(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((word) =>
      (synonyms.find((group) => group.includes(word)) ?? [word]).some((term) =>
        source.includes(term),
      ),
    )
}
export const hasNote = (row: {
  note?: string | null
  risk_text?: string | null
  ftu_text?: string | null
  status?: string | null
  selected_outcome_id?: string | null
}) =>
  Boolean(
    row.note?.trim() ||
      row.risk_text?.trim() ||
      row.ftu_text?.trim() ||
      row.selected_outcome_id ||
      row.status === 'ok',
  )
export const unfinishedFields = (row: {
  note?: string | null
  risk_text?: string | null
  ftu_text?: string | null
}) => [
  ...new Set(
    [row.note, row.risk_text, row.ftu_text]
      .join(' ')
      .match(/\{(?:plats|detalj|iakttagelse)\}/gi) ?? [],
  ),
]
export const noteMatchRank = (
  row: {
    label: string
    note_template?: string | null
    risk_template?: string | null
    ftu_template?: string | null
  },
  query: string,
) =>
  !query
    ? 0
    : matchesWords(row.label, query)
      ? 3
      : matchesWords(row.note_template ?? '', query)
        ? 2
        : matchesWords(
              `${row.risk_template ?? ''} ${row.ftu_template ?? ''}`,
              query,
            )
          ? 1
          : 0
