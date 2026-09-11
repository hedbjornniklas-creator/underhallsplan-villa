import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import ObMobileRound, {
  type ObMobileRoundProps,
} from '../../src/components/ob/ObMobileRound'
import { hasObTextDraftsForInspection } from '../../src/lib/ob/localTextDrafts'
import { queueImageBatch, unplacedImagePlacement } from '../../src/lib/ob/roundImageImport'
import { putRoundImageUploadItem, listRoundImageUploadItems } from '../../src/lib/ob/roundImageUploadQueue'
import { ObFloorContext, useObFloorModel } from '../../src/components/ob/ObFloorProvider'
import { ObFloorEditor } from '../../src/components/ob/ObFloorEditor'
import ObRoundSheet from '../../src/components/ob/ObRoundSheet'
import { floorModelKeys, modelFloorLabel, type ObFloorModel } from '../../src/lib/ob/floorModel'

type Note = ObMobileRoundProps['notes'][number]
type Room = ObMobileRoundProps['rooms'][number]
type Image = ObMobileRoundProps['images'][number]
const inspectionId = 'synthetic-mobile-inspection'
const newFloors = new URLSearchParams(location.search).has('levels')
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
const exteriorItems = [
  {
    id: 'exterior-1',
    key: 'fasad',
    label: 'Fasad',
    is_active: true,
    sort_order: 10,
  },
]
const qa = {
  failSaves: false,
  partialLink: false,
  holdLinks: false,
  holdUnlink: false,
  dropMutationResponse: false,
  delayMs: 0,
  calls: [] as Array<{ kind: string; id: string; patch?: unknown }>,
  notes: initialNotes,
  images: initialImages,
  rooms,
  completeUpload: () => {},
  hasDrafts: () => hasObTextDraftsForInspection(inspectionId),
  imageQueue: () => listRoundImageUploadItems(inspectionId),
}
Object.assign(window, { __obMobileTest: qa })

function Fixture() {
  const { model } = useObFloorModel()
  const [mutating, setMutating] = useState(false)
  const receipts = useRef(new Map<string, unknown>())
  const [roomRows, setRoomRows] = useState(rooms)
  const [notes, setNotes] = useState<Note[]>(
    () =>
      JSON.parse(localStorage.getItem('fixture-notes') || 'null') ||
      initialNotes,
  )
  const [images, setImages] = useState<Image[]>(() =>
    new URLSearchParams(location.search).has('queued')
      ? initialImages.map((image) => ({
          ...image,
          local_queue_id: 'queue-1',
          local_upload_status: 'uploading',
        }))
      : initialImages,
  )
  const [area, setArea] = useState<'interior' | 'exterior'>('interior')
  const [floor, setFloor] = useState(newFloors ? 'plan0' : 'plan1'),
    [roomId, setRoomId] = useState('room-1')
  const [menu, setMenu] = useState(false)
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
    localStorage.setItem('fixture-notes', JSON.stringify(notes))
  }, [notes])
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
  ): Promise<T> {
    qa.calls.push({ kind, id: requestId })
    setMutating(true)
    try {
      await new Promise((resolve) => setTimeout(resolve, qa.delayMs))
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
      <fieldset disabled={paused} style={{ padding: 0, margin: 0, border: 0 }}>
        <div className="ob-mobile-round-host [&_textarea]:text-sm [&_textarea]:leading-5">
          <ObMobileRound
            inspectionId={inspectionId}
            inspectionSide="buyer"
            address="Testgatan 1 (syntetiskt objekt)"
            onOpenMenu={() => setMenu(true)}
            pointApplies={() => true}
            pointMatchesRoom={() => true}
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
            activeExteriorItem={exteriorItems[0]}
            observations={['observation-1', 'observation-extra'].map((id) => ({
              id,
              inspection_id: inspectionId,
              exterior_item_id: 'exterior-1',
              part_label: null,
              values: {},
              note: null,
            }))}
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
            onExterior={() => setArea('exterior')}
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
            onAddOutcome={async (point, outcome) =>
              createNote({
                control_point_id: point.id,
                selected_outcome_id: outcome.id,
                title: point.title,
                note: outcome.note_template,
                risk_text: outcome.risk_template,
                ftu_text: outcome.ftu_template,
              })
            }
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
            }}
            onGallery={(id) => {
              qa.calls.push({ kind: 'gallery', id: id || 'place' })
            }}
            onImportImages={files => queueImageBatch(files, async (file, index) => {
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
              })
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
            onRemove={(request, _token, requestId) =>
              mutate('remove', requestId, () => {
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
              })
            }
            onPreviewImageNote={async (imageId) => {
              qa.calls.push({ kind: 'image-preview', id: imageId })
              return {
                token: 'synthetic-image-token',
                room: roomRows.find(
                  (row) =>
                    row.id ===
                    images.find((image) => image.id === imageId)
                      ?.interior_room_id,
                )!,
                observation: null,
                exteriorItem: null,
              }
            }}
            onCreateImageNote={(request) =>
              mutate('image-note', request.requestId, () => {
                const image = images.find((row) => row.id === request.imageId)!
                const created = {
                  ...note,
                  id: crypto.randomUUID(),
                  interior_room_id: image.interior_room_id,
                  exterior_observation_id: image.exterior_observation_id,
                  note: request.draft.note,
                  risk_text: request.draft.risk_text,
                  ftu_text: request.draft.ftu_text,
                  selected_outcome_id: request.draft.outcomeId,
                }
                const linked = { ...image, control_item_id: created.id }
                setNotes((rows) => [...rows, created])
                setImages((rows) =>
                  rows.map((row) => (row.id === linked.id ? linked : row)),
                )
                return { note: created, image: linked, observation: null }
              })
            }
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
function FloorFixture() {
  const [model, update] = useState<ObFloorModel>({ revision: 1, levels: [
    { level: 0, name: 'Entr\u00e9plan' }, { level: 1, name: '' }, { level: -1, name: 'Suterr\u00e4ng' },
  ] })
  return <ObFloorContext.Provider value={{ model, update }}><Fixture /></ObFloorContext.Provider>
}
createRoot(document.getElementById('root')!).render(newFloors ? <FloorFixture /> : <Fixture />)
