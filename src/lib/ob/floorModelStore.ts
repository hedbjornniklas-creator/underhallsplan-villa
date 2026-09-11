import type { SupabaseClient } from '@supabase/supabase-js'
import { validFloorLevels, type ObFloorModel } from './floorModel'

export async function readObFloorModel(db: SupabaseClient, inspectionId: string): Promise<ObFloorModel | null> {
  const { data, error } = await db.from('inspection_floor_models')
    .select('levels,revision').eq('inspection_id', inspectionId).maybeSingle()
  // Before the additive migration every inspection uses the legacy model.
  if (error?.code === '42P01' || error?.code === 'PGRST205') return null
  if (error) throw error
  if (!data) return null
  if (!validFloorLevels(data.levels) || !Number.isInteger(data.revision)) {
    throw new Error('Besiktningens plan kunde inte l\u00e4sas.')
  }
  return { levels: data.levels, revision: data.revision }
}
