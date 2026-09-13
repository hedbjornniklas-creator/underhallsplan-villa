import type { ObFloorModel } from './floorModel'

export type ObBuildingPart = {
  id: string
  inspection_id: string
  building_id: string
  name: string
  category_key: string
  cover_path: string | null
  scope_note: string | null
  sort_order: number
  revision: number
  floor_model: ObFloorModel | null
}
export type ObBuildingStructure = { inspection_id: string; primary_part_id: string; revision: number }
export type ObBuildingOverview = {
  activationToken?: string | null
  available: boolean
  structure: ObBuildingStructure | null
  parts: ObBuildingPart[]
  buildings: { id: string; name: string }[]
  categories: { key: string; label: string }[]
}
export const EMPTY_BUILDING_OVERVIEW: ObBuildingOverview = {
  available: false, structure: null, parts: [], buildings: [], categories: [],
}
export type ObBuildingContextValue = {
  inspectionId: string
  overview: ObBuildingOverview
  part: ObBuildingPart | null
  reload: () => Promise<void>
}
export function buildingDraftScope(inspectionId: string, partId?: string | null) {
  return partId ? `${inspectionId}:building:${partId}` : inspectionId
}
export function buildingCoverPath(part: ObBuildingPart | null, primaryPartId: string | null, legacyPath: string | null) {
  return part?.cover_path || (!part || part.id === primaryPartId ? legacyPath : null)
}
export async function requestBuildingCommand<T>(inspectionId: string, operation: string, payload: object = {}): Promise<T> {
  const response = await fetch(`/api/ob/inspections/${encodeURIComponent(inspectionId)}/buildings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation, payload }),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok || !body || body.error) throw Error(body?.error || 'Byggnadsuppgifterna kunde inte sparas.')
  return body.data as T
}
