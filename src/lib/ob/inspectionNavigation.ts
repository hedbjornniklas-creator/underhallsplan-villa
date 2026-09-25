type Section<K extends string> = { key: K; partId?: string }
type Position<K extends string> = { section: K; partId: string | null }

export const inspectionNavigationKey = (inspectionId: string) => `ob:inspection-navigation:v1:${inspectionId}`

// Persist navigation only, never inspection text or permissions. Validate against
// the current inspection's menu before mounting any building-scoped editor.
export function restoreInspectionNavigation<K extends string>(
  raw: string | null,
  sections: Section<K>[],
  fallback: K,
  primaryPartId: string | null,
  forceRound = false,
): Position<K> {
  let saved: { section?: unknown; partId?: unknown } = {}
  try {
    const value: unknown = JSON.parse(raw || 'null')
    if (value && typeof value === 'object' && !Array.isArray(value)) saved = value
  } catch {}
  const partIds = new Set(sections.map(section => section.partId).filter(Boolean))
  const partId = typeof saved.partId === 'string' && partIds.has(saved.partId)
    ? saved.partId : primaryPartId
  const key = forceRound || ['runda', 'insida', 'utsida'].includes(String(saved.section)) ? 'runda-ny' : saved.section
  const match = sections.find(section => section.key === key && (!section.partId || section.partId === partId))
  const missingBuilding = saved.partId != null && saved.partId !== partId && Boolean(match?.partId)
  return { section: match && !missingBuilding ? match.key : fallback, partId }
}
