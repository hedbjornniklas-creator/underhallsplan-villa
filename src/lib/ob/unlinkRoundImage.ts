import type { SupabaseClient } from '@supabase/supabase-js'

export async function unlinkRoundImage(
  client: SupabaseClient,
  inspectionId: string,
  imageId: string,
  expectedNoteId: string,
) {
  if (!inspectionId || !imageId || !expectedNoteId) throw Error('Bildens koppling saknas.')
  const { data, error } = await client.from('inspection_images')
    .update({ control_item_id: null, processing_status: 'unprocessed', ignored_at: null })
    .eq('inspection_id', inspectionId)
    .eq('id', imageId)
    .eq('control_item_id', expectedNoteId)
    .select('*')
    .maybeSingle()
  if (error) throw Error(error.message || 'Kunde inte koppla loss bilden.')
  if (data) return data

  // A lost response can be retried, but never detach a different note's image.
  const { data: current, error: readError } = await client.from('inspection_images')
    .select('*').eq('inspection_id', inspectionId).eq('id', imageId).maybeSingle()
  if (readError) throw Error(readError.message || 'Kunde inte kontrollera bildens koppling.')
  if (current && current.control_item_id === null && current.processing_status === 'unprocessed') return current
  throw Error('Bildens koppling har ändrats. Uppdatera bildlistan och försök igen.')
}
