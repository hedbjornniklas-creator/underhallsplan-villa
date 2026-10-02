export type RoundTextDraft = {
  note: string
  risk_text: string
  ftu_text: string
  recommendation_text?: string
  comment_text?: string
}

export function isObRoundSection(section: string) {
  return section === 'runda' || section === 'runda-ny'
}

// URL hint only; the inspection page also validates its saved navigation.
export function getInitialObSection(search: string): 'grunddata' | 'runda-ny' {
  const params = new URLSearchParams(search)
  return params.get('round') === 'mobile-v2' || ['runda', 'runda-ny', 'insida', 'utsida'].includes(params.get('section') ?? '')
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
    // A draft made under the other legal profile must never overwrite the
    // current profile's fields. Its original key remains available for review.
    const isStatus = original.recommendation_text !== undefined
    if (isStatus !== (typeof draft.recommendation_text === 'string' && typeof draft.comment_text === 'string'))
      return original
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
      ...(original.recommendation_text !== undefined ? {
        recommendation_text: typeof draft.recommendation_text === 'string'
          ? draft.recommendation_text : original.recommendation_text,
        comment_text: typeof draft.comment_text === 'string'
          ? draft.comment_text : original.comment_text ?? '',
      } : {}),
    }
  } catch {
    return original
  }
}
