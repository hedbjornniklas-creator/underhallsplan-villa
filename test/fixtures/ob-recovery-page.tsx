'use client'

import { useEffect, useState } from 'react'
import ObMobileRound, { type ObMobileRoundProps } from '@/components/ob/ObMobileRound'
import { buildingDraftScope } from '@/lib/ob/buildingStructure'
import { getObTextDraftStorageKey, hasObTextDraftsForInspection } from '@/lib/ob/localTextDrafts'
import { deleteRoundImageUploadItem, listRoundImageUploadItems, putRoundImageUploadItem, type RoundImageUploadItem } from '@/lib/ob/roundImageUploadQueue'

// Browser-only recovery fixture: real editor/IndexedDB, no inspection API or Storage writes.
const inspectionId = '11111111-1111-4111-8111-111111111111'
const parts = ['22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333']
const names = ['TEST Huvudbyggnad', 'TEST Garage']
const fail = async (): Promise<never> => { throw Error('Not part of the recovery fixture') }
type Note = ObMobileRoundProps['notes'][number]
const initialNote = (part: number): Note => ({ id: 'same-note-id', inspection_id: inspectionId, interior_room_id: 'room',
  exterior_observation_id: null, control_point_id: null, title: 'Fri notering', note: `TEST original ${part + 1}`,
  risk_text: null, ftu_text: null, status: null, selected_outcome_id: null, sort_order: 0 })
const serverKey = (part: number) => `qa:ob-recovery:server:${part}`
async function readRecoveryState() {
  const rows = await listRoundImageUploadItems(inspectionId)
  const hashes: Record<string, string> = {}
  for (const row of rows) {
    const hash = await crypto.subtle.digest('SHA-256', await row.blob.arrayBuffer())
    hashes[row.id] = Array.from(new Uint8Array(hash)).map(n => n.toString(16).padStart(2, '0')).join('')
  }
  return { rows, hashes, pendingDrafts: hasObTextDraftsForInspection(inspectionId) }
}

export default function RecoveryPage() {
  const [ready, setReady] = useState(false), [part, setPart] = useState(0), [online, setOnline] = useState(false)
  const [notes, setNotes] = useState([initialNote(0), initialNote(1)])
  const [queue, setQueue] = useState<RoundImageUploadItem[]>([]), [hashes, setHashes] = useState<Record<string, string>>({})
  const [error, setError] = useState(''), [pendingDrafts, setPendingDrafts] = useState(false)
  const refresh = async () => {
    const state = await readRecoveryState()
    setQueue(state.rows); setHashes(state.hashes); setPendingDrafts(state.pendingDrafts)
  }
  useEffect(() => {
    void readRecoveryState().then(state => {
      setQueue(state.rows); setHashes(state.hashes); setPendingDrafts(state.pendingDrafts)
      const params = new URLSearchParams(location.search)
      setPart(params.get('part') === '1' ? 1 : 0); setOnline(params.has('online'))
      setNotes([0, 1].map(p => JSON.parse(localStorage.getItem(serverKey(p)) || 'null') || initialNote(p)))
      setReady(true)
    }).catch(e => setError(String(e)))
  }, [])
  const room: ObMobileRoundProps['rooms'][number] = { id: 'room', inspection_id: inspectionId, floor_label: 'plan0',
    room_type_key: 'hall', room_label: 'TEST Hall', order_index: 0, values: {}, note: null }
  const queueImage = async () => {
    const id = `qa-ob-recovery-${part}`
    if (queue.some(row => row.id === id)) return
    const blob = await (await fetch('/report-assets/mock-company-logo.png')).blob()
    const now = new Date().toISOString()
    await putRoundImageUploadItem({ id, serverImageId: parts[part], inspectionId, buildingPartId: parts[part], blob,
      originalName: 'synthetic-logo.png', contentType: blob.type, storagePath: `${inspectionId}/round/recovery/${part}.png`,
      capturedAt: now, createdAt: now, updatedAt: now, status: 'queued', attempts: 0, error: null, sortOrder: 0, sourceArea: 'interior',
      origin: { origin_interior_room_id: room.id ?? null, origin_exterior_observation_id: null, origin_exterior_item_id: null,
        origin_floor_label: 'plan0', origin_room_label: room.room_label, origin_room_type_key: 'hall', origin_exterior_item_key: null },
      link: { control_item_id: null, interior_room_id: room.id ?? null, exterior_observation_id: null, processing_status: 'unprocessed', ignored_at: null } })
    await refresh()
  }
  const clear = async () => {
    for (const item of await listRoundImageUploadItems(inspectionId)) await deleteRoundImageUploadItem(item.id)
    for (const [index, partId] of parts.entries()) {
      localStorage.removeItem(serverKey(index))
      localStorage.removeItem(getObTextDraftStorageKey(`ob:${buildingDraftScope(inspectionId, partId)}:mobile-round:same-note-id`)!)
    }
    setNotes([initialNote(0), initialNote(1)]); await refresh()
  }
  if (!ready) return <main>{error || 'Loading recovery fixture'}</main>
  const props: ObMobileRoundProps = {
    inspectionId, scopeId: buildingDraftScope(inspectionId, parts[part]), buildingName: names[part], address: 'TEST local recovery',
    locked: false, mutationBlocked: false, inspectionSide: 'buyer', area: 'interior', activeFloor: 'plan0',
    activeRoom: room, rooms: [room], roomTypes: [], floors: ['plan0'], floorLabel: () => 'Plan 0', floorKey: key => key,
    exteriorItems: [], observations: [], activeExteriorItem: null, notes: [notes[part]], images: [], quickNotes: [], imageSrc: () => '',
    pointApplies: () => false, pointMatchesRoom: () => false, onOpenMenu: () => {}, onArea: () => {}, onFloor: () => {}, onRoom: () => {}, onExterior: () => {},
    onUpdateNote: async (_id, patch) => {
      if (!online) throw Error('TEST offline')
      const next = { ...notes[part], ...patch }
      localStorage.setItem(serverKey(part), JSON.stringify(next))
      setNotes(rows => rows.map((row, index) => index === part ? next : row))
    },
    onNewNote: fail, onAddOutcome: fail, onAddRoom: fail, onCamera: () => {}, onGallery: () => {}, onImportImages: fail,
    onLinkImage: fail, onLinkImages: fail, onUnlinkImage: fail, onSuggestNote: fail, onRenameRoom: fail, onMove: fail,
    onPreviewRemoval: fail, onRemove: fail, onPreviewImageNote: fail, onCreateImageNote: fail,
    onLoadImageTrash: async () => ({ items: [], nextCursor: null }), onRestoreImage: fail,
  }
  return <main style={{ maxWidth: 390, margin: '0 auto', background: 'white' }}>
    <section aria-label="Recovery test controls" style={{ padding: 12, display: 'grid', gap: 8 }}>
      <label>Test building<select aria-label="Test building" value={part} onChange={e => setPart(Number(e.target.value))}>
        {names.map((name, index) => <option key={name} value={index}>{name}</option>)}
      </select></label>
      <label><input type="checkbox" checked={online} onChange={e => setOnline(e.target.checked)} /> Test saves enabled</label>
      <button onClick={() => void queueImage().catch(e => setError(String(e)))}>Queue test image</button>
      <button onClick={() => void refresh()}>Read recovery state</button>
      <button onClick={() => void clear()}>Clear this test only</button>
      <output data-recovery-queue-count={queue.filter(row => row.buildingPartId === parts[part]).length}>
        Images in building: {queue.filter(row => row.buildingPartId === parts[part]).length}
      </output>
      {queue.map(row => <output key={row.id} data-recovery-image={row.id} data-building={row.buildingPartId}
        data-hash={hashes[row.id]} data-bytes={row.blob.size}>{row.id}: {row.blob.size} bytes</output>)}
      <output data-pending-drafts={String(pendingDrafts)}>Pending draft: {String(pendingDrafts)}</output>
      <output data-test-server-note>{notes[part].note}</output>
      {error && <p role="alert">{error}</p>}
    </section>
    <ObMobileRound key={part} {...props} />
  </main>
}
