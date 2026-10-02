/** UI/report profiles within the existing OB inspection family. */
export type ObInspectionProfileKey = 'buyer' | 'seller' | 'apartment' | 'status'

export type ObInspectionProfileInput = {
  assignmentType?: unknown
  assignment_type?: unknown
  inspectionFamily?: unknown
  inspection_family?: unknown
  inspectionVariant?: unknown
  inspection_variant?: unknown
  inspectionSide?: unknown
  inspection_side?: unknown
  ordererRole?: unknown
  orderer_role?: unknown
  type?: unknown
}

const normalize = (value: unknown) => typeof value === 'string'
  ? value.replace(/\u00c3\u00a4/g, 'ä').replace(/\u00c3\u00a5/g, 'å').replace(/\u00c3\u00b6/g, 'ö')
    .trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  : ''

/** Unknown values stay unknown: callers may retain an explicit legacy default. */
export function parseObInspectionProfile(value: unknown): ObInspectionProfileKey | null {
  const token = normalize(value)
  if (token === 'sb' || token === 'stb' || token === 'status' || token.startsWith('statusbesikt')) return 'status'
  if (token.includes('sell') || token.includes('salj')) return 'seller'
  if (token.includes('apt') || token.includes('apart') || token.includes('lagen') || token === 'lgh') return 'apartment'
  if (token.includes('buy') || token.includes('kop')) return 'buyer'
  return null
}

export function resolveObInspectionProfile(input: ObInspectionProfileInput): ObInspectionProfileKey | null {
  const family = normalize(input.inspectionFamily ?? input.inspection_family)
  if (family && family !== 'ob') return null
  const assignmentType = normalize(input.assignmentType ?? input.assignment_type ?? input.type)
  if (['eb', 'tu', 'uhp'].includes(assignmentType)) return null
  const variant = normalize(input.inspectionVariant ?? input.inspection_variant)
  if (assignmentType === 'status' || variant === 'sb' || variant === 'stb') return 'status'
  return parseObInspectionProfile(input.inspectionSide ?? input.inspection_side)
    ?? parseObInspectionProfile(input.ordererRole ?? input.orderer_role)
}

export function isStatusInspection(input: ObInspectionProfileInput): boolean {
  return resolveObInspectionProfile(input) === 'status'
}

export function obInspectionProfileLabel(profile: ObInspectionProfileKey): string {
  return { buyer: 'Köpare', seller: 'Säljare', apartment: 'Lägenhet', status: 'Statusbesiktning' }[profile]
}

/** Existing house settings are shared explicitly until a separate catalogue review. */
export function obInspectionProfileAppliesTo(
  profile: ObInspectionProfileKey,
  appliesTo: readonly ObInspectionProfileKey[] | null,
): boolean {
  if (!appliesTo || appliesTo.length === 0) return true
  return appliesTo.includes(profile) || (profile === 'status' &&
    (appliesTo.includes('buyer') || appliesTo.includes('seller')))
}

export function getObInspectionClassification(profile: ObInspectionProfileKey) {
  return {
    type: profile === 'status' ? 'STATUS' as const : 'OB' as const,
    inspection_family: 'OB' as const,
    inspection_variant: profile === 'status' ? 'SB' as const : 'OB' as const,
    inspection_side: profile,
  }
}
