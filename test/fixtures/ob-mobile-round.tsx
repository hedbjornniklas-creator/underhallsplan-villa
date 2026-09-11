import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import ObMobileRound, {
  type ObMobileRoundProps,
} from '../../src/components/ob/ObMobileRound'
import { hasObTextDraftsForInspection } from '../../src/lib/ob/localTextDrafts'

type Note = ObMobileRoundProps['notes'][number]
type Room = ObMobileRoundProps['rooms'][number]
type Image = ObMobileRoundProps['images'][number]
const inspectionId = 'synthetic-mobile-inspection'
const rooms: Room[] = [
  {
    id: 'room-1',
    inspection_id: inspectionId,
    floor_label: 'plan1',
    room_type_key: 'hall',
    room_label: 'Hall',
    order_index: 10,
    values: {},
    note: null,
  },
  {
    id: 'room-2',
    inspection_id: inspectionId,
    floor_label: 'plan2',
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
  delayMs: 0,
  calls: [] as Array<{ kind: string; id: string; patch?: unknown }>,
  notes: initialNotes,
  images: initialImages,
  completeUpload: () => {},
  hasDrafts: () => hasObTextDraftsForInspection(inspectionId),
}
Object.assign(window, { __obMobileTest: qa })

function Fixture() {
  const [roomRows, setRoomRows] = useState(rooms)
  const [notes, setNotes] = useState<Note[]>(
    () =>
      JSON.parse(localStorage.getItem('fixture-notes') || 'null') ||
      initialNotes,
  )
  const [images, setImages] = useState<Image[]>(() => new URLSearchParams(location.search).has('queued')
    ? initialImages.map(image => ({ ...image, local_queue_id: 'queue-1', local_upload_status: 'uploading' }))
    : initialImages)
  const [area, setArea] = useState<'interior' | 'exterior'>('interior')
  const [floor, setFloor] = useState('plan1'),
    [roomId, setRoomId] = useState('room-1')
  const [menu, setMenu] = useState(false)
  const locked = new URLSearchParams(location.search).has('locked')
  const paused = new URLSearchParams(location.search).has('paused')
  useEffect(() => {
    qa.notes = notes
    qa.images = images
  }, [notes, images])
  useEffect(() => {
    qa.completeUpload = () => setImages(rows => rows.map(image => ({ ...image, local_queue_id: undefined, local_upload_status: undefined })))
    return () => { qa.completeUpload = () => {} }
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
            mutationBlocked={images.some(image => image.local_queue_id)}
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
            floors={['plan1', 'plan2']}
            floorLabel={(key) => (key === 'plan2' ? 'Plan 2' : 'Plan 1')}
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
          />
        </div>
      </fieldset>
      {menu && (
        <aside role="dialog" aria-label="Stegmeny">
          <button onClick={() => setMenu(false)}>Tillbaka</button>
        </aside>
      )}
    </main>
  )
}
createRoot(document.getElementById('root')!).render(<Fixture />)
