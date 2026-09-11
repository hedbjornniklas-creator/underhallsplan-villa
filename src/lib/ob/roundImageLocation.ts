import type { InspectionControlItem, InspectionExteriorObservation, RoundImage } from '@/components/ob/ObStepRunda'

export function roundImageLocation(image: RoundImage, notes: InspectionControlItem[], observations: InspectionExteriorObservation[]): { roomId: string | null; exteriorItemId: string | null } {
  const note = image.control_item_id ? notes.find(row => row.id === image.control_item_id) : null
  const current = note && (note.interior_room_id || note.exterior_observation_id) ? note : image
  if (current.interior_room_id) return { roomId: current.interior_room_id, exteriorItemId: null }
  if (current.exterior_observation_id) return { roomId: null,
    exteriorItemId: observations.find(row => row.id === current.exterior_observation_id)?.exterior_item_id ?? null }
  // Origin is a fallback only when no current placement exists, never a second room.
  if (image.origin_interior_room_id) return { roomId: image.origin_interior_room_id, exteriorItemId: null }
  return { roomId: null, exteriorItemId:
    (image.origin_exterior_observation_id ? observations.find(row => row.id === image.origin_exterior_observation_id)?.exterior_item_id : null) || image.origin_exterior_item_id || null }
}
