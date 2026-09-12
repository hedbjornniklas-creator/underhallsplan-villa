import type { SupabaseClient } from '@supabase/supabase-js'
import type { ObBuildingPart, ObBuildingStructure } from './buildingStructure'
import { validFloorLevels } from './floorModel'

export async function readBuildingReportState(db: SupabaseClient, inspectionId: string) {
  const { data: structure, error } = await db.from('ob_inspection_structure').select('*').eq('inspection_id', inspectionId).maybeSingle()
  if (error?.code === '42P01' || error?.code === 'PGRST205') return null
  if (error) throw error
  if (!structure) return null
  const { data, error: partsError } = await db.from('ob_inspection_buildings').select('*').eq('inspection_id', inspectionId).order('sort_order').order('id')
  if (partsError) throw partsError
  const { data: floors, error: floorsError } = await db.from('ob_building_floor_models').select('*').eq('inspection_id', inspectionId)
  if (floorsError) throw floorsError
  const parts: ObBuildingPart[] = (data ?? []).map(part => {
    const model = floors?.find(floor => floor.building_part_id === part.id)
    if (!model || model.levels !== null && !validFloorLevels(model.levels)) throw Error('Byggnadens planmodell saknas eller är ogiltig.')
    return { ...part, floor_model: model.levels === null ? null : { levels: model.levels, revision: model.revision } } as ObBuildingPart
  })
  if (!parts.some(part => part.id === structure.primary_part_id)) throw Error('Besiktningens huvudbyggnad saknas.')
  return { structure: structure as ObBuildingStructure, parts }
}

export async function assertBuildingReportRevision(db: SupabaseClient, inspectionId: string, revision: number) {
  const { data, error } = await db.from('ob_inspection_structure').select('revision').eq('inspection_id', inspectionId).single()
  if (error) throw error
  if (data.revision !== revision) throw Error('Besiktningen ändrades medan utlåtandet skapades. Försök igen.')
}
