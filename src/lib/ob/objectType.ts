import type { ObInspectionProfileKey } from './inspectionProfile'

/** Object identity is independent of the status inspection's assignment/terms. */
export type ObObjectType = 'property' | 'apartment'

export function parseObObjectType(value: unknown): ObObjectType | null {
  return value === 'property' || value === 'apartment' ? value : null
}

/** Legacy inspections retain their profile's object type; no inference from free text. */
export function resolveObObjectType(
  profile: ObInspectionProfileKey | null | undefined,
  objectType?: unknown,
): ObObjectType {
  if (profile === 'status') return parseObObjectType(objectType) ?? 'property'
  return profile === 'apartment' ? 'apartment' : 'property'
}
