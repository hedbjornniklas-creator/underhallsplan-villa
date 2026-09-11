export type RoundTextDraft = {
  note: string
  risk_text: string
  ftu_text: string
}

// Both switches are required. Existing inspection links keep the legacy round.
export function isObMobileRoundV2Enabled(
  flag: string | undefined,
  search: string,
) {
  return (
    flag === 'true' && new URLSearchParams(search).get('round') === 'mobile-v2'
  )
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
