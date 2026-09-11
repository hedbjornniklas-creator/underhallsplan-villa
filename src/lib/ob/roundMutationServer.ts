import {
  buildInteriorFloorKeysFromOverview,
  buildOverviewFloorOptionLookup,
  type OverviewFloorGroup,
} from './overviewFloors'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const isId = (value: unknown) => typeof value === 'string' && uuid.test(value)

export function validateRoundMutation(inspectionId: string, body: unknown) {
  if (!isId(inspectionId) || !object(body) || !object(body.payload))
    return false
  const { operation, payload: p } = body
  if (
    ![
      'move',
      'remove-preview',
      'remove',
      'image-note-preview',
      'image-note',
    ].includes(String(operation))
  )
    return false
  if (
    ['move', 'remove', 'image-note'].includes(String(operation)) &&
    !isId(p.requestId)
  )
    return false
  if (
    ['remove', 'image-note'].includes(String(operation)) &&
    (typeof p.token !== 'string' || !/^[a-f0-9]{32}$/.test(p.token))
  )
    return false
  if (String(operation).startsWith('image-note')) {
    if (!isId(p.imageId)) return false
    if (operation === 'image-note') {
      if (!object(p.draft)) return false
      const draft = p.draft
      if (
        !['note', 'risk_text', 'ftu_text'].every(
          (key) => typeof draft[key] === 'string' && draft[key].length <= 20000,
        )
      )
        return false
      if (draft.outcomeId !== null && !isId(draft.outcomeId)) return false
    }
    return true
  }
  if (!isId(p.id) || !['room', 'note', 'image'].includes(String(p.kind)))
    return false
  if (operation === 'move') {
    if (!object(p.from)) return false
    if (p.kind === 'room')
      return (
        typeof p.from.floor === 'string' &&
        typeof p.floor === 'string' &&
        p.floor.length <= 80
      )
    if (p.kind !== 'note' || !object(p.target)) return false
    if (
      ![p.from.roomId, p.from.observationId].every(
        (id) => id === null || isId(id),
      )
    )
      return false
    return p.target.area === 'interior'
      ? isId(p.target.roomId)
      : p.target.area === 'exterior' && isId(p.target.exteriorItemId)
  }
  return true
}

export function roundFloorKeys(context: {
  rooms: { floor_label: string }[]
  values: Record<string, unknown> | null
  groups: OverviewFloorGroup[]
}) {
  const normalize = (key: string) =>
    key
      .trim()
      .replace(/^entréplan$/, 'plan1')
      .replace(/^övrigt$/, 'ovrigt')
  return [
    ...new Set(
      [
        'ovrigt',
        ...context.rooms.map((room) => room.floor_label),
        ...buildInteriorFloorKeysFromOverview(
          context.values || {},
          buildOverviewFloorOptionLookup(context.groups),
        ),
      ]
        .map(normalize)
        .filter(Boolean),
    ),
  ]
}

export function roundMutationError(error: unknown): [number, string] {
  const message = error instanceof Error ? error.message : ''
  const errors: Record<string, [number, string]> = {
    UNAUTHORIZED: [401, 'Inte inloggad.'],
    ORG_MEMBERSHIP_REQUIRED: [403, 'Ingen organisationskoppling.'],
    OB_ROUND_FORBIDDEN: [403, 'Du får bara ändra dina egna besiktningar.'],
    OB_ROUND_LOCKED: [409, 'Besiktningen är låst.'],
    OB_ROUND_PAUSED: [
      409,
      'Besiktningen är pausad. Kontrollera uppdragsbekräftelsen.',
    ],
    OB_ROUND_NOT_FOUND: [
      409,
      'Innehållet finns inte längre. Uppdatera vyn när allt är sparat.',
    ],
    OB_ROUND_REMOVED: [
      409,
      'Innehållet har raderats. Ändringen kunde inte sparas.',
    ],
    OB_ROUND_STALE: [
      409,
      'Innehållet har ändrats. Gå tillbaka och kontrollera det igen.',
    ],
    OB_ROUND_FOREIGN: [
      409,
      'Platsen eller innehållet tillhör inte denna besiktning.',
    ],
    OB_ROUND_PLACE_REQUIRED: [
      409,
      'Bilden saknar en giltig plats. Koppla den till en befintlig notering i stället.',
    ],
    OB_ROUND_IMAGE_LINKED: [409, 'Bilden är redan kopplad till en notering.'],
    OB_ROUND_ROOM_NOT_EMPTY: [
      409,
      'Rummet innehåller uppgifter, noteringar eller bilder. Flytta eller radera innehållet först.',
    ],
    OB_ROUND_TEXT_REQUIRED: [400, 'Skriv en notering eller välj ett förslag.'],
    OB_ROUND_INVALID: [400, 'Kontrollera valet och försök igen.'],
  }
  if (errors[message]) return errors[message]
  if (
    /could not find the function.*ob_round_mutate|function.*ob_round_mutate.*does not exist/i.test(
      message,
    )
  )
    return [
      503,
      'Databasstödet för flytt, radering och nya bildnoteringar är inte installerat ännu.',
    ]
  return [
    500,
    'Åtgärden kunde inte sparas. Inga deländringar har sparats. Försök igen.',
  ]
}
