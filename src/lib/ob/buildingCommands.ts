import { validFloorLevels } from './floorModel'
import { validateRoundMutation } from './roundMutationServer'

export const BUILDING_ROW_FIELDS = {
  inspection_interior_rooms: ['floor_label','order_index','room_type_key','room_label','values','note'],
  inspection_exterior_observations: ['exterior_item_id','part_label','values','is_free_note','note','risk_text','ftu_text'],
  inspection_control_items: ['interior_room_id','exterior_observation_id','control_point_id','title','status','note','risk_text','ftu_text','sort_order','selected_outcome_id'],
  inspection_images: ['interior_room_id','exterior_observation_id','control_item_id','file_path','label','sort_order','capture_source','source_area','origin_building_part_id',
    'origin_interior_room_id','origin_exterior_observation_id','origin_exterior_item_id','origin_floor_label','origin_room_label','origin_room_type_key','origin_exterior_item_key',
    'captured_at','processing_status','ignored_at'],
  inspection_round_quick_notes: ['source_area','interior_room_id','exterior_observation_id','exterior_item_id','note'],
  inspection_overview_selections: ['overview_item_id','floor_key','set_index','values','note'],
  ob_building_conditions: ['furnishing_level','special_conditions','building_type','building_year','building_form','building_subtype','foundation','frame','joists','facade','windows','roof','heating','ventilation','water','sewer'],
} as const
export type ObBuildingTable = keyof typeof BUILDING_ROW_FIELDS
export const isBuildingId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const shortText = (v: unknown) => typeof v === 'string' && v.trim().length > 0 && v.length <= 100

export function validateBuildingCommand(inspectionId: string, body: unknown): body is { operation: string; payload: Record<string, unknown> } {
  if (!isBuildingId(inspectionId) || !object(body) || !object(body.payload)) return false
  const p = body.payload
  if (body.operation === 'rows') return isBuildingId(p.partId) && Array.isArray(p.rows) && p.rows.length > 0 && p.rows.length <= 50
    && p.rows.every(row => object(row) && row.partId === p.partId && validateBuildingCommand(inspectionId, { operation: 'row', payload: row }))
  if (body.operation === 'round') return isBuildingId(p.partId)
    && (p.targetBuildingPartId === undefined || isBuildingId(p.targetBuildingPartId))
    && validateRoundMutation(inspectionId, { operation: p.operation, payload: p })
  if (!isBuildingId(p.requestId)) return false
  if (body.operation === 'activate' || body.operation === 'add') return shortText(p.name)
    && (p.buildingId === null || isBuildingId(p.buildingId))
    && (body.operation === 'activate' ? p.confirmed === true && typeof p.activationToken === 'string' && /^[a-f0-9]{32}$/.test(p.activationToken) : shortText(p.categoryKey))
  if (!isBuildingId(p.partId)) return false
  if (body.operation === 'row') {
    if (!isBuildingId(p.id) || !object(p.row) || !Object.hasOwn(BUILDING_ROW_FIELDS, String(p.table))
      || !['insert','update','delete'].includes(String(p.operation))) return false
    if (p.operation !== 'insert' && (!Number.isInteger(p.revision) || Number(p.revision) < 1)) return false
    if (p.operation === 'delete' && p.table !== 'inspection_overview_selections') return false
    const fields: readonly string[] = BUILDING_ROW_FIELDS[p.table as ObBuildingTable]
    if (!Object.keys(p.row).every(key => fields.includes(key))) return false
    if (Object.values(p.row).some(v => typeof v === 'string' && v.length > 30000)) return false
    // Upload creates immutable capture metadata. Ordinary edits only alter current placement.
    if (p.table === 'inspection_images') {
      if (p.operation === 'insert') return typeof p.row.file_path === 'string'
        && p.row.file_path.startsWith(`${inspectionId}/round/`) && !p.row.file_path.includes('..')
        && p.row.origin_building_part_id === p.partId
      return Object.keys(p.row).every(key => ['interior_room_id','exterior_observation_id','control_item_id','label','sort_order','processing_status','ignored_at'].includes(key))
    }
    return true
  }
  if (!Number.isInteger(p.revision) || Number(p.revision) < 1) return false
  if (body.operation === 'floors') return validFloorLevels(p.levels)
  if (body.operation === 'remove') return true
  if (body.operation !== 'edit') return false
  return (p.name === undefined || shortText(p.name)) && (p.categoryKey === undefined || shortText(p.categoryKey))
    && (p.scopeNote === undefined || p.scopeNote === null || typeof p.scopeNote === 'string' && p.scopeNote.length <= 10000)
    && (p.coverPath === undefined || p.coverPath === null || typeof p.coverPath === 'string'
      && p.coverPath.startsWith(`${inspectionId}/building-covers/${p.partId}/`) && !p.coverPath.includes('..'))
}
