import type {
  InteriorRoom,
  InspectionControlItem,
  InspectionExteriorObservation,
  SettingsExteriorItem,
  RoundImage,
} from '@/components/ob/ObStepRunda'

export type MoveTarget =
  | { area: 'interior'; roomId: string }
  | { area: 'exterior'; exteriorItemId: string }
export type MoveRequest = (
  | { kind: 'room'; id: string; from: { floor: string }; floor: string }
  | {
      kind: 'note'
      id: string
      from: { roomId: string | null; observationId: string | null }
      target: MoveTarget
    }
) & { requestId: string; targetBuildingPartId?: string }
export type MoveResult = {
  movedOut?: boolean
  room: InteriorRoom | null
  note: InspectionControlItem | null
  images: RoundImage[]
  observation: InspectionExteriorObservation | null
}
export type RemovalRequest = { kind: 'note' | 'room' | 'image'; id: string }
export type RemovalPreview = RemovalRequest & {
  token: string
  label: string
  counts: { notes: number; images: number; quickNotes: number }
  blockedReason: string | null
}
export type RemovalResult = {
  roomId: string | null
  noteIds: string[]
  imageIds: string[]
  quickNoteIds: string[]
  images: RoundImage[]
  archiveId: string
}
export type ImageNoteDraft = {
  note: string
  risk_text: string
  ftu_text: string
  outcomeId: string | null
}
export type ImageNotePreview = {
  token: string
  room: InteriorRoom | null
  observation: InspectionExteriorObservation | null
  exteriorItem: SettingsExteriorItem | null
}
export type ImageNoteRequest = {
  imageId: string
  target?: MoveTarget
  token: string
  requestId: string
  draft: ImageNoteDraft
}
export type ImageNoteResult = {
  note: InspectionControlItem | null
  image: RoundImage | null
  observation: InspectionExteriorObservation | null
}
export type RoundMutationOperation =
  | 'move'
  | 'remove-preview'
  | 'remove'
  | 'image-note-preview'
  | 'image-note'

export async function requestRoundMutation<T>(
  inspectionId: string,
  operation: RoundMutationOperation,
  payload: object,
): Promise<T> {
  const response = await fetch(
    `/api/ob/inspections/${encodeURIComponent(inspectionId)}/round`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation, payload }),
    },
  )
  const result = await response.json().catch(() => null)
  if (!response.ok || !result || result.error)
    throw Error(result?.error || 'Åtgärden kunde inte sparas. Försök igen.')
  return result.data as T
}
