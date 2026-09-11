'use client'

import React, {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  ArrowLeft,
  ArrowRightLeft,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  Image as ImageIcon,
  Layers,
  Link as LinkIcon,
  MapPin,
  Menu,
  PenLine,
  Plus,
  Search,
  X,
  Inbox,
  Trash2,
  MessageSquarePlus,
} from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import {
  hasNote,
  matchesWords,
  normalize,
  noteMatchRank,
  unfinishedFields,
} from '@/lib/ob/roundSearch'
import { getObTextDraftStorageKey } from '@/lib/ob/localTextDrafts'
import { restoreRoundDraft } from '@/lib/ob/mobileRound'
import type {
  MoveRequest,
  MoveResult,
  RemovalRequest,
  RemovalPreview,
  RemovalResult,
  ImageNoteRequest,
  ImageNotePreview,
  ImageNoteResult,
  MoveTarget,
} from '@/lib/ob/roundMutations'
import Sheet from './ObRoundSheet'
import ObRoundImageBank from './ObRoundImageBank'
import ObRoundImageActions from './ObRoundImageActions'
import ObRoundNoteSuggestion from './ObRoundNoteSuggestion'
import ObRoundRenameRoom from './ObRoundRenameRoom'
import ObRoundPlaceImages from './ObRoundPlaceImages'
import { useObRoomSwipe } from './useObRoomSwipe'
import { useObRoundBack } from './useObRoundBack'
import { roundImageLocation } from '@/lib/ob/roundImageLocation'
import type { ObNoteSuggestion } from '@/lib/ob/noteSuggestion'
import {
  ImageLinkSheet,
  MoveSheet,
  RemovalSheet,
  type MoveSubject,
  type RemovalSubject,
} from './ObRoundMutationSheets'
import type {
  RoomType,
  InteriorRoom,
  SettingsExteriorItem,
  InspectionExteriorObservation,
  InspectionControlItem as Note,
  ControlPointLite as Point,
  ControlPointOutcome as Outcome,
  RoundImage,
  QuickNote,
} from './ObStepRunda'
import './mobile-round.css'

type Patch = Pick<Note, 'note' | 'risk_text' | 'ftu_text'>
export type ObMobileRoundProps = {
  address: string
  onOpenMenu: () => void
  pointApplies: (point: Point) => boolean
  pointMatchesRoom: (point: Point, roomType: string) => boolean
  mutationBlocked: boolean
  inspectionId: string
  inspectionSide: string
  locked: boolean
  area: 'interior' | 'exterior'
  activeFloor: string
  rooms: InteriorRoom[]
  roomTypes: RoomType[]
  floors: string[]
  floorLabel: (key: string) => string
  floorKey: (key: string) => string
  activeRoom: InteriorRoom | null
  exteriorItems: SettingsExteriorItem[]
  observations: InspectionExteriorObservation[]
  activeExteriorItem: SettingsExteriorItem | null
  notes: Note[]
  images: RoundImage[]
  quickNotes: QuickNote[]
  imageSrc: (image: RoundImage) => string
  onArea: (area: 'interior' | 'exterior') => void
  onFloor: (floor: string) => void
  onRoom: (room: InteriorRoom) => void
  onExterior: (item: SettingsExteriorItem) => void
  onAddRoom: (type: string, label: string) => Promise<InteriorRoom | null>
  onNewNote: () => Promise<Note | null>
  onAddOutcome: (point: Point, outcome: Outcome) => Promise<Note | null>
  onUpdateNote: (id: string, patch: Patch) => Promise<void>
  onCamera: (id: string | null) => void
  onGallery: (id: string | null) => void
  onImportImages: (files: File[]) => Promise<void>
  onLinkImage: (image: RoundImage, note: Note) => Promise<boolean>
  onLinkImages: (images: RoundImage[], note: Note) => Promise<boolean>
  onUnlinkImage: (image: RoundImage, note: Note) => Promise<void>
  onSuggestNote: (suggestion: ObNoteSuggestion) => Promise<void>
  onRenameRoom: (room: InteriorRoom, name: string) => Promise<InteriorRoom>
  onMove: (request: MoveRequest) => Promise<MoveResult>
  onPreviewRemoval: (request: RemovalRequest) => Promise<RemovalPreview>
  onRemove: (
    request: RemovalRequest,
    token: string,
    requestId: string,
  ) => Promise<RemovalResult>
  onPreviewImageNote: (imageId: string, target?: MoveTarget) => Promise<ImageNotePreview>
  onCreateImageNote: (request: ImageNoteRequest) => Promise<ImageNoteResult>
}

type Props = ObMobileRoundProps

function Editor({
  note,
  place,
  p,
  onClose,
  onMove,
  onDelete,
  onDeleteImage,
  imagePlace,
}: {
  note: Note
  place: string
  p: Props
  onClose: () => void
  onMove: () => void
  onDelete: () => void
  onDeleteImage: (image: RoundImage) => void
  imagePlace: (image: RoundImage) => string
}) {
  const key = getObTextDraftStorageKey(
    `ob:${p.inspectionId}:mobile-round:${note.id}`,
  )!
  const original = {
    note: note.note ?? '',
    risk_text: note.risk_text ?? '',
    ftu_text: note.ftu_text ?? '',
  }
  const [initial] = useState(() => {
    if (p.locked) return { draft: original, pending: false }
    try {
      const draft = restoreRoundDraft(localStorage.getItem(key), original)
      return { draft, pending: draft !== original }
    } catch {
      return { draft: original, pending: false }
    }
  })
  const [draft, setDraft] = useState<Patch>(initial.draft)
  const [status, setStatus] = useState(initial.pending ? 'Ej sparad' : 'Sparad')
  const [error, setError] = useState('')
  const [imageBankOpen, setImageBankOpen] = useState(false)
  const [imageActionsId, setImageActionsId] = useState<string | null>(null)
  const [imageNotice, setImageNotice] = useState('')
  const [suggestionOpen, setSuggestionOpen] = useState(false)
  const [sentSuggestion, setSentSuggestion] = useState<string | null>(null)
  const suggestionVersion = JSON.stringify(draft)
  const [leaving, setLeaving] = useState(false),
    leaveRef = useRef(false)
  const values = useRef(draft),
    version = useRef(initial.pending ? 1 : 0),
    saved = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    flight = useRef<Promise<boolean> | null>(null)
  const update = useRef(p.onUpdateNote)
  update.current = p.onUpdateNote
  const linked = p.images.filter((image) => image.control_item_id === note.id)
  const imageActions = linked.find(image => image.id === imageActionsId)
  const persist = useCallback((): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current)
    if (flight.current) return flight.current
    if (p.locked) return Promise.resolve(true)
    if (saved.current >= version.current) return Promise.resolve(true)
    // Serialize snapshots so a slow earlier save cannot overwrite newer typing.
    flight.current = (async () => {
      try {
        while (saved.current < version.current) {
          setStatus('Sparar…')
          setError('')
          const currentVersion = version.current,
            snapshot = { ...values.current }
          await update.current(note.id!, snapshot)
          saved.current = currentVersion
        }
        try {
          localStorage.removeItem(key)
        } catch {}
        setStatus('Sparad')
        return true
      } catch {
        setError('Kunde inte spara. Texten finns kvar här.')
        setStatus('Ej sparad')
        return false
      } finally {
        flight.current = null
      }
    })()
    return flight.current
  }, [key, note.id, p.locked])
  function change(field: keyof Patch, value: string) {
    values.current = { ...values.current, [field]: value }
    version.current++
    setDraft(values.current)
    setStatus('Ej sparad')
    try {
      localStorage.setItem(key, JSON.stringify(values.current))
    } catch {
      setError(
        'Lokalt utkast kunde inte sparas. Stäng inte sidan innan sparandet är klart.',
      )
    }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void persist(), 700)
  }
  useEffect(() => {
    if (version.current) void persist()
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (saved.current < version.current) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      if (timer.current) clearTimeout(timer.current)
      window.removeEventListener('beforeunload', beforeUnload)
    }
  }, [persist])
  async function finish(next = onClose) {
    if (leaveRef.current) return
    leaveRef.current = true
    setLeaving(true)
    try {
      if (await persist()) next()
    } finally {
      leaveRef.current = false
      setLeaving(false)
    }
  }
  if (imageBankOpen) return (
    <ObRoundImageBank note={note} place={place} imagePlace={imagePlace} p={p}
      onClose={() => setImageBankOpen(false)} />
  )
  if (imageActions) return (
    <ObRoundImageActions image={imageActions} note={note} place={place} p={p}
      onClose={() => setImageActionsId(null)}
      onUnlinked={() => {
        setImageActionsId(null)
        setImageNotice('Bilden kopplades loss och finns i Att bearbeta.')
      }}
      onDelete={() => onDeleteImage(imageActions)} />
  )
  if (suggestionOpen) {
    const room = p.rooms.find(row => row.id === note.interior_room_id)
    const observation = p.observations.find(row => row.id === note.exterior_observation_id)
    const category = room ? p.roomTypes.find(type => type.key === room.room_type_key)?.label
      : p.exteriorItems.find(item => item.id === observation?.exterior_item_id)?.label
    return <ObRoundNoteSuggestion initial={{ noteId: note.id!, note: draft.note || '', risk_text: draft.risk_text || '', ftu_text: draft.ftu_text || '', category: category || '' }}
      blocked={p.locked || p.mutationBlocked} onSend={p.onSuggestNote}
      onClose={() => setSuggestionOpen(false)}
      onSent={() => { setSentSuggestion(suggestionVersion); setSuggestionOpen(false) }} />
  }
  return (
    <Sheet
      title="Notering"
      closeDisabled={leaving}
      actions={
        <>
          <button
            className="obm-icon obm-move-icon"
            title="Flytta notering"
            aria-label="Flytta notering"
            disabled={p.locked || leaving}
            onClick={() => void finish(onMove)}
          >
            <ArrowRightLeft size={21} />
          </button>
          <button
            className="obm-icon obm-delete-icon"
            title="Radera notering"
            aria-label="Radera notering"
            disabled={p.locked || leaving}
            onClick={() => void finish(onDelete)}
          >
            <Trash2 size={20} />
          </button>
        </>
      }
      onClose={() => void finish()}
      footer={
        <>
          <span
            role="status"
            className={status === 'Sparad' ? 'obm-saved' : 'obm-muted'}
          >
            {status === 'Sparad' && <Check size={16} />} {status}
          </span>
          <button
            className="obm-primary"
            disabled={leaving}
            onClick={() => void finish()}
          >
            <Check size={18} />
            Klart
          </button>
        </>
      }
    >
      <div className="obm-place-label">
        <MapPin size={16} />
        {place}
      </div>
      <p className="obm-category-label">
        {note.control_point_id ? note.title : 'Fri notering'}
      </p>
      {error && (
        <p role="alert" className="obm-error">
          {error}
        </p>
      )}
      {unfinishedFields(draft).length > 0 && (
        <p className="obm-unfinished">
          Mallfält kvar: {unfinishedFields(draft).join(', ')}
        </p>
      )}
      <label className="obm-field">
        Notering
        <textarea
          autoFocus
          rows={6}
          value={draft.note ?? ''}
          readOnly={p.locked || leaving}
          onChange={(e) => change('note', e.target.value)}
          placeholder="Skriv vad du ser…"
        />
      </label>
      <details
        className="obm-details"
        open={Boolean(draft.risk_text || draft.ftu_text) || undefined}
      >
        <summary>
          Risk och fortsatt teknisk utredning
          <ChevronDown size={18} />
        </summary>
        <label className="obm-field">
          Risk
          <textarea
            rows={4}
            value={draft.risk_text ?? ''}
            readOnly={p.locked || leaving}
            onChange={(e) => change('risk_text', e.target.value)}
          />
        </label>
        <label className="obm-field">
          Fortsatt teknisk utredning
          <textarea
            rows={4}
            value={draft.ftu_text ?? ''}
            readOnly={p.locked || leaving}
            onChange={(e) => change('ftu_text', e.target.value)}
          />
        </label>
      </details>
      {!note.control_point_id && <div className="obm-suggestion-action">
        {sentSuggestion === suggestionVersion ? <p role="status" className="obm-saved"><Check size={16} />Förslaget har skickats till admin.</p> :
          <button type="button" disabled={p.locked || p.mutationBlocked || leaving || !draft.note?.trim()}
            onClick={() => void finish(() => setSuggestionOpen(true))}>
            <MessageSquarePlus size={18} />Föreslå till biblioteket
          </button>}
      </div>}
      <div className="obm-section-title">
        <h3>Bilder</h3>
        <span>{linked.length}</span>
      </div>
      <div className="obm-photo-actions">
        <button
          disabled={p.locked || leaving}
          onClick={() => p.onCamera(note.id!)}
        >
          <Camera size={20} />
          Ta bild
        </button>
        <button
          disabled={p.locked || leaving}
          onClick={() => p.onGallery(note.id!)}
        >
          <ImageIcon size={20} />
          Välj bilder
        </button>
        <button
          disabled={p.locked || leaving}
          onClick={() => void finish(() => setImageBankOpen(true))}
        >
          <Inbox size={20} />
          Bildbank
        </button>
      </div>
      <div className="obm-photos">
        {linked.map((image) => (
          <div key={image.id} data-image-id={image.id}>
            <a
              href={p.imageSrc(image)}
              target="_blank"
              rel="noreferrer"
              aria-label="Öppna kopplad bild"
            >
              <img
                src={p.imageSrc(image)}
                alt={image.label || 'Bild till noteringen'}
              />
            </a>
            <button
              className="obm-icon obm-delete-icon"
              title="Ta bort bild"
              aria-label="Ta bort bild"
              disabled={p.locked || leaving}
              onClick={() => void finish(() => {
                setImageNotice('')
                setImageActionsId(image.id)
              })}
            >
              <Trash2 size={18} />
            </button>
          </div>
        ))}
      </div>
      {imageNotice && <p role="status" className="obm-saved">{imageNotice}</p>}
    </Sheet>
  )
}

export default function ObMobileRound(p: Props) {
  const [view, setView] = useState<'places' | 'room' | 'notes' | 'pending'>(
    'places',
  )
  const [query, setQuery] = useState(''),
    [everywhere, setEverywhere] = useState(false)
  const [points, setPoints] = useState<Point[]>([]),
    [outcomes, setOutcomes] = useState<Outcome[]>([])
  const [catalogLoading, setCatalogLoading] = useState(true),
    [catalogError, setCatalogError] = useState('')
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const [editorId, setEditorId] = useState<string | null>(null),
    [preview, setPreview] = useState<Outcome | null>(null)
  const [photoId, setPhotoId] = useState<string | null>(null)
  const [enlargedPhotoId, setEnlargedPhotoId] = useState<string | null>(null)
  const [renameRoom, setRenameRoom] = useState<InteriorRoom | null>(null)
  const [moveSubject, setMoveSubject] = useState<MoveSubject | null>(null)
  const [removalSubject, setRemovalSubject] = useState<RemovalSubject | null>(
    null,
  )
  const photo = p.images.find((image) => image.id === photoId)
  const enlargedPhoto = p.images.find((image) => image.id === enlargedPhotoId)
  const enlargedPhotoNote = p.notes.find(note => note.id === enlargedPhoto?.control_item_id)
  const [addRoomOpen, setAddRoomOpen] = useState(false),
    [roomType, setRoomType] = useState(''),
    [roomLabel, setRoomLabel] = useState('')
  const busyRef = useRef(false)
  const importInput = useRef<HTMLInputElement>(null)
  const importingRef = useRef(false)
  const [importing, setImporting] = useState(false)
  const [restored, setRestored] = useState(false)
  const positionKey = `ob-mobile-round:v2:${p.inspectionId}:position`
  const roomsOnFloor = p.rooms
    .filter(room => p.floorKey(room.floor_label) === p.floorKey(p.activeFloor))
    .sort((a, b) => b.order_index - a.order_index)
  const activePlaceKey = p.area === 'interior'
    ? p.activeRoom?.id && `${p.inspectionId}:interior:${p.activeFloor}:${p.activeRoom.id}`
    : p.activeExteriorItem?.id && `${p.inspectionId}:exterior:${p.activeExteriorItem.id}`
  const placeSwipe = useObRoomSwipe(
    view === 'room' && !busy && !importing ? activePlaceKey ?? null : null,
    step => {
      if (p.area === 'interior') {
        const index = roomsOnFloor.findIndex(room => room.id === p.activeRoom?.id)
        const next = index < 0 ? undefined : roomsOnFloor[index + step]
        if (next?.id) goRoom(next)
      } else {
        // Follow the exterior list's order without wrapping or changing area.
        const index = p.exteriorItems.findIndex(item => item.id === p.activeExteriorItem?.id)
        const next = index < 0 ? undefined : p.exteriorItems[index + step]
        if (next?.id) goExterior(next)
      }
    },
  )
  const observationIds = new Set(
    p.observations
      .filter((row) => row.exterior_item_id === p.activeExteriorItem?.id)
      .map((row) => row.id),
  )
  const atTarget = (note: Note) =>
    p.area === 'interior'
      ? Boolean(p.activeRoom?.id && note.interior_room_id === p.activeRoom.id)
      : Boolean(
          note.exterior_observation_id &&
            observationIds.has(note.exterior_observation_id),
        )
  const targetNotes = p.notes.filter(atTarget),
    written = p.notes.filter(hasNote)
  const imageLocations = new Map(p.images.map(image => [image.id, roundImageLocation(image, p.notes, p.observations)]))
  const targetImages = p.images.filter(image => {
    const place = imageLocations.get(image.id)!
    return p.area === 'interior' ? Boolean(p.activeRoom?.id && place.roomId === p.activeRoom.id)
      : Boolean(p.activeExteriorItem?.id && place.exteriorItemId === p.activeExteriorItem.id)
  })
  const targetLabel =
    p.area === 'interior'
      ? (p.activeRoom?.room_label ?? 'Välj rum')
      : (p.activeExteriorItem?.label ?? 'Välj byggnadsdel')
  const parentLabel =
    p.area === 'interior'
      ? p.floorLabel(p.activeRoom?.floor_label ?? p.activeFloor)
      : 'Utsida'
  const unmatched = p.images.filter(
    (image) => !image.control_item_id && image.processing_status !== 'ignored',
  )
  const pendingPhotoIndex = view === 'pending'
    ? unmatched.findIndex(image => image.id === enlargedPhoto?.id) : -1
  const previousPendingPhoto = pendingPhotoIndex > 0 ? unmatched[pendingPhotoIndex - 1] : null
  const nextPendingPhoto = pendingPhotoIndex >= 0 ? unmatched[pendingPhotoIndex + 1] : null
  const drafts = p.notes.filter(
    (note) =>
      (!note.control_point_id && !hasNote(note)) ||
      unfinishedFields(note).length > 0,
  )
  const pendingCount =
    unmatched.length +
    drafts.length +
    p.quickNotes.filter((note) => note.note.trim()).length
  const editor = p.notes.find((note) => note.id === editorId)
  useObRoundBack({
    inspectionId: p.inspectionId,
    ready: restored,
    canGoBack: view !== 'places' || Boolean(editor || preview || photo || enlargedPhoto || renameRoom || moveSubject || removalSubject || addRoomOpen),
    root: placeSwipe.ref,
    onBack: () => {
      setView('places')
      setQuery('')
      setEverywhere(false)
    },
  })
  const applicablePoints = useMemo(
    () => points.filter(p.pointApplies),
    [points, p.pointApplies],
  )
  const pointMap = useMemo(
    () => new Map(applicablePoints.map((point) => [point.id, point])),
    [applicablePoints],
  )
  const catalogSequence = useRef(0)
  const loadCatalog = useCallback(async () => {
    const sequence = ++catalogSequence.current
    setCatalogLoading(true)
    setCatalogError('')
    try {
      async function readAll<T>(table: string): Promise<T[]> {
        const rows: T[] = []
        for (let from = 0; sequence === catalogSequence.current; from += 500) {
          const result = await supabase
            .from(table)
            .select('*')
            .eq('is_active', true)
            .order('id')
            .range(from, from + 499)
          if (result.error) throw result.error
          const batch = (result.data ?? []) as T[]
          rows.push(...batch)
          if (batch.length < 500) break
        }
        return rows
      }
      const [a, b] = await Promise.all([
        readAll<Point>('settings_control_points'),
        readAll<Outcome>('settings_control_point_outcomes'),
      ])
      if (sequence !== catalogSequence.current) return
      setPoints(a)
      setOutcomes(b)
    } catch {
      if (sequence === catalogSequence.current)
        setCatalogError('Noteringsbiblioteket kunde inte läsas.')
    } finally {
      if (sequence === catalogSequence.current) setCatalogLoading(false)
    }
  }, [])
  const cancelCatalog = useCallback(() => {
    catalogSequence.current++
  }, [])
  useEffect(() => {
    void loadCatalog()
    return cancelCatalog
  }, [p.inspectionId, loadCatalog, cancelCatalog])
  const restorePosition = useEffectEvent(() => {
    try {
      const position = JSON.parse(sessionStorage.getItem(positionKey) || 'null')
      if (position) {
        const room = p.rooms.find((room) => room.id === position.roomId),
          item = p.exteriorItems.find((item) => item.id === position.exteriorId)
        if (position.area === 'exterior' && item) p.onExterior(item)
        else if (room) p.onRoom(room)
        if (
          (position.view === 'places' || position.area === 'exterior') &&
          p.floors.includes(position.floor)
        )
          p.onFloor(position.floor)
        if (['places', 'room', 'notes', 'pending'].includes(position.view)) {
          const missingPlace = position.area === 'exterior' ? !item : !room
          setView(
            position.view === 'room' && missingPlace ? 'places' : position.view,
          )
        }
      }
    } catch {}
    setRestored(true)
  })
  useEffect(() => {
    restorePosition()
  }, [positionKey])
  useEffect(() => {
    if (!restored) return
    try {
      sessionStorage.setItem(
        positionKey,
        JSON.stringify({
          view,
          area: p.area,
          roomId: p.activeRoom?.id,
          exteriorId: p.activeExteriorItem?.id,
          floor: p.activeFloor,
        }),
      )
    } catch {}
  }, [
    restored,
    positionKey,
    view,
    p.area,
    p.activeRoom?.id,
    p.activeExteriorItem?.id,
    p.activeFloor,
  ])
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 3500)
    return () => clearTimeout(timer)
  }, [notice])
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [view, p.activeRoom?.id, p.activeExteriorItem?.id])
  const relevant = useCallback(
    (point: Point) => {
      if (targetNotes.some((note) => note.control_point_id === point.id))
        return true
      if (p.area === 'exterior')
        return (
          normalize(point.exterior_item_key) ===
            normalize(p.activeExteriorItem?.key) &&
          Boolean(point.exterior_item_key)
        )
      return p.pointMatchesRoom(point, p.activeRoom?.room_type_key ?? '')
    },
    [targetNotes, p],
  )
  const candidates = useMemo(
    () =>
      outcomes
        .filter((outcome) => {
          const point = pointMap.get(outcome.control_point_id)
          return (
            point &&
            (everywhere || relevant(point)) &&
            matchesWords(
              [
                outcome.label,
                outcome.note_template,
                outcome.risk_template,
                outcome.ftu_template,
                point.title,
                point.label,
                point.key,
                JSON.stringify(point.tags),
              ].join(' '),
              query,
            )
          )
        })
        .sort(
          (a, b) =>
            noteMatchRank(b, query) - noteMatchRank(a, query) ||
            Number(relevant(pointMap.get(b.control_point_id)!)) -
              Number(relevant(pointMap.get(a.control_point_id)!)) ||
            a.sort_order - b.sort_order,
        ),
    [outcomes, pointMap, query, everywhere, relevant],
  )
  const groups = useMemo(
    () =>
      applicablePoints
        .filter((point) =>
          candidates.some((outcome) => outcome.control_point_id === point.id),
        )
        .sort(
          (a, b) =>
            Number(relevant(b)) - Number(relevant(a)) ||
            (a.title || a.label || a.key).localeCompare(
              b.title || b.label || b.key,
              'sv',
            ),
        ),
    [applicablePoints, candidates, relevant],
  )
  function placeOf(note: Note) {
    const room = p.rooms.find((room) => room.id === note.interior_room_id)
    if (room) return `${p.floorLabel(room.floor_label)} · ${room.room_label}`
    const observation = p.observations.find(
      (row) => row.id === note.exterior_observation_id,
    )
    return `Utsida · ${p.exteriorItems.find((item) => item.id === observation?.exterior_item_id)?.label ?? 'Plats saknas'}`
  }
  function imagePlace(image: RoundImage) {
    const location = imageLocations.get(image.id)!
    const room = p.rooms.find(room => room.id === location.roomId)
    if (room) return `${p.floorLabel(room.floor_label)} · ${room.room_label}`
    const item = p.exteriorItems.find(row => row.id === location.exteriorItemId)
    return item
      ? `Utsida · ${item.label}`
      : image.origin_room_label || 'Plats saknas'
  }
  function goRoom(room: InteriorRoom) {
    p.onRoom(room)
    setQuery('')
    setEverywhere(false)
    setView('room')
  }
  function goExterior(item: SettingsExteriorItem) {
    p.onExterior(item)
    setQuery('')
    setEverywhere(false)
    setView('room')
  }
  async function action(callback: () => Promise<void>) {
    if (p.locked || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      await callback()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Åtgärden kunde inte sparas.')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }
  function newNote() {
    void action(async () => {
      const note = await p.onNewNote()
      if (!note?.id) throw Error('Noteringen kunde inte skapas.')
      setEditorId(note.id)
    })
  }
  function addOutcome(outcome: Outcome) {
    void action(async () => {
      const existing = targetNotes.find(
        (note) => note.selected_outcome_id === outcome.id,
      )
      if (existing?.id) {
        setEditorId(existing.id)
        setPreview(null)
        return
      }
      const point = pointMap.get(outcome.control_point_id)!
      const note = await p.onAddOutcome(point, outcome)
      if (!note?.id) throw Error('Noteringen kunde inte sparas.')
      setNotice('Noteringen tillagd')
      setPreview(null)
    })
  }
  function openNote(note: Note) {
    const room = p.rooms.find((room) => room.id === note.interior_room_id)
    if (room) p.onRoom(room)
    else {
      const obs = p.observations.find(
        (row) => row.id === note.exterior_observation_id,
      )
      const item = p.exteriorItems.find(
        (row) => row.id === obs?.exterior_item_id,
      )
      if (item) p.onExterior(item)
    }
    setEditorId(note.id!)
  }
  function noteRow(note: Note) {
    const images = p.images.filter((image) => image.control_item_id === note.id)
    return (
      <button
        key={note.id}
        data-note-id={note.id}
        className="obm-note-row"
        onClick={() => openNote(note)}
      >
        <span>
          <small>{view === 'room' ? note.title : placeOf(note)}</small>
          <strong>
            {note.note?.trim() ||
              (note.status === 'ok'
                ? 'Inget att notera'
                : note.risk_text?.trim() ||
                  note.ftu_text?.trim() ||
                  'Tom notering')}
          </strong>
          <span className="obm-meta">
            {unfinishedFields(note).length > 0 && <em>Mallfält kvar</em>}
            {note.risk_text?.trim() && <em>Risk</em>}
            {note.ftu_text?.trim() && <em>Utredning</em>}
            {images.length > 0 && (
              <span>
                <ImageIcon size={14} />
                {images.length}
              </span>
            )}
          </span>
        </span>
        {images[0] ? (
          <img src={p.imageSrc(images[0])} alt="" />
        ) : (
          <ChevronRight size={19} />
        )}
      </button>
    )
  }
  function resultRow(outcome: Outcome) {
    const added = targetNotes.some(
      (note) => note.selected_outcome_id === outcome.id,
    )
    return (
      <div className="obm-result" key={outcome.id} data-outcome-id={outcome.id}>
        <button
          className="obm-result-text"
          onClick={() => {
            setError('')
            setPreview(outcome)
          }}
        >
          {query && (
            <small className="obm-result-context">
              {pointMap.get(outcome.control_point_id)?.title} ·{' '}
              {pointMap.get(outcome.control_point_id)?.scope === 'exterior'
                ? 'Utsida'
                : 'Insida'}
            </small>
          )}
          <strong>{outcome.label}</strong>
          <span>{outcome.note_template || 'Ingen förvald noteringstext'}</span>
          {(outcome.risk_template || outcome.ftu_template) && (
            <small>
              {[
                outcome.risk_template && 'Risktext',
                outcome.ftu_template && 'Utredningstext',
              ]
                .filter(Boolean)
                .join(' · ')}
            </small>
          )}
        </button>
        <button
          className={'obm-icon ' + (added ? 'obm-added' : 'obm-add')}
          disabled={busy || p.locked}
          onClick={() => addOutcome(outcome)}
          title={added ? 'Öppna tillagd notering' : 'Lägg till notering'}
          aria-label={`${added ? 'Öppna' : 'Lägg till'}: ${outcome.label}`}
        >
          {added ? <Check size={20} /> : <Plus size={21} />}
        </button>
      </div>
    )
  }
  return (
    <div className="obm-root" data-view={view} data-area={p.area} {...placeSwipe}>
      {view !== 'room' && (
        <header className="obm-inspection-header">
          <div>
            <strong>Överlåtelsebesiktning</strong>
            <span>{p.address}</span>
          </div>
          <button
            className="obm-icon"
            title="Öppna stegmeny"
            aria-label="Öppna stegmeny"
            onClick={p.onOpenMenu}
          >
            <Menu size={22} />
          </button>
        </header>
      )}
      {view === 'room' ? (
        <header
          className={
            'obm-room-header' +
            (p.area === 'interior' && p.activeRoom?.id
              ? ' obm-room-header-actions'
              : '')
          }
        >
          <button
            className="obm-icon"
            title="Till platser"
            aria-label="Till platser"
            onClick={() => setView('places')}
          >
            <ArrowLeft size={23} />
          </button>
          <div>
            <span>{parentLabel}</span>
            <h1>{p.area === 'interior' && p.activeRoom?.id ?
              <button type="button" className="obm-room-name" title="Byt rumsnamn" aria-label="Byt rumsnamn"
                disabled={p.locked || busy || p.mutationBlocked} onClick={() => setRenameRoom(p.activeRoom!)}>
                <span>{targetLabel}</span><PenLine size={17} />
              </button> : targetLabel}</h1>
          </div>
          {p.area === 'interior' && p.activeRoom?.id && (
            <>
              <button
                className="obm-icon obm-move-icon"
                title="Flytta rum"
                aria-label="Flytta rum"
                disabled={p.locked || busy}
                onClick={() =>
                  setMoveSubject({ kind: 'room', room: p.activeRoom! })
                }
              >
                <ArrowRightLeft size={21} />
              </button>
              <button
                className="obm-icon obm-delete-icon"
                title="Radera rum"
                aria-label="Radera rum"
                disabled={p.locked || busy}
                onClick={() =>
                  setRemovalSubject({
                    request: { kind: 'room', id: p.activeRoom!.id! },
                    place: `${parentLabel} · ${targetLabel}`,
                  })
                }
              >
                <Trash2 size={20} />
              </button>
            </>
          )}
        </header>
      ) : (
        <header className="obm-page-header">
          <span>ÖB-RUNDA</span>
          {view === 'places' ? (
            <div className="obm-place-header-row">
              <h1>Välj plats</h1>
              <div className="obm-segment" role="group" aria-label="Område">
                <button
                  aria-pressed={p.area === 'interior'}
                  onClick={() => p.onArea('interior')}
                >
                  Insida
                </button>
                <button
                  aria-pressed={p.area === 'exterior'}
                  onClick={() => p.onArea('exterior')}
                >
                  Utsida
                </button>
              </div>
            </div>
          ) : (
            <h1>{view === 'notes' ? 'Noteringar' : 'Att bearbeta'}</h1>
          )}
          <p>
            {view === 'places'
              ? `${p.rooms.length} rum · ${p.exteriorItems.length} byggnadsdelar ute`
              : view === 'notes'
                ? `${written.length} noteringar`
                : `${unmatched.length} bilder utan notering · ${drafts.length} att komplettera`}
          </p>
          {view === 'pending' && (
            <div className="obm-import-images">
              <button
                type="button"
                className="obm-primary"
                disabled={p.locked || importing}
                onClick={() => importInput.current?.click()}
              >
                <ImageIcon size={20} />
                {importing ? 'Lägger till bilder...' : 'Lägg till bilder'}
              </button>
              <input
                ref={importInput}
                type="file"
                accept="image/*"
                multiple
                hidden
                aria-label="Välj bilder att bearbeta"
                onChange={async event => {
                  const files = Array.from(event.currentTarget.files ?? [])
                  event.currentTarget.value = ''
                  if (!files.length || p.locked || importingRef.current) return
                  importingRef.current = true
                  setImporting(true)
                  setError('')
                  try {
                    await p.onImportImages(files)
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Bilderna kunde inte läggas till.')
                  } finally {
                    importingRef.current = false
                    setImporting(false)
                  }
                }}
              />
            </div>
          )}
        </header>
      )}
      {error && (
        <p role="alert" className="obm-error">
          {error}
        </p>
      )}
      {notice && (
        <div className="obm-toast" role="status">
          <Check size={18} />
          {notice}
        </div>
      )}
      {p.locked && <p className="obm-error">Besiktningen är låst.</p>}
      {view === 'places' && (
        <>
          {p.area === 'interior' && (
            <div className="obm-place-controls">
              <div className="obm-floor-controls">
                <label className="obm-field">
                  <select
                    aria-label="Plan"
                    value={p.activeFloor}
                    onChange={(e) => p.onFloor(e.target.value)}
                  >
                    {p.floors.map((floor) => (
                      <option key={floor} value={floor}>
                        {p.floorLabel(floor)}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="obm-icon obm-add"
                  title="Lägg till rum"
                  aria-label="Lägg till rum"
                  disabled={p.locked}
                  onClick={() => {
                    setError('')
                    setAddRoomOpen(true)
                  }}
                >
                  <Plus size={21} />
                </button>
              </div>
            </div>
          )}
          {p.area === 'exterior' && (
            <div className="obm-section-title">
              <h2>Byggnadsdelar</h2>
            </div>
          )}
          <div className="obm-places">
            {p.area === 'interior'
              ? roomsOnFloor.map((room) => {
                    const count = written.filter(
                      (note) => note.interior_room_id === room.id,
                    ).length
                    const imageCount = p.images.filter(
                      image => imageLocations.get(image.id)?.roomId === room.id,
                    ).length
                    return (
                      <button
                        className="obm-place-row"
                        key={room.id}
                        onClick={() => goRoom(room)}
                      >
                        <MapPin size={20} />
                        <span>
                          <strong>{room.room_label}</strong>
                          <small>
                            {count} {count === 1 ? 'notering' : 'noteringar'} ·{' '}
                            {imageCount} {imageCount === 1 ? 'bild' : 'bilder'}
                          </small>
                        </span>
                        <ChevronRight size={20} />
                      </button>
                    )
                  })
              : p.exteriorItems.map((item) => {
                  const ids = p.observations
                    .filter((obs) => obs.exterior_item_id === item.id)
                    .map((obs) => obs.id)
                  return (
                    <button
                      className="obm-place-row"
                      key={item.id}
                      onClick={() => goExterior(item)}
                    >
                      <Layers size={20} />
                      <span>
                        <strong>{item.label}</strong>
                        <small>
                          {
                            written.filter((note) =>
                              ids.includes(
                                note.exterior_observation_id ?? undefined,
                              ),
                            ).length
                          }{' '}
                          noteringar
                        </small>
                      </span>
                      <ChevronRight size={20} />
                    </button>
                  )
                })}
          </div>
        </>
      )}
      {view === 'room' && (
        <>
          <div className="obm-room-actions">
            <button
              className="obm-primary"
              disabled={p.locked || busy}
              onClick={newNote}
            >
              <PenLine size={18} />
              Fri notering
            </button>
            <button disabled={p.locked} onClick={() => p.onCamera(null)}>
              <Camera size={20} />
              Ta bild
            </button>
          </div>
          <div className="obm-search-zone">
            <label className="obm-search">
              <Search size={20} />
              <input
                aria-label="Sök notering"
                placeholder="Sök det du ser…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  if (e.target.value) setEverywhere(true)
                }}
              />
              {query && (
                <button
                  className="obm-icon"
                  aria-label="Rensa sökning"
                  title="Rensa sökning"
                  onClick={() => {
                    setQuery('')
                    setEverywhere(false)
                  }}
                >
                  <X size={18} />
                </button>
              )}
            </label>
            <div className="obm-search-scope">
              <button
                aria-pressed={!everywhere}
                onClick={() => setEverywhere(false)}
              >
                Denna plats
              </button>
              <button
                aria-pressed={everywhere}
                onClick={() => setEverywhere(true)}
              >
                Hela biblioteket
              </button>
            </div>
          </div>
          {!query && targetNotes.filter(hasNote).length > 0 && (
            <section>
              <div className="obm-section-title">
                <h2>Noterat här</h2>
                <span>{targetNotes.filter(hasNote).length}</span>
              </div>
              {targetNotes.filter(hasNote).map(noteRow)}
            </section>
          )}
          {!query && <ObRoundPlaceImages key={`${p.area}:${p.activeRoom?.id}:${p.activeExteriorItem?.id}`}
            images={targetImages} title={p.area === 'interior' ? 'Bilder i rummet' : 'Bilder på platsen'}
            imageSrc={p.imageSrc} onOpen={image => setEnlargedPhotoId(image.id)} />}
          <section className="obm-catalog">
            <div className="obm-section-title">
              <h2>{query ? 'Sökresultat' : 'Noteringsförslag'}</h2>
              <span>{candidates.length}</span>
            </div>
            {catalogLoading ? (
              <p className="obm-empty">Läser bibliotek…</p>
            ) : catalogError ? (
              <div className="obm-empty" role="alert">
                {catalogError}
                <button onClick={() => void loadCatalog()}>Försök igen</button>
              </div>
            ) : candidates.length === 0 ? (
              <div className="obm-empty">
                <p>
                  {query
                    ? 'Ingen matchande notering.'
                    : 'Inga förval för denna plats.'}
                </p>
                <button
                  className="obm-primary"
                  disabled={p.locked || busy}
                  onClick={newNote}
                >
                  <PenLine size={18} />
                  Skriv fri notering
                </button>
              </div>
            ) : query ? (
              candidates.map(resultRow)
            ) : (
              groups.map((point) => (
                <details className="obm-category" key={point.id}>
                  <summary>
                    <span>
                      {point.title}
                      <small>
                        {
                          candidates.filter(
                            (row) => row.control_point_id === point.id,
                          ).length
                        }{' '}
                        förslag
                      </small>
                    </span>
                    <ChevronDown size={19} />
                  </summary>
                  {candidates
                    .filter((row) => row.control_point_id === point.id)
                    .map(resultRow)}
                </details>
              ))
            )}
          </section>
        </>
      )}
      {view === 'notes' && (
        <>
          <label className="obm-search obm-search-alone">
            <Search size={20} />
            <input
              aria-label="Sök bland noteringar"
              placeholder="Sök bland dina noteringar…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          {written
            .filter((note) =>
              matchesWords(
                `${placeOf(note)} ${note.title} ${note.note} ${note.risk_text} ${note.ftu_text}`,
                query,
              ),
            )
            .map(noteRow)}
          {!written.length && (
            <p className="obm-empty">Inga noteringar ännu.</p>
          )}
        </>
      )}
      {view === 'pending' && (
        <>
          {drafts.length > 0 && (
            <section>
              <div className="obm-section-title">
                <h2>Noteringar att komplettera</h2>
                <span>{drafts.length}</span>
              </div>
              {drafts.map(noteRow)}
            </section>
          )}
          {p.quickNotes.some((note) => note.note.trim()) && (
            <section>
              <div className="obm-section-title">
                <h2>Interna anteckningar</h2>
              </div>
              {p.quickNotes
                .filter((note) => note.note.trim())
                .map((note) => (
                  <div key={note.id} className="obm-quick-note">
                    <p>{note.note}</p>
                    <button
                      onClick={() => {
                        const room = p.rooms.find(
                          (room) => room.id === note.interior_room_id,
                        )
                        const observation = p.observations.find(
                          (obs) => obs.id === note.exterior_observation_id,
                        )
                        const item = p.exteriorItems.find(
                          (item) =>
                            item.id ===
                            (note.exterior_item_id ||
                              observation?.exterior_item_id),
                        )
                        if (room) goRoom(room)
                        else if (item) goExterior(item)
                        else setView('places')
                      }}
                    >
                      Öppna plats
                      <ChevronRight size={18} />
                    </button>
                  </div>
                ))}
            </section>
          )}
          <div className="obm-section-title">
            <h2>Bilder utan notering</h2>
            <span>{unmatched.length}</span>
          </div>
          <div className="obm-image-list">
            {unmatched.map((image) => (
              <div
                key={image.id}
                className="obm-image-row"
              >
                <button
                  type="button"
                  className="obm-image-thumb"
                  aria-label={`Förstora bild: ${imagePlace(image)}`}
                  title="Förstora bild"
                  onClick={() => setEnlargedPhotoId(image.id)}
                >
                  <img src={p.imageSrc(image)} alt={image.label || 'Besiktningsbild'} />
                </button>
                <button
                  type="button"
                  className="obm-image-link"
                  aria-label={`Koppla bild: ${imagePlace(image)}`}
                  onClick={() => setPhotoId(image.id)}
                >
                  <span>
                    <strong>{imagePlace(image)}</strong>
                    <small>
                      {image.local_upload_status
                        ? 'Lokal bild · ' + image.local_upload_status
                        : 'Ej kopplad'}
                    </small>
                  </span>
                  <ChevronRight size={19} />
                </button>
              </div>
            ))}
          </div>
          {pendingCount === 0 && (
            <p className="obm-empty">Inga lösa bilder eller utkast.</p>
          )}
        </>
      )}
      <nav className="obm-bottom-nav" aria-label="Mobilrunda">
        <button
          aria-current={
            view === 'places' || view === 'room' ? 'page' : undefined
          }
          onClick={() => {
            setView('places')
            setQuery('')
          }}
        >
          <MapPin size={22} />
          Platser
        </button>
        <button
          aria-current={view === 'notes' ? 'page' : undefined}
          onClick={() => {
            setView('notes')
            setQuery('')
          }}
        >
          <FileText size={22} />
          Noteringar
        </button>
        <button
          aria-current={view === 'pending' ? 'page' : undefined}
          onClick={() => {
            setView('pending')
            setQuery('')
          }}
        >
          <span>
            <Inbox size={22} />
            {pendingCount > 0 && <b>{pendingCount}</b>}
          </span>
          Att bearbeta
        </button>
      </nav>
      {editor && (
        <Editor
          key={editor.id}
          note={editor}
          place={placeOf(editor)}
          p={p}
          onClose={() => setEditorId(null)}
          imagePlace={imagePlace}
          onMove={() => {
            setEditorId(null)
            setMoveSubject({ kind: 'note', note: editor })
          }}
          onDelete={() => {
            setEditorId(null)
            setRemovalSubject({
              request: { kind: 'note', id: editor.id! },
              place: placeOf(editor),
              returnEditorId: editor.id!,
            })
          }}
          onDeleteImage={(image) => {
            setEditorId(null)
            setRemovalSubject({
              request: { kind: 'image', id: image.id },
              place: placeOf(editor),
              image,
              returnEditorId: editor.id!,
            })
          }}
        />
      )}
      {renameRoom && <ObRoundRenameRoom room={renameRoom} blocked={p.locked || p.mutationBlocked}
        onRename={p.onRenameRoom} onClose={() => setRenameRoom(null)}
        onRenamed={room => { p.onRoom(room); setRenameRoom(null); setNotice('Rumsnamnet sparat') }} />}
      {moveSubject && (
        <MoveSheet
          subject={moveSubject}
          p={p}
          place={
            moveSubject.kind === 'room'
              ? `${p.floorLabel(moveSubject.room.floor_label)} · ${moveSubject.room.room_label}`
              : placeOf(moveSubject.note)
          }
          onClose={() => {
            if (moveSubject.kind === 'note') setEditorId(moveSubject.note.id!)
            setMoveSubject(null)
          }}
          onMoved={(result) => {
            setMoveSubject(null)
            setQuery('')
            setEverywhere(false)
            setView('room')
            if (result.room) goRoom(result.room)
            if (result.note) {
              const room = p.rooms.find(
                (row) => row.id === result.note!.interior_room_id,
              )
              const item = p.exteriorItems.find(
                (row) => row.id === result.observation?.exterior_item_id,
              )
              if (room) goRoom(room)
              else if (item) goExterior(item)
              else setView('places')
              setEditorId(result.note.id!)
            }
            if (!result.room && !result.note) setView('places')
            setNotice(result.room ? 'Rummet flyttat' : 'Noteringen flyttad')
          }}
        />
      )}
      {removalSubject && (
        <RemovalSheet
          subject={removalSubject}
          p={p}
          onClose={() => {
            setEditorId(removalSubject.returnEditorId ?? null)
            setPhotoId(removalSubject.returnPhoto?.id ?? null)
            setRemovalSubject(null)
          }}
          onRemoved={(result) => {
            for (const id of result.noteIds) {
              try {
                const key = getObTextDraftStorageKey(
                  `ob:${p.inspectionId}:mobile-round:${id}`,
                )
                if (key) localStorage.removeItem(key)
              } catch {}
            }
            if (
              removalSubject.returnEditorId &&
              !result.noteIds.includes(removalSubject.returnEditorId)
            )
              setEditorId(removalSubject.returnEditorId)
            if (result.roomId) setView('places')
            setNotice(
              result.roomId
                ? 'Rummet raderat'
                : result.imageIds.length
                  ? 'Bilden raderad'
                  : result.images.length
                    ? 'Noteringen raderad. Bilderna finns under Att bearbeta.'
                    : 'Noteringen raderad',
            )
            setRemovalSubject(null)
          }}
        />
      )}
      {preview && (
        <Sheet
          title="Noteringsförslag"
          closeDisabled={busy}
          onClose={() => {
            if (!busyRef.current) setPreview(null)
          }}
          footer={
            <button
              className="obm-primary"
              disabled={busy || p.locked}
              onClick={() => addOutcome(preview)}
            >
              <Plus size={18} />
              {targetNotes.some(
                (note) => note.selected_outcome_id === preview.id,
              )
                ? 'Öppna tillagd notering'
                : 'Lägg till här'}
            </button>
          }
        >
          <div className="obm-place-label">
            <MapPin size={16} />
            {parentLabel} · {targetLabel}
          </div>
          {error && (
            <p role="alert" className="obm-error">
              {error}
            </p>
          )}
          <h3>{preview.label}</h3>
          <p className="obm-full-text">
            {preview.note_template || 'Ingen förvald noteringstext'}
          </p>
          {preview.risk_template && (
            <>
              <h3>Risk</h3>
              <p className="obm-full-text">{preview.risk_template}</p>
            </>
          )}
          {preview.ftu_template && (
            <>
              <h3>Fortsatt teknisk utredning</h3>
              <p className="obm-full-text">{preview.ftu_template}</p>
            </>
          )}
        </Sheet>
      )}
      {enlargedPhoto && (
        <Sheet
          title="Bild"
          onClose={() => setEnlargedPhotoId(null)}
          footer={
            <button
              type="button"
              className="obm-primary"
              disabled={enlargedPhoto.control_item_id ? !enlargedPhotoNote
                : p.locked || p.mutationBlocked || Boolean(enlargedPhoto.local_queue_id) || enlargedPhoto.processing_status === 'ignored'}
              onClick={() => {
                if (enlargedPhoto.control_item_id) {
                  if (!enlargedPhotoNote) return
                  openNote(enlargedPhotoNote)
                } else setPhotoId(enlargedPhoto.id)
                setEnlargedPhotoId(null)
              }}
            >
              {enlargedPhoto.control_item_id ? <FileText size={18} /> : <LinkIcon size={18} />}
              {enlargedPhoto.control_item_id ? 'Öppna notering' : 'Koppla till notering'}
            </button>
          }
        >
          {pendingPhotoIndex >= 0 ? (
            <nav className="obm-image-navigation" aria-label="Bläddra bland bilder">
              <button type="button" className="obm-icon" aria-label="Föregående bild" title="Föregående bild"
                disabled={!previousPendingPhoto}
                onClick={() => { if (previousPendingPhoto) setEnlargedPhotoId(previousPendingPhoto.id) }}>
                <ChevronLeft size={24} />
              </button>
              <div role="status" aria-live="polite" aria-atomic="true">
                <p className="obm-place-label"><MapPin size={16} />{imagePlace(enlargedPhoto)}</p>
                <span>{pendingPhotoIndex + 1} av {unmatched.length}</span>
              </div>
              <button type="button" className="obm-icon" aria-label="Nästa bild" title="Nästa bild"
                disabled={!nextPendingPhoto}
                onClick={() => { if (nextPendingPhoto) setEnlargedPhotoId(nextPendingPhoto.id) }}>
                <ChevronRight size={24} />
              </button>
            </nav>
          ) : <p className="obm-place-label"><MapPin size={16} />{imagePlace(enlargedPhoto)}</p>}
          <div className="obm-image-viewer">
            <img key={enlargedPhoto.id} src={p.imageSrc(enlargedPhoto)} alt={enlargedPhoto.label || 'Besiktningsbild'} />
          </div>
        </Sheet>
      )}
      {photo && (
        <ImageLinkSheet
          key={photo.id}
          photo={photo}
          p={p}
          catalog={{
            points: applicablePoints,
            outcomes,
            loading: catalogLoading,
            error: catalogError,
            reload: () => void loadCatalog(),
          }}
          placeOf={placeOf}
          imagePlace={imagePlace(photo)}
          onClose={() => setPhotoId(null)}
          onDelete={() => {
            setPhotoId(null)
            setRemovalSubject({
              request: { kind: 'image', id: photo.id },
              place: imagePlace(photo),
              image: photo,
              returnPhoto: photo,
            })
          }}
          onLinked={() => {
            setPhotoId(null)
            setNotice('Bilden kopplad')
          }}
          onGoToPlace={() => {
            const location = imageLocations.get(photo.id)!
            const room = p.rooms.find(room => room.id === location.roomId)
            const item = p.exteriorItems.find(item => item.id === location.exteriorItemId)
            setPhotoId(null)
            if (room) goRoom(room)
            else if (item) goExterior(item)
            else setView('places')
          }}
        />
      )}
      {addRoomOpen && (
        <Sheet
          title="Lägg till rum"
          closeDisabled={busy}
          onClose={() => {
            if (!busyRef.current) setAddRoomOpen(false)
          }}
          footer={
            <button
              className="obm-primary"
              disabled={!roomType || busy || p.locked}
              onClick={() =>
                void action(async () => {
                  const room = await p.onAddRoom(roomType, roomLabel)
                  if (!room?.id) throw Error('Rummet kunde inte sparas.')
                  setAddRoomOpen(false)
                  setRoomLabel('')
                  goRoom(room)
                })
              }
            >
              <Plus size={18} />
              Lägg till rum
            </button>
          }
        >
          <p className="obm-place-label">{p.floorLabel(p.activeFloor)}</p>
          {error && (
            <p role="alert" className="obm-error">
              {error}
            </p>
          )}
          <label className="obm-field">
            Rumstyp
            <select
              value={roomType}
              onChange={(e) => setRoomType(e.target.value)}
            >
              <option value="">Välj rumstyp</option>
              {p.roomTypes.map((type) => (
                <option key={type.id} value={type.key}>
                  {type.label}
                </option>
              ))}
            </select>
          </label>
          <label className="obm-field">
            Rumsnamn
            <input
              value={roomLabel}
              onChange={(e) => setRoomLabel(e.target.value)}
              placeholder="Exempelvis Förråd vid garage"
            />
          </label>
        </Sheet>
      )}
    </div>
  )
}
