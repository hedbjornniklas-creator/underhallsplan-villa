import { useEffect, useRef, useState } from 'react'
import ObMobileRound, {
  type ObMobileRoundProps,
} from '../../src/components/ob/ObMobileRound'
import { hasObTextDraftsForInspection, hasObTextDraftsForRoundTarget } from '../../src/lib/ob/localTextDrafts'
import { queueImageBatch, unplacedImagePlacement } from '../../src/lib/ob/roundImageImport'
import { putRoundImageUploadItem, listRoundImageUploadItems } from '../../src/lib/ob/roundImageUploadQueue'
import { ObFloorContext, useObFloorModel } from '../../src/components/ob/ObFloorProvider'
import { ObFloorEditor } from '../../src/components/ob/ObFloorEditor'
import { copyObOutcomeText } from '../../src/lib/ob/noteText'
import ObRoundSheet from '../../src/components/ob/ObRoundSheet'
import { floorModelKeys, modelFloorLabel, type ObFloorModel } from '../../src/lib/ob/floorModel'
import type { MoveTarget } from '../../src/lib/ob/roundMutations'
import type { TrashedRoundImage } from '../../src/lib/ob/imageTrash'

type Note = ObMobileRoundProps['notes'][number]
type Room = ObMobileRoundProps['rooms'][number]
type Image = ObMobileRoundProps['images'][number]
const inspectionId = 'synthetic-mobile-inspection'
const newFloors = new URLSearchParams(location.search).has('levels')
const imagePlaceFixture = new URLSearchParams(location.search).has('image-place')
const searchOrderFixture = new URLSearchParams(location.search).has('search-order')
const rooms: Room[] = [
  {
    id: 'room-1',
    inspection_id: inspectionId,
    floor_label: newFloors ? 'plan0' : 'plan1',
    room_type_key: 'hall',
    room_label: 'Hall',
    order_index: 10,
    values: {},
    note: null,
  },
  {
    id: 'room-2',
    inspection_id: inspectionId,
    floor_label: newFloors ? 'plan1' : 'plan2',
    room_type_key: 'hall',
    room_label: 'Sovrum med ett mycket långt rumsnamn',
    order_index: 20,
    values: {},
    note: null,
  },
]
if (new URLSearchParams(location.search).has('swipe')) {
  // Deliberately unsorted, with another floor interleaved in the source array.
  rooms.push(
    { ...rooms[0], id: 'room-3', room_label: 'Kök', order_index: 0 },
    { ...rooms[0], id: 'room-4', room_label: 'Vardagsrum', order_index: 30 },
  )
}
const note: Note = {
  id: 'note-1',
  inspection_id: inspectionId,
  interior_room_id: 'room-1',
  exterior_observation_id: null,
  control_point_id: null,
  title: 'Fri notering',
  note: 'Spricka vid dörr.',
  risk_text: null,
  ftu_text: null,
  status: 'remark',
  selected_outcome_id: null,
  sort_order: 10,
}
const initialNotes: Note[] = [
  note,
  { ...note, id: 'empty-note', note: '' },
  {
    ...note,
    id: 'outside-note',
    interior_room_id: null,
    exterior_observation_id: 'observation-extra',
    note: 'Skada på andra fasaddelen.',
  },
]
const initialImages: Image[] = [
  {
    id: 'photo-1',
    inspection_id: inspectionId,
    control_item_id: null,
    interior_room_id: 'room-1',
    exterior_observation_id: null,
    file_path: '/photo.png',
    label: 'Testbild',
    sort_order: 10,
  },
]
if (imagePlaceFixture) {
  initialImages[0] = { ...initialImages[0], interior_room_id: null, processing_status: 'unprocessed', source_area: null }
}
if (new URLSearchParams(location.search).has('image-origin')) {
  initialImages[0] = { ...initialImages[0], interior_room_id: null, origin_interior_room_id: 'room-2', origin_room_label: 'Sovrum' }
}
if (new URLSearchParams(location.search).has('image-origin-exterior')) {
  initialImages[0] = { ...initialImages[0], interior_room_id: null, origin_exterior_observation_id: 'observation-extra', origin_exterior_item_id: 'exterior-1' }
}
if (new URLSearchParams(location.search).has('linked')) {
  initialImages[0] = { ...initialImages[0], control_item_id: 'note-1', processing_status: 'linked',
    origin_interior_room_id: 'room-2', origin_room_label: 'Sovrum', captured_at: '2026-09-11T09:00:00Z' }
}
if (new URLSearchParams(location.search).has('imagebank')) {
  initialImages.push(
    { ...initialImages[0], id: 'bank-origin', label: 'Ursprung', interior_room_id: null, origin_interior_room_id: 'room-1' },
    { ...initialImages[0], id: 'bank-other', label: 'Annat rum', interior_room_id: 'room-2' },
    { ...initialImages[0], id: 'bank-unplaced', label: 'Uppladdad', interior_room_id: null },
    { ...initialImages[0], id: 'bank-ignored', processing_status: 'ignored' },
    { ...initialImages[0], id: 'bank-linked', control_item_id: 'empty-note', processing_status: 'linked' },
  )
}
if (new URLSearchParams(location.search).has('room-images')) {
  initialImages.push(
    { ...initialImages[0], id: 'room-linked', control_item_id: 'note-1', origin_interior_room_id: 'room-2', processing_status: 'linked' },
    { ...initialImages[0], id: 'room-moved', interior_room_id: 'room-2', origin_interior_room_id: 'room-1' },
    { ...initialImages[0], id: 'room-outside', interior_room_id: null, exterior_observation_id: 'observation-extra', origin_interior_room_id: 'room-1' },
    { ...initialImages[0], id: 'room-unplaced', interior_room_id: null },
  )
}
if (new URLSearchParams(location.search).has('image-preview-nav')) {
  initialImages[0] = { ...initialImages[0], file_path: '/photo.png?image=first', label: 'Första bilden', sort_order: 40 }
  // Pending navigation follows the rendered source order, not IDs or sort_order.
  // Interleaved linked/ignored rows are excluded only in the unmatched filter.
  initialImages.push(
    { ...initialImages[0], id: 'preview-linked', file_path: '/photo.png?image=linked', control_item_id: 'note-1', processing_status: 'linked' },
    { ...initialImages[0], id: 'preview-middle', file_path: '/photo.png?image=middle', label: 'Andra bilden', interior_room_id: 'room-2', sort_order: 10 },
    { ...initialImages[0], id: 'preview-ignored', file_path: '/photo.png?image=ignored', processing_status: 'ignored' },
    { ...initialImages[0], id: 'preview-exterior', file_path: '/photo.png?image=exterior', label: 'Tredje bilden', interior_room_id: null, exterior_observation_id: 'observation-extra', sort_order: 30 },
    { ...initialImages[0], id: 'preview-unplaced', file_path: '/photo.png?image=unplaced', label: 'Fjärde bilden', interior_room_id: null, processing_status: 'linked', sort_order: 20 },
  )
}
const exteriorItems = [
  {
    id: 'exterior-1',
    key: 'fasad',
    label: 'Fasad',
    is_active: true,
    sort_order: 10,
  },
]
if (imagePlaceFixture) {
  exteriorItems.push({ id: 'exterior-2', key: 'grund', label: 'Grund', is_active: true, sort_order: 20 })
}
if (new URLSearchParams(location.search).has('swipe')) {
  // Rendered order deliberately differs from IDs, labels, and sort_order.
  exteriorItems.unshift({ id: 'exterior-3', key: 'tak', label: 'Tak', is_active: true, sort_order: 30 })
  exteriorItems.push({ id: 'exterior-2', key: 'grund', label: 'Grund', is_active: true, sort_order: 20 })
}
const observations = ['observation-1', 'observation-extra'].map((id) => ({
  id,
  inspection_id: inspectionId,
  exterior_item_id: 'exterior-1',
  part_label: null,
  values: {},
  note: null,
}))
if (imagePlaceFixture) {
  observations.push({ ...observations[0], id: 'observation-2', exterior_item_id: 'exterior-2' })
}
const qa = {
  failTrashLoad: false,
  failRestore: false,
  trash: [] as TrashedRoundImage[],
  failSaves: false,
  failAdds: false,
  holdAdds: false,
  partialLink: false,
  holdLinks: false,
  holdUnlink: false,
  holdSuggestion: false,
  failSuggestion: false,
  holdRename: false,
  failRename: false,
  holdImagePreviews: [] as string[],
  failImagePreview: false,
  failImageCreate: false,
  dropMutationResponse: false,
  delayMs: 0,
  calls: [] as Array<{ kind: string; id: string; patch?: unknown }>,
  notes: initialNotes,
  images: initialImages,
  rooms,
  exteriorItems,
  observations,
  completeUpload: () => {},
  hasDrafts: () => hasObTextDraftsForInspection(inspectionId),
  imageQueue: () => listRoundImageUploadItems(inspectionId),
}
Object.assign(window, { __obMobileTest: qa })

type FixtureProps = {
  onOpenStepMenu?: () => void
  buildingName?: string
  storageKey?: string
}
function Fixture({ onOpenStepMenu, buildingName, storageKey = 'fixture-notes' }: FixtureProps) {
  const [legacyNotes, setLegacyNotes] = useState<import('@/components/ob/ObStepRunda').InspectionExteriorObservation[]>(new URLSearchParams(location.search).has('legacy-notes') ? [{
    ...observations[0], id: 'legacy-observation', part_label: 'Äldre fasadnotering', is_free_note: true,
    note: 'Spricka vid fönster', risk_text: 'Risk för fukt', ftu_text: 'Kontrollera anslutning',
  }] : [])
  const { model } = useObFloorModel()
  const [mutating, setMutating] = useState(false)
  const [trashed, setTrashed] = useState<TrashedRoundImage[]>(() => new URLSearchParams(location.search).has('trash') ? [{
    eventId: 'trash-event-1', deletedAt: new Date(Date.now() - 86400000).toISOString(),
    expiresAt: new Date(Date.now() + 29 * 86400000).toISOString(), daysRemaining: 29,
    image: { ...initialImages[0], id: 'deleted-image-1', label: 'Raderad testbild' },
  }] : [])
  useEffect(() => { qa.trash = trashed }, [trashed])
  const receipts = useRef(new Map<string, unknown>())
  const [roomRows, setRoomRows] = useState(rooms)
  const [notes, setNotes] = useState<Note[]>(
    () =>
      JSON.parse(localStorage.getItem(storageKey) || 'null') ||
      initialNotes,
  )
  const [images, setImages] = useState<Image[]>(() =>
    new URLSearchParams(location.search).has('empty-images') ? [] : new URLSearchParams(location.search).has('queued')
      ? initialImages.map((image) => ({
          ...image,
          local_queue_id: 'queue-1',
          local_upload_status: 'uploading',
        }))
      : new URLSearchParams(location.search).has('legacy-notes')
        ? [...initialImages, { ...initialImages[0], id: 'legacy-image', interior_room_id: null, control_item_id: null, exterior_observation_id: 'legacy-observation' }]
        : initialImages,
  )
  const [area, setArea] = useState<'interior' | 'exterior'>('interior')
  const [exteriorId, setExteriorId] = useState('exterior-1')
  const [floor, setFloor] = useState(newFloors ? 'plan0' : 'plan1'),
    [roomId, setRoomId] = useState('room-1')
  const [menu, setMenu] = useState(false)
  const cameraInput = useRef<HTMLInputElement>(null)
  const galleryInput = useRef<HTMLInputElement>(null)
  const mediaNote = useRef<string | null>(null)
  function addPreviewFiles(files: File[], noteId: string | null) {
    setImages(rows => [...rows, ...files.filter(file => file.type.startsWith('image/')).map((file, index) => ({
      ...initialImages[0], id: crypto.randomUUID(), file_path: URL.createObjectURL(file),
      label: file.name, control_item_id: noteId, interior_room_id: area === 'interior' ? roomId : null,
      exterior_observation_id: area === 'exterior' ? 'observation-1' : null,
      processing_status: noteId ? 'linked' as const : 'unprocessed' as const,
      sort_order: 100 + index,
    }))])
  }
  const locked = new URLSearchParams(location.search).has('locked')
  const paused = new URLSearchParams(location.search).has('paused')
  useEffect(() => {
    qa.notes = notes
    qa.images = images
    qa.rooms = roomRows
  }, [notes, images, roomRows])
  useEffect(() => {
    qa.completeUpload = () =>
      setImages((rows) =>
        rows.map((image) => ({
          ...image,
          local_queue_id: undefined,
          local_upload_status: undefined,
        })),
      )
    return () => {
      qa.completeUpload = () => {}
    }
  }, [])
  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(notes))
  }, [notes, storageKey])
  const activeRoom = roomRows.find((room) => room.id === roomId) || null
  function createNote(patch: Partial<Note>) {
    const next = {
      ...note,
      id: crypto.randomUUID(),
      interior_room_id: area === 'interior' ? roomId : null,
      exterior_observation_id: area === 'exterior' ? 'observation-1' : null,
      note: '',
      ...patch,
    }
    setNotes((rows) => [...rows, next])
    qa.calls.push({ kind: 'create', id: next.id })
    return next
  }
  async function mutate<T>(
    kind: string,
    requestId: string,
    action: () => T,
    target?: { kind: string; id: string },
  ): Promise<T> {
    if (target && hasObTextDraftsForRoundTarget(inspectionId, target, notes)) {
      throw Error('Det finns osparad text för det valda innehållet.')
    }
    qa.calls.push({ kind, id: requestId })
    setMutating(true)
    try {
      await new Promise((resolve) => setTimeout(resolve, qa.delayMs))
      if (kind === 'image-note' && qa.failImageCreate) throw Error('Synthetic image note failure')
      if (!receipts.current.has(requestId))
        receipts.current.set(requestId, action())
      if (qa.dropMutationResponse) {
        qa.dropMutationResponse = false
        throw Error('Synthetic lost response')
      }
      return receipts.current.get(requestId) as T
    } finally {
      setMutating(false)
    }
  }
  return (
    <main data-ob-mobile-round="true">
      {buildingName && <>
        <input hidden ref={cameraInput} type="file" accept="image/*" capture="environment" aria-label="Testkamera"
          onChange={event => { addPreviewFiles(Array.from(event.target.files ?? []), mediaNote.current); event.target.value = '' }} />
        <input hidden ref={galleryInput} type="file" accept="image/*" multiple aria-label="Testbilder"
          onChange={event => { addPreviewFiles(Array.from(event.target.files ?? []), mediaNote.current); event.target.value = '' }} />
      </>}
      <fieldset disabled={paused} style={{ padding: 0, margin: 0, border: 0 }}>
        <div className="ob-mobile-round-host [&_textarea]:text-sm [&_textarea]:leading-5">
          <ObMobileRound
            inspectionId={inspectionId}
            buildingName={buildingName}
            scopeId={buildingName ? storageKey : undefined}
            inspectionSide="buyer"
            address="Testgatan 1 (syntetiskt objekt)"
            onOpenMenu={onOpenStepMenu ?? (() => setMenu(true))}
            pointApplies={() => true}
            pointMatchesRoom={(point, roomType) => !searchOrderFixture || (Array.isArray(point.trigger_room_types) && point.trigger_room_types.includes(roomType))}
            locked={locked}
            mutationBlocked={
              mutating || images.some((image) => image.local_queue_id)
            }
            area={area}
            activeFloor={floor}
            rooms={roomRows}
            roomTypes={[
              {
                id: 'type-1',
                key: 'hall',
                label: 'Hall',
                sort_order: 10,
                is_active: true,
              },
            ]}
            floors={model ? ['ovrigt', ...floorModelKeys(model)] : ['plan1', 'plan2']}
            floorLabel={(key) => model ? modelFloorLabel(model, key) : (key === 'plan2' ? 'Plan 2' : 'Plan 1')}
            floorKey={(key) => key}
            activeRoom={activeRoom}
            exteriorItems={exteriorItems}
            activeExteriorItem={exteriorItems.find(item => item.id === exteriorId) ?? null}
            observations={observations}
            legacyExteriorNotes={legacyNotes}
            onUpdateLegacyNote={async (id, patch) => {
              if (qa.failSaves) throw Error('Test save failure')
              qa.calls.push({ kind: 'legacy-note', id, patch })
              setLegacyNotes(rows => rows.map(row => row.id === id ? { ...row, ...patch } : row))
            }}
            notes={notes}
            images={images}
            quickNotes={[]}
            imageSrc={(image) => image.file_path}
            onArea={setArea}
            onFloor={setFloor}
            onRoom={(room) => {
              setRoomId(room.id!)
              setFloor(room.floor_label)
              setArea('interior')
            }}
            onExterior={(item) => {
              setExteriorId(item.id)
              setArea('exterior')
            }}
            onAddRoom={async (type, label) => {
              const room = {
                ...rooms[0],
                id: crypto.randomUUID(),
                floor_label: floor,
                room_type_key: type,
                room_label: label || 'Hall',
              }
              setRoomRows((rows) => [...rows, room])
              return room
            }}
            onNewNote={async () => createNote({})}
            onAddOutcome={async (point, outcome) => {
              if (searchOrderFixture) qa.calls.push({ kind: 'add-outcome', id: outcome.id })
              while (qa.holdAdds) await new Promise(resolve => setTimeout(resolve, 20))
              if (qa.failAdds) throw Error('Synthetic add failure')
              return createNote({
                control_point_id: point.id,
                selected_outcome_id: outcome.id,
                title: point.title,
                ...copyObOutcomeText(outcome),
              })
            }}
            onUpdateNote={async (id, patch) => {
              qa.calls.push({ kind: 'save', id, patch })
              await new Promise((resolve) => setTimeout(resolve, qa.delayMs))
              if (qa.failSaves) throw Error('Synthetic save failure')
              setNotes((rows) =>
                rows.map((row) => (row.id === id ? { ...row, ...patch } : row)),
              )
            }}
            onCamera={(id) => {
              qa.calls.push({ kind: 'camera', id: id || 'place' })
              if (buildingName) { mediaNote.current = id; cameraInput.current?.click() }
            }}
            onGallery={(id) => {
              qa.calls.push({ kind: 'gallery', id: id || 'place' })
              if (buildingName) { mediaNote.current = id; galleryInput.current?.click() }
            }}
            onImportImages={files => queueImageBatch(files, async (file, index) => {
              if (buildingName) {
                setImages(rows => [...rows, { ...initialImages[0], id: crypto.randomUUID(), file_path: URL.createObjectURL(file),
                  label: file.name, interior_room_id: null, exterior_observation_id: null, control_item_id: null,
                  processing_status: 'unprocessed', sort_order: 100 + index }])
                return
              }
              qa.calls.push({ kind: 'import', id: file.name })
              await new Promise(resolve => setTimeout(resolve, qa.delayMs))
              if (qa.failSaves) throw Error('Synthetic local save failure')
              const id = crypto.randomUUID(), capturedAt = new Date().toISOString()
              const placement = unplacedImagePlacement()
              await putRoundImageUploadItem({
                id, serverImageId: id, inspectionId, blob: file, originalName: file.name,
                contentType: file.type, storagePath: `synthetic/${id}`, capturedAt,
                createdAt: capturedAt, updatedAt: capturedAt, status: 'queued', attempts: 0,
                error: null, sortOrder: 100 + index * 10, ...placement,
              })
              setImages(rows => [...rows, {
                id, inspection_id: inspectionId, file_path: URL.createObjectURL(file),
                label: file.name, sort_order: 100 + index * 10, source_area: placement.sourceArea,
                ...placement.origin, ...placement.link, local_queue_id: id, local_upload_status: 'queued',
              }])
            })}
            onLinkImage={async (image, target) => {
              if (image.local_queue_id) throw Error('Stale queued image')
              qa.calls.push({ kind: 'link', id: target.id! })
              setImages((rows) =>
                rows.map((row) =>
                  row.id === image.id
                    ? { ...row, control_item_id: target.id! }
                    : row,
                ),
              )
              return true
            }}
            onLinkImages={async (selected, target) => {
              qa.calls.push({ kind: 'link-batch', id: target.id!, patch: selected.map(image => image.id) })
              setMutating(true)
              try {
                while (qa.holdLinks) await new Promise(resolve => setTimeout(resolve, 20))
                await new Promise(resolve => setTimeout(resolve, qa.delayMs))
                if (qa.failSaves) throw Error('Synthetic image link failure')
                const ids = new Set((qa.partialLink ? selected.slice(0, 1) : selected).map(image => image.id))
                setImages(rows => rows.map(row => ids.has(row.id) && !row.control_item_id ? {
                  ...row, control_item_id: target.id!, interior_room_id: target.interior_room_id,
                  exterior_observation_id: target.exterior_observation_id, processing_status: 'linked',
                } : row))
                return !qa.partialLink
              } finally {
                setMutating(false)
              }
            }}
            onUnlinkImage={async (image, target) => {
              qa.calls.push({ kind: 'unlink', id: image.id, patch: { noteId: target.id } })
              setMutating(true)
              try {
                while (qa.holdUnlink) await new Promise(resolve => setTimeout(resolve, 20))
                await new Promise(resolve => setTimeout(resolve, qa.delayMs))
                if (qa.failSaves) throw Error('Synthetic unlink failure')
                if (images.find(row => row.id === image.id)?.control_item_id !== target.id) throw Error('Changed image link')
                setImages(rows => rows.map(row => row.id === image.id ? {
                  ...row, control_item_id: null, processing_status: 'unprocessed', ignored_at: null,
                } : row))
              } finally {
                setMutating(false)
              }
            }}
            onSuggestNote={async suggestion => {
              qa.calls.push({ kind: 'suggestion', id: suggestion.noteId, patch: suggestion })
              while (qa.holdSuggestion) await new Promise(resolve => setTimeout(resolve, 20))
              if (qa.failSuggestion) throw Error('Synthetic suggestion failure')
            }}
            onRenameRoom={async (room, name) => {
              qa.calls.push({ kind: 'rename', id: room.id!, patch: { room_label: name } })
              setMutating(true)
              try {
                while (qa.holdRename) await new Promise(resolve => setTimeout(resolve, 20))
                if (qa.failRename) throw Error('Synthetic rename failure')
                const updated = { ...room, room_label: name }
                setRoomRows(rows => rows.map(row => row.id === room.id ? updated : row))
                return updated
              } finally { setMutating(false) }
            }}
            onMove={(request) =>
              mutate('move', request.requestId, () => {
                if (request.kind === 'room') {
                  const room = {
                    ...roomRows.find((row) => row.id === request.id)!,
                    floor_label: request.floor,
                  }
                  setRoomRows((rows) =>
                    rows.map((row) => (row.id === room.id ? room : row)),
                  )
                  return { room, note: null, images: [], observation: null }
                }
                const moved = {
                  ...notes.find((row) => row.id === request.id)!,
                  interior_room_id:
                    request.target.area === 'interior'
                      ? request.target.roomId
                      : null,
                  exterior_observation_id:
                    request.target.area === 'exterior' ? 'observation-1' : null,
                }
                const linked = images
                  .filter((row) => row.control_item_id === moved.id)
                  .map((row) => ({
                    ...row,
                    interior_room_id: moved.interior_room_id,
                    exterior_observation_id: moved.exterior_observation_id,
                  }))
                setNotes((rows) =>
                  rows.map((row) => (row.id === moved.id ? moved : row)),
                )
                setImages((rows) =>
                  rows.map(
                    (row) => linked.find((image) => image.id === row.id) || row,
                  ),
                )
                return {
                  room: null,
                  note: moved,
                  images: linked,
                  observation: null,
                }
              }, request)
            }
            onPreviewRemoval={async (request) => {
              const linked = images.filter((row) =>
                request.kind === 'note'
                  ? row.control_item_id === request.id
                  : row.interior_room_id === request.id,
              )
              const roomNotes = notes.filter(
                (row) => row.interior_room_id === request.id,
              )
              return {
                ...request,
                token: 'synthetic-token',
                label:
                  request.kind === 'room'
                    ? roomRows.find((row) => row.id === request.id)!.room_label
                    : 'Syntetiskt innehåll',
                counts: {
                  notes: roomNotes.length,
                  images: linked.length,
                  quickNotes: 0,
                },
                blockedReason:
                  request.kind === 'room' && (linked.length || roomNotes.length)
                    ? 'Rummet innehåller noteringar eller bilder.'
                    : null,
              }
            }}
            onLoadImageTrash={async () => {
              qa.calls.push({ kind: 'trash-list', id: inspectionId })
              if (qa.failTrashLoad) throw Error('Synthetic trash read failure')
              return { items: trashed, nextCursor: null }
            }}
            onRestoreImage={(eventId, requestId) => mutate('restore-image', requestId, () => {
              if (qa.failRestore) throw Error('Synthetic restore failure')
              const source = trashed.find(item => item.eventId === eventId)
              if (!source) return { image: null }
              const restored = { ...source.image, id: crypto.randomUUID(), control_item_id: null, processing_status: 'unprocessed' as const }
              setImages(rows => [...rows, restored])
              setTrashed(rows => rows.filter(item => item.eventId !== eventId))
              return { image: restored }
            })}
            onRemove={(request, _token, requestId) =>
              mutate('remove', requestId, () => {
                if (request.kind === 'image') {
                  const image = images.find(row => row.id === request.id)!
                  setTrashed(rows => [...rows, { eventId: requestId, image,
                    deletedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(), daysRemaining: 30 }])
                }
                const detached =
                  request.kind === 'note'
                    ? images
                        .filter((row) => row.control_item_id === request.id)
                        .map((row) => ({ ...row, control_item_id: null }))
                    : []
                setNotes((rows) =>
                  rows.filter(
                    (row) => request.kind !== 'note' || row.id !== request.id,
                  ),
                )
                setRoomRows((rows) =>
                  rows.filter(
                    (row) => request.kind !== 'room' || row.id !== request.id,
                  ),
                )
                setImages((rows) =>
                  rows
                    .filter(
                      (row) =>
                        request.kind !== 'image' || row.id !== request.id,
                    )
                    .map(
                      (row) =>
                        detached.find((image) => image.id === row.id) || row,
                    ),
                )
                return {
                  roomId: request.kind === 'room' ? request.id : null,
                  noteIds: request.kind === 'note' ? [request.id] : [],
                  imageIds: request.kind === 'image' ? [request.id] : [],
                  quickNoteIds: [],
                  images: detached,
                  archiveId: 'synthetic-archive',
                }
              }, request)
            }
            onPreviewImageNote={async (imageId, target) => {
              const image = images.find(image => image.id === imageId)!
              const destination = imageNoteDestination(image, target)
              const key = destination?.area === 'interior' ? destination.roomId : destination?.exteriorItemId ?? 'unplaced'
              const fail = qa.failImagePreview
              qa.calls.push({ kind: 'image-preview', id: imageId, patch: { target: target ?? null, key } })
              while (qa.holdImagePreviews.includes(key)) await new Promise(resolve => setTimeout(resolve, 20))
              qa.calls.push({ kind: 'image-preview-settled', id: imageId, patch: { key } })
              if (fail) throw Error('Synthetic image preview failure')
              if (!destination) throw Error('Bilden saknar plats. Välj en plats för noteringen.')
              return {
                token: imageNoteToken(imageId, destination),
                room: destination.area === 'interior' ? roomRows.find(row => row.id === destination.roomId)! : null,
                observation: imageNoteObservation(image, destination, target),
                exteriorItem: destination.area === 'exterior' ? exteriorItems.find(row => row.id === destination.exteriorItemId)! : null,
              }
            }}
            onCreateImageNote={(request) => {
              qa.calls.push({ kind: 'image-note-request', id: request.requestId, patch: request })
              return mutate('image-note', request.requestId, () => {
                const image = images.find((row) => row.id === request.imageId)!
                const destination = imageNoteDestination(image, request.target)
                if (!destination || request.token !== imageNoteToken(image.id, destination)) throw Error('Synthetic stale image placement')
                const observation = imageNoteObservation(image, destination, request.target)
                const created = {
                  ...note,
                  id: crypto.randomUUID(),
                  interior_room_id: destination.area === 'interior' ? destination.roomId : null,
                  exterior_observation_id: observation?.id ?? null,
                  note: request.draft.note,
                  risk_text: request.draft.risk_text,
                  ftu_text: request.draft.ftu_text,
                  selected_outcome_id: request.draft.outcomeId,
                }
                const linked = { ...image, control_item_id: created.id, interior_room_id: created.interior_room_id, exterior_observation_id: created.exterior_observation_id, processing_status: 'linked' as const }
                setNotes((rows) => [...rows, created])
                setImages((rows) =>
                  rows.map((row) => (row.id === linked.id ? linked : row)),
                )
                return { note: created, image: linked, observation }
              })
            }}
          />
        </div>
      </fieldset>
      {menu && model && <ObRoundSheet title="Byggnadstyp" onClose={() => setMenu(false)}>
        <ObFloorEditor inspectionId={inspectionId} disabled={locked || paused} />
      </ObRoundSheet>}
      {menu && !model && (
        <aside role="dialog" aria-label="Stegmeny">
          <button onClick={() => setMenu(false)}>Tillbaka</button>
        </aside>
      )}
    </main>
  )
}
function imageNoteDestination(image: Image, target?: MoveTarget): MoveTarget | null {
  if (target) return target
  const hasCurrentPlace = Boolean(image.interior_room_id || image.exterior_observation_id)
  const roomId = image.interior_room_id || (!hasCurrentPlace ? image.origin_interior_room_id : null)
  if (roomId && rooms.some(room => room.id === roomId)) return { area: 'interior', roomId }
  const observationId = image.exterior_observation_id || (!hasCurrentPlace ? image.origin_exterior_observation_id : null)
  const exteriorItemId = observations.find(row => row.id === observationId)?.exterior_item_id || (!hasCurrentPlace ? image.origin_exterior_item_id : null)
  return exteriorItemId ? { area: 'exterior', exteriorItemId } : null
}
function imageNoteToken(imageId: string, target: MoveTarget) {
  return `synthetic-image-token:${imageId}:${JSON.stringify(target)}`
}
function imageNoteObservation(image: Image, destination: MoveTarget, target?: MoveTarget) {
  if (destination.area !== 'exterior') return null
  const originalId = target ? null : image.exterior_observation_id || image.origin_exterior_observation_id
  return observations.find(row => row.id === originalId) ?? observations.find(row => row.exterior_item_id === destination.exteriorItemId)!
}
function FloorFixture(props: FixtureProps) {
  const [model, update] = useState<ObFloorModel>({ revision: 1, levels: [
    { level: 0, name: 'Entr\u00e9plan' }, { level: 1, name: '' }, { level: -1, name: 'Suterr\u00e4ng' },
  ] })
  return <ObFloorContext.Provider value={{ model, update }}><Fixture {...props} /></ObFloorContext.Provider>
}
export default function MobileRoundFixture(props: FixtureProps) {
  return newFloors ? <FloorFixture {...props} /> : <Fixture {...props} />
}
