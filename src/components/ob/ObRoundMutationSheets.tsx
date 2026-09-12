'use client'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRightLeft,
  ChevronRight,
  Link as LinkIcon,
  MapPin,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { hasNote, matchesWords } from '@/lib/ob/roundSearch'
import type {
  MoveRequest,
  MoveResult,
  RemovalRequest,
  RemovalPreview,
  RemovalResult,
  ImageNoteDraft,
  ImageNotePreview,
  MoveTarget,
} from '@/lib/ob/roundMutations'
import { roundImageLocation } from '@/lib/ob/roundImageLocation'
import type { ObMobileRoundProps as Props } from './ObMobileRound'
import type {
  InteriorRoom,
  InspectionControlItem as Note,
  RoundImage,
} from './ObStepRunda'
import Sheet from './ObRoundSheet'
import ImageNoteForm, { type ImageNoteCatalog } from './ObImageNoteForm'
import { useObBuilding } from './ObBuildingContext'
import { supabase } from '@/lib/supabaseClient'
import { modelFloorLabel, floorModelKeys } from '@/lib/ob/floorModel'

export function ImageLinkSheet({
  photo,
  p,
  catalog,
  placeOf,
  imagePlace,
  onClose,
  onGoToPlace,
  onLinked,
  onDelete,
}: {
  photo: RoundImage
  p: Props
  catalog: ImageNoteCatalog
  placeOf: (note: Note) => string
  imagePlace: string
  onClose: () => void
  onGoToPlace: () => void
  onLinked: () => void
  onDelete: () => void
}) {
  const [query, setQuery] = useState(''),
    [selectedId, setSelectedId] = useState('')
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    flight = useRef(false)
  const [tab, setTab] = useState<'existing' | 'new'>('existing')
  const [draft, setDraft] = useState<ImageNoteDraft>({
    note: '',
    risk_text: '',
    ftu_text: '',
    outcomeId: null,
  })
  const imageLocation = roundImageLocation(photo, p.notes, p.observations)
  const imageRoom = p.rooms.find(room => room.id === imageLocation.roomId)
  const imageItem = p.exteriorItems.find(item => item.id === imageLocation.exteriorItemId)
  const [place, setPlace] = useState<{ area: '' | 'interior' | 'exterior'; floor: string; id: string }>(() => ({
    area: imageRoom ? 'interior' : imageItem ? 'exterior' : '',
    floor: imageRoom ? p.floorKey(imageRoom.floor_label) : '',
    id: imageRoom?.id || imageItem?.id || '',
  }))
  const [placeEdited, setPlaceEdited] = useState(false)
  const placeRooms = p.rooms.filter(room => p.floorKey(room.floor_label) === place.floor)
    .sort((a, b) => b.order_index - a.order_index)
  const targetRoom = place.area === 'interior' ? placeRooms.find(room => room.id === place.id) : null
  const targetItem = place.area === 'exterior' ? p.exteriorItems.find(item => item.id === place.id) : null
  const target = useMemo<MoveTarget | undefined>(() => targetRoom?.id
    ? { area: 'interior', roomId: targetRoom.id }
    : targetItem?.id ? { area: 'exterior', exteriorItemId: targetItem.id } : undefined,
  [targetRoom?.id, targetItem?.id])
  // Keep implicit current/origin placement for existing images. User selections are explicit.
  const requestTarget = placeEdited ? target : undefined
  const previewKey = target ? (placeEdited ? JSON.stringify(target) : 'image-place') : null
  const [checkedPlacement, setCheckedPlacement] = useState<{ key: string; value: ImageNotePreview } | null>(null)
  const placement = previewKey && checkedPlacement?.key === previewKey ? checkedPlacement.value : null
  const [checking, setChecking] = useState(false),
    [placeError, setPlaceError] = useState(''),
    [attempt, setAttempt] = useState(0)
  const retry = useRef<{ fingerprint: string; requestId: string } | null>(null)
  const previewImage = useRef(p.onPreviewImageNote)
  const floorKey = p.floorKey
  useEffect(() => {
    previewImage.current = p.onPreviewImageNote
  }, [p.onPreviewImageNote])
  useEffect(() => {
    if (tab !== 'new' || !previewKey || p.locked || p.mutationBlocked || placement) return
    let active = true
    setChecking(true)
    setPlaceError('')
    previewImage
      .current(photo.id, requestTarget)
      .then((value) => {
        if (active) {
          if (requestTarget && (requestTarget.area === 'interior'
            ? value.room?.id !== requestTarget.roomId || value.exteriorItem !== null
            : value.exteriorItem?.id !== requestTarget.exteriorItemId || value.room !== null)) {
            throw Error('Den valda platsen kunde inte bekräftas. Välj plats igen.')
          }
          if (!requestTarget) {
            if (value.room) setPlace({ area: 'interior', floor: floorKey(value.room.floor_label), id: value.room.id! })
            else if (value.exteriorItem) setPlace({ area: 'exterior', floor: '', id: value.exteriorItem.id })
          }
          setChecking(false)
          setCheckedPlacement({ key: previewKey, value })
        }
      })
      .catch((e) => {
        if (active)
          setPlaceError(
            e instanceof Error
              ? e.message
              : 'Bildens plats kunde inte kontrolleras.',
          )
      })
      .finally(() => {
        if (active) setChecking(false)
      })
    return () => {
      active = false
    }
  }, [tab, p.locked, p.mutationBlocked, floorKey, photo.id, placement, previewKey, requestTarget, attempt])
  const targetLabel = targetRoom
    ? `${p.floorLabel(targetRoom.floor_label)} · ${targetRoom.room_label}`
    : targetItem ? `Utsida · ${targetItem.label}` : ''
  function changePlace(next: typeof place) {
    if (flight.current) return
    setPlace(next)
    setPlaceEdited(true)
    setCheckedPlacement(null)
    setChecking(false)
    setPlaceError('')
    setError('')
  }
  function changeTab(next: 'existing' | 'new') {
    if (flight.current) return
    setTab(next)
    setError('')
  }
  async function create() {
    if (!placement || checking || flight.current || p.locked || p.mutationBlocked) return
    flight.current = true
    setBusy(true)
    setError('')
    const fingerprint = JSON.stringify({ token: placement.token, target: requestTarget, draft })
    if (retry.current?.fingerprint !== fingerprint)
      retry.current = { fingerprint, requestId: crypto.randomUUID() }
    try {
      await p.onCreateImageNote({
        imageId: photo.id,
        token: placement.token,
        requestId: retry.current.requestId,
        draft,
        ...(requestTarget ? { target: requestTarget } : {}),
      })
      onLinked()
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Noteringen och bildkopplingen kunde inte sparas.',
      )
    } finally {
      flight.current = false
      setBusy(false)
    }
  }
  const notes = p.notes.filter(hasNote)
  const selected = notes.find((note) => note.id === selectedId)
  const noteText = (note: Note) =>
    note.note?.trim() ||
    (note.status === 'ok'
      ? 'Inget att notera'
      : note.risk_text?.trim() || note.ftu_text?.trim() || note.title)
  const currentPlace = photo.interior_room_id || photo.exterior_observation_id
  const roomId =
    photo.interior_room_id ||
    (!currentPlace ? photo.origin_interior_room_id : null)
  const observationId =
    photo.exterior_observation_id ||
    (!currentPlace ? photo.origin_exterior_observation_id : null)
  const exteriorItemId =
    p.observations.find((row) => row.id === observationId)?.exterior_item_id ||
    (!currentPlace ? photo.origin_exterior_item_id : null)
  const samePlace = (note: Note) =>
    roomId
      ? note.interior_room_id === roomId
      : Boolean(
          exteriorItemId &&
            p.observations.some(
              (row) =>
                row.id === note.exterior_observation_id &&
                row.exterior_item_id === exteriorItemId,
            ),
        )
  const matching = notes.filter((note) =>
    matchesWords(
      `${placeOf(note)} ${note.title} ${noteText(note)} ${note.risk_text ?? ''} ${note.ftu_text ?? ''}`,
      query,
    ),
  )
  const groups = [
    { label: 'Bildens plats', notes: matching.filter(samePlace) },
    {
      label: 'Övriga platser',
      notes: matching.filter((note) => !samePlace(note)),
    },
  ]
  function search(value: string) {
    setQuery(value)
    setSelectedId('')
    setError('')
  }
  async function link() {
    if (!selected || p.locked || p.mutationBlocked || flight.current) return
    flight.current = true
    setBusy(true)
    setError('')
    try {
      if (!(await p.onLinkImage(photo, selected)))
        throw Error('Bilden kunde inte kopplas. Försök igen.')
      onLinked()
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Bilden kunde inte kopplas. Försök igen.',
      )
    } finally {
      flight.current = false
      setBusy(false)
    }
  }
  const canCreate =
    Boolean(placement) &&
    [draft.note, draft.risk_text, draft.ftu_text].some((value) => value.trim())
  return (
    <Sheet
      title="Koppla bild"
      closeDisabled={busy}
      actions={
        <button
          className="obm-icon obm-delete-icon"
          title="Radera bild"
          aria-label="Radera bild"
          disabled={busy || p.locked}
          onClick={onDelete}
        >
          <Trash2 size={20} />
        </button>
      }
      onClose={() => {
        if (!flight.current) onClose()
      }}
      footer={
        <button
          className="obm-primary"
          disabled={
            busy ||
            p.locked ||
            p.mutationBlocked ||
            (tab === 'existing' ? !selected : !canCreate || checking)
          }
          onClick={() => void (tab === 'existing' ? link() : create())}
        >
          <LinkIcon size={18} />
          {busy
            ? tab === 'new'
              ? 'Sparar…'
              : 'Kopplar…'
            : tab === 'new'
              ? 'Skapa och koppla'
              : 'Koppla till notering'}
        </button>
      }
    >
      <div className="obm-link-image-context">
        <a
          href={p.imageSrc(photo)}
          target="_blank"
          rel="noreferrer"
          aria-label="Öppna bilden i full storlek"
        >
          <img src={p.imageSrc(photo)} alt={photo.label || 'Bild att koppla'} />
        </a>
        <div>
          <p className="obm-place-label">
            <MapPin size={15} />
            {imagePlace}
          </p>
          {(imageRoom || imageItem) && <button
            className="obm-text-action"
            disabled={busy}
            onClick={onGoToPlace}
          >
            Gå till bildens plats
            <ChevronRight size={17} />
          </button>}
        </div>
      </div>
      <div
        className="obm-link-tabs"
        role="tablist"
        aria-label="Koppla till notering"
      >
        {(['existing', 'new'] as const).map((value) => (
          <button
            key={value}
            id={`image-note-tab-${value}`}
            role="tab"
            aria-selected={tab === value}
            aria-controls={`image-note-panel-${value}`}
            tabIndex={tab === value ? 0 : -1}
            disabled={busy}
            onClick={() => changeTab(value)}
            onKeyDown={(e) => {
              if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
                e.preventDefault()
                const next =
                  e.key === 'Home'
                    ? 'existing'
                    : e.key === 'End'
                      ? 'new'
                      : value === 'existing'
                        ? 'new'
                        : 'existing'
                changeTab(next)
                document.getElementById(`image-note-tab-${next}`)?.focus()
              }
            }}
          >
            {value === 'existing' ? 'Befintlig notering' : 'Ny notering'}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="obm-error">
          {error}
        </p>
      )}
      {p.locked && (
        <p role="alert" className="obm-error">
          Besiktningen är låst.
        </p>
      )}
      {p.mutationBlocked && (
        <p role="status" className="obm-unfinished">
          Vänta tills sparande och bilduppladdningar är klara.
        </p>
      )}
      <div
        id="image-note-panel-existing"
        role="tabpanel"
        aria-labelledby="image-note-tab-existing"
        hidden={tab !== 'existing'}
      >
        <div className="obm-link-search">
          <label className="obm-search">
            <Search size={20} />
            <input
              type="search"
              aria-label="Sök notering att koppla"
              placeholder="Sök rum eller notering…"
              disabled={busy}
              value={query}
              onChange={(e) => search(e.target.value)}
            />
            {query && (
              <button
                className="obm-icon"
                title="Rensa sökning"
                aria-label="Rensa sökning"
                disabled={busy}
                onClick={() => search('')}
              >
                <X size={18} />
              </button>
            )}
          </label>
        </div>
        <fieldset className="obm-link-options" disabled={busy || p.locked}>
          <legend>
            Välj notering <span aria-live="polite">({matching.length})</span>
          </legend>
          {groups
            .filter((group) => group.notes.length)
            .map((group) => (
              <div key={group.label} className="obm-link-group">
                <h3>{group.label}</h3>
                {group.notes.map((note) => (
                  <label
                    key={note.id}
                    className="obm-link-option"
                    data-selected={selectedId === note.id}
                  >
                    <input
                      type="radio"
                      name="link-note"
                      value={note.id}
                      checked={selectedId === note.id}
                      onChange={() => {
                        setSelectedId(note.id!)
                        setError('')
                      }}
                    />
                    <span>
                      <small>{placeOf(note)}</small>
                      <strong>{noteText(note)}</strong>
                      {note.control_point_id && (
                        <span className="obm-link-category">{note.title}</span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            ))}
        </fieldset>
        {!matching.length && (
          <p className="obm-empty" role="status">
            {notes.length
              ? 'Inga noteringar matchar sökningen.'
              : 'Inga noteringar att koppla bilden till.'}
          </p>
        )}
      </div>
      <div
        id="image-note-panel-new"
        role="tabpanel"
        aria-labelledby="image-note-tab-new"
        hidden={tab !== 'new'}
      >
        <section className="obm-image-note-place" aria-label="Plats för noteringen">
          <h3>Plats för noteringen</h3>
          <p className="obm-category-label">Välj var noteringen hör hemma. Bilden kopplas dit först när du väljer ”Skapa och koppla”.</p>
          <label className="obm-field">
            Område
            <select aria-label="Område" value={place.area} disabled={busy || p.locked}
              onChange={event => changePlace({ area: event.target.value as typeof place.area, floor: '', id: '' })}>
              <option value="">Välj insida eller utsida</option>
              <option value="interior">Insida</option>
              <option value="exterior">Utsida</option>
            </select>
          </label>
          {place.area === 'interior' && <>
            <label className="obm-field">
              Plan
              <select aria-label="Plan" value={place.floor} disabled={busy || p.locked}
                onChange={event => changePlace({ ...place, floor: event.target.value, id: '' })}>
                <option value="">Välj plan</option>
                {p.floors.map(key => <option key={key} value={key}>{p.floorLabel(key)}</option>)}
              </select>
            </label>
            <label className="obm-field">
              Rum
              <select aria-label="Rum" value={place.id} disabled={busy || p.locked || !place.floor}
                onChange={event => changePlace({ ...place, id: event.target.value })}>
                <option value="">Välj rum</option>
                {placeRooms.map(room => <option key={room.id} value={room.id}>{room.room_label}</option>)}
              </select>
            </label>
            {place.floor && !placeRooms.length && <p className="obm-category-label">Inga rum finns på detta plan. Lägg först till rummet under Platser.</p>}
          </>}
          {place.area === 'exterior' && <label className="obm-field">
            Byggnadsdel
            <select aria-label="Byggnadsdel" value={place.id} disabled={busy || p.locked}
              onChange={event => changePlace({ ...place, id: event.target.value })}>
              <option value="">Välj byggnadsdel</option>
              {p.exteriorItems.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>}
          {!target && <p role="status" className="obm-category-label">Välj en plats innan du skapar noteringen.</p>}
          {targetLabel && <p className="obm-place-label"><MapPin size={15} />{targetLabel}</p>}
        </section>
        {checking && <p role="status">Kontrollerar bildens plats…</p>}
        {placeError && (
          <>
            <p role="alert" className="obm-error">
              {placeError}
            </p>
            <button
              className="obm-text-action"
              disabled={busy || checking}
              onClick={() => setAttempt((value) => value + 1)}
            >
              Kontrollera platsen igen
            </button>
          </>
        )}
        <ImageNoteForm
          draft={draft}
          onChange={(value) => {
            setDraft(value)
            setError('')
          }}
          catalog={catalog}
          disabled={busy || p.locked}
        />
      </div>
    </Sheet>
  )
}

export type MoveSubject =
  | { kind: 'room'; room: InteriorRoom }
  | { kind: 'note'; note: Note }

export function MoveSheet({
  subject,
  p,
  place,
  onClose,
  onMoved,
}: {
  subject: MoveSubject
  p: Props
  place: string
  onClose: () => void
  onMoved: (result: MoveResult) => void
}) {
  const retry = useRef<{ fingerprint: string; requestId: string } | null>(null)
  const roomMove = subject.kind === 'room',
    title = roomMove ? 'Flytta rum' : 'Flytta notering'
  const building = useObBuilding()
  const [targetPartId, setTargetPartId] = useState(building?.part?.id ?? '')
  const targetPart = building?.overview.parts.find(part => part.id === targetPartId)
  const otherBuilding = Boolean(building?.part && targetPartId !== building.part.id)
  const [targetRooms, setTargetRooms] = useState<InteriorRoom[]>([])
  const [loadingTarget, setLoadingTarget] = useState(false)
  const [area, setArea] = useState<'interior' | 'exterior'>('interior')
  const [floor, setFloor] = useState(
    p.floorKey(roomMove ? subject.room.floor_label : p.activeFloor),
  )
  const [destination, setDestination] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const flight = useRef(false)
  useEffect(() => {
    if (!otherBuilding || !building) { setLoadingTarget(false); return }
    let active = true
    setLoadingTarget(true); setTargetRooms([]); setDestination(''); setError('')
    void (async () => {
      try {
        const { data, error } = await supabase.from('inspection_interior_rooms').select('*')
          .eq('inspection_id', building.inspectionId).eq('building_part_id', targetPartId).order('order_index')
        if (error) throw error
        if (active) { setTargetRooms((data ?? []) as InteriorRoom[]); setLoadingTarget(false) }
      } catch { if (active) setError('Kunde inte hämta målbyggnadens rum. Välj byggnaden igen.') }
    })()
    return () => { active = false }
  }, [otherBuilding, targetPartId, building?.inspectionId])
  const targetFloors = otherBuilding ? targetPart?.floor_model ? ['ovrigt', ...floorModelKeys(targetPart.floor_model)]
    : [...new Set(['ovrigt', ...targetRooms.map(room => room.floor_label)])] : p.floors
  const targetFloorLabel = (key: string) => otherBuilding && targetPart?.floor_model ? modelFloorLabel(targetPart.floor_model, key) : p.floorLabel(key)
  const rooms = (otherBuilding ? targetRooms : p.rooms).filter(
    (room) =>
      p.floorKey(room.floor_label) === floor &&
      (roomMove || room.id !== subject.note.interior_room_id),
  )
  const currentExterior = roomMove
    ? null
    : p.observations.find(
        (row) => row.id === subject.note.exterior_observation_id,
      )?.exterior_item_id
  const items = p.exteriorItems.filter((item) => otherBuilding || item.id !== currentExterior)
  const valid = !loadingTarget && (roomMove
    ? targetFloors.includes(floor) && (otherBuilding || floor !== p.floorKey(subject.room.floor_label))
    : area === 'interior'
      ? rooms.some((room) => room.id === destination)
      : items.some((item) => item.id === destination))
  const targetLabel = roomMove
    ? targetFloorLabel(floor)
    : area === 'interior'
      ? `${targetFloorLabel(floor)} · ${rooms.find((room) => room.id === destination)?.room_label ?? ''}`
      : `Utsida · ${items.find((item) => item.id === destination)?.label ?? ''}`
  async function move() {
    if (!valid || flight.current || p.locked || p.mutationBlocked) return
    flight.current = true
    setBusy(true)
    setError('')
    try {
      const selection =
        subject.kind === 'room'
          ? {
              kind: 'room',
              id: subject.room.id!,
              from: { floor: subject.room.floor_label },
              floor,
            }
          : {
              kind: 'note',
              id: subject.note.id!,
              from: {
                roomId: subject.note.interior_room_id,
                observationId: subject.note.exterior_observation_id,
              },
              target:
                area === 'interior'
                  ? { area, roomId: destination }
                  : { area, exteriorItemId: destination },
            }
      const fingerprint = JSON.stringify([targetPartId, selection])
      if (retry.current?.fingerprint !== fingerprint)
        retry.current = { fingerprint, requestId: crypto.randomUUID() }
      onMoved(
        await p.onMove({
          ...selection,
          ...(targetPartId ? { targetBuildingPartId: targetPartId } : {}),
          requestId: retry.current.requestId,
        } as MoveRequest),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Flytten kunde inte sparas.')
    } finally {
      flight.current = false
      setBusy(false)
    }
  }
  return (
    <Sheet
      title={title}
      closeDisabled={busy}
      onClose={() => {
        if (!flight.current) onClose()
      }}
      footer={
        <>
          <button disabled={busy} onClick={onClose}>
            Avbryt
          </button>
          <button
            className="obm-primary"
            disabled={!valid || busy || p.locked || p.mutationBlocked}
            onClick={() => void move()}
          >
            <ArrowRightLeft size={18} />
            {busy ? 'Flyttar…' : title}
          </button>
        </>
      }
    >
      <p className="obm-place-label">
        <MapPin size={16} />
        {place}
      </p>
      {roomMove ? (
        <h3>{subject.room.room_label}</h3>
      ) : (
        <p className="obm-full-text">
          {p.notes.find((note) => note.id === subject.note.id)?.note ||
            subject.note.title}
        </p>
      )}
      {error && (
        <p role="alert" className="obm-error">
          {error}
        </p>
      )}
      {p.mutationBlocked && (
        <p role="status" className="obm-unfinished">
          Vänta tills sparande och bilduppladdningar är klara innan du flyttar.
        </p>
      )}
      {p.locked && (
        <p role="alert" className="obm-error">
          Besiktningen är låst.
        </p>
      )}
      {building?.part && <label className="obm-field">Till byggnad
        <select aria-label="Till byggnad" disabled={busy} value={targetPartId} onChange={e => {
          setTargetPartId(e.target.value); setFloor(''); setDestination(''); setError('')
        }}>
          {building.overview.parts.map(part => <option key={part.id} value={part.id}>{part.name}</option>)}
        </select>
      </label>}
      {!roomMove && (
        <label className="obm-field">
          Område
          <select
            aria-label="Område"
            disabled={busy}
            value={area}
            onChange={(e) => {
              setArea(e.target.value as typeof area)
              setDestination('')
            }}
          >
            <option value="interior">Insida</option>
            <option value="exterior">Utsida</option>
          </select>
        </label>
      )}
      {(roomMove || area === 'interior') && (
        <label className="obm-field">
          {roomMove ? 'Till plan' : 'Plan'}
          <select
            aria-label={roomMove ? 'Till plan' : 'Plan'}
            disabled={busy}
            value={floor}
            onChange={(e) => {
              setFloor(e.target.value)
              setDestination('')
            }}
          >
            <option value="">Välj plan</option>
            {targetFloors.map((key) => (
              <option key={key} value={key}>
                {targetFloorLabel(key)}
              </option>
            ))}
          </select>
        </label>
      )}
      {!roomMove && (
        <label className="obm-field">
          {area === 'interior' ? 'Till rum' : 'Till byggnadsdel'}
          <select
            aria-label={area === 'interior' ? 'Till rum' : 'Till byggnadsdel'}
            disabled={busy}
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
          >
            <option value="">
              Välj {area === 'interior' ? 'rum' : 'byggnadsdel'}
            </option>
            {area === 'interior'
              ? rooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.room_label}
                  </option>
                ))
              : items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
          </select>
        </label>
      )}
      {valid && (
        <div className="obm-move-summary">
          <span>
            Från<strong>{place}</strong>
          </span>
          <ArrowRightLeft size={20} />
          <span>
            Till<strong>{targetLabel}</strong>
          </span>
        </div>
      )}
      <p className="obm-category-label">
        {roomMove
          ? 'Rummets noteringar och bilder följer med.'
          : 'Noteringens text, risk, utredning och kopplade bilder följer med.'}
      </p>
    </Sheet>
  )
}

export type RemovalSubject = {
  request: RemovalRequest
  place: string
  image?: RoundImage
  returnEditorId?: string
  returnPhoto?: RoundImage
}

export function RemovalSheet({
  subject,
  p,
  onClose,
  onRemoved,
}: {
  subject: RemovalSubject
  p: Props
  onClose: () => void
  onRemoved: (result: RemovalResult) => void
}) {
  const [preview, setPreview] = useState<RemovalPreview | null>(null),
    [error, setError] = useState('')
  const [checking, setChecking] = useState(false),
    [busy, setBusy] = useState(false),
    [attempt, setAttempt] = useState(0),
    flight = useRef(false)
  const [requestId] = useState(() => crypto.randomUUID())
  const previewRemoval = useRef(p.onPreviewRemoval)
  useEffect(() => {
    previewRemoval.current = p.onPreviewRemoval
  }, [p.onPreviewRemoval])
  const kind = subject.request.kind,
    title =
      kind === 'note'
        ? 'Radera notering'
        : kind === 'room'
          ? 'Radera rum'
          : 'Radera bild'
  useEffect(() => {
    if (p.mutationBlocked || p.locked || preview) return
    let active = true
    setChecking(true)
    setPreview(null)
    setError('')
    previewRemoval
      .current(subject.request)
      .then((value) => {
        if (active) {
          setChecking(false)
          setPreview(value)
        }
      })
      .catch((e) => {
        if (active)
          setError(e instanceof Error ? e.message : 'Kontrollen misslyckades.')
      })
      .finally(() => {
        if (active) setChecking(false)
      })
    return () => {
      active = false
    }
  }, [subject.request, attempt, p.mutationBlocked, p.locked, preview])
  async function remove() {
    if (
      !preview ||
      preview.blockedReason ||
      flight.current ||
      p.locked ||
      p.mutationBlocked
    )
      return
    flight.current = true
    setBusy(true)
    setError('')
    try {
      onRemoved(await p.onRemove(subject.request, preview.token, requestId))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunde inte radera.')
    } finally {
      flight.current = false
      setBusy(false)
    }
  }
  return (
    <Sheet
      title={title}
      closeDisabled={busy}
      onClose={() => {
        if (!flight.current) onClose()
      }}
      footer={
        <>
          <button autoFocus disabled={busy} onClick={onClose}>
            Avbryt
          </button>
          <button
            className="obm-danger"
            disabled={
              !preview ||
              Boolean(preview.blockedReason) ||
              checking ||
              busy ||
              p.locked ||
              p.mutationBlocked
            }
            onClick={() => void remove()}
          >
            <Trash2 size={18} />
            {busy ? 'Raderar…' : title}
          </button>
        </>
      }
    >
      <p className="obm-place-label">
        <MapPin size={16} />
        {subject.place}
      </p>
      {subject.image && (
        <img
          className="obm-photo-preview"
          src={p.imageSrc(subject.image)}
          alt={subject.image.label || 'Bild som ska tas bort'}
        />
      )}
      {checking && <p role="status">Kontrollerar innehållet…</p>}
      {preview && (
        <>
          <h3>
            {kind === 'image'
              ? 'Ta bort denna bild?'
              : 'Ta bort detta innehåll?'}
          </h3>
          {kind !== 'image' && <p className="obm-full-text">{preview.label}</p>}
          {preview.blockedReason ? (
            <p role="alert" className="obm-unfinished">
              {preview.blockedReason} Flytta eller radera innehållet först.
            </p>
          ) : (
            <p className="obm-full-text">
              {kind === 'note'
                ? `Noteringen med eventuell risktext och utredning tas bort.${preview.counts.images ? ' Kopplade bilder behålls och hamnar under ”Att bearbeta”.' : ''}`
                : kind === 'image'
                  ? 'Bilden tas bort från besiktningen. Eventuell notering och dess text behålls.'
                  : 'Det tomma rummet tas bort från platslistan.'}
            </p>
          )}
        </>
      )}
      {p.mutationBlocked && (
        <p role="status" className="obm-unfinished">
          Vänta tills sparande och alla bilduppladdningar är klara innan du
          raderar.
        </p>
      )}
      {p.locked && (
        <p role="alert" className="obm-error">
          Besiktningen är låst.
        </p>
      )}
      {error && (
        <>
          <p role="alert" className="obm-error">
            {error}
          </p>
          <button
            className="obm-text-action"
            disabled={busy || checking || p.mutationBlocked || p.locked}
            onClick={() => {
              setPreview(null)
              setAttempt((value) => value + 1)
            }}
          >
            Kontrollera igen
          </button>
        </>
      )}
    </Sheet>
  )
}
