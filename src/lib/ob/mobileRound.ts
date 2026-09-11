export type RoundTextDraft = {
  note: string
  risk_text: string
  ftu_text: string
}

export function isObRoundSection(section: string) {
  return section === 'runda' || section === 'runda-ny'
}

// Keep ordinary inspection links on their original starting page.
export function getInitialObSection(search: string): 'grunddata' | 'runda-ny' {
  return new URLSearchParams(search).get('round') === 'mobile-v2'
    ? 'runda-ny'
    : 'grunddata'
}

export function restoreRoundDraft(
  raw: string | null,
  original: RoundTextDraft,
): RoundTextDraft {
  if (!raw) return original
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return original
    const draft = value as Record<string, unknown>
    if (
      typeof draft.note !== 'string' ||
      typeof draft.risk_text !== 'string' ||
      typeof draft.ftu_text !== 'string'
    )
      return original
    return {
      note: draft.note,
      risk_text: draft.risk_text,
      ftu_text: draft.ftu_text,
    }
  } catch {
    return original
  }
}
