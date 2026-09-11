import type { SupabaseClient } from '@supabase/supabase-js'

export const MAX_ROOM_NAME_LENGTH = 120

export async function renameRoundRoom(client: SupabaseClient, inspectionId: string, roomId: string, previousName: string | null, nextName: string) {
  const name = nextName.trim()
  if (!inspectionId || !roomId || !name || name.length > MAX_ROOM_NAME_LENGTH) {
    throw Error('Ange ett rumsnamn med 1–120 tecken.')
  }
  let query = client.from('inspection_interior_rooms')
    .update({ room_label: name }).eq('inspection_id', inspectionId).eq('id', roomId)
  query = previousName === null ? query.is('room_label', null) : query.eq('room_label', previousName)
  const { data, error } = await query.select('*').maybeSingle()
  if (error) throw Error(error.message || 'Kunde inte spara rumsnamnet.')
  if (data) return data

  // A lost response may be retried, but a different name from another editor must survive.
  const { data: current, error: readError } = await client.from('inspection_interior_rooms')
    .select('*').eq('inspection_id', inspectionId).eq('id', roomId).maybeSingle()
  if (readError) throw Error(readError.message || 'Kunde inte kontrollera rumsnamnet.')
  if (current?.room_label === name) return current
  throw Error('Rummet har ändrats eller tagits bort. Uppdatera sidan och kontrollera namnet igen.')
}
