'use client'

/* eslint-disable @next/next/no-img-element */

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import {
  ArrowLeft,
  Camera,
  Image as ImageIcon,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Settings,
  Trash2,
} from 'lucide-react'
import Protected from '@/components/Protected'
import type { EbInspectionRound, EbNote, EbNoteImage } from '@/lib/eb/server'

type EbInspectionMobileRoundClientProps = {
  initialRound: EbInspectionRound
  initialDisciplineId: string | null
}

type NoteFormState = {
  markerKey: string
  statusKey: string
  location: string
  room: string
  placeDetail: string
  noteText: string
  responsibleParty: string
  tradeGroup: string
}

type RoundResponse = {
  round?: EbInspectionRound
  error?: string
}

type NoteResponse = {
  note?: EbNote
  error?: string
}

type DeleteResponse = {
  ok?: boolean
  error?: string
}

type ImageResponse = {
  image?: EbNoteImage
  ok?: boolean
  error?: string
}

const IMAGE_UPLOAD_MAX_EDGE = 1600
const IMAGE_UPLOAD_JPEG_QUALITY = 0.72
const IMAGE_UPLOAD_REENCODE_THRESHOLD_BYTES = 900 * 1024

function inputClassName() {
  return 'w-full rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm text-gray-950 shadow-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100'
}

function formatDate(value: string | null) {
  if (!value) return 'Ej satt'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString('sv-SE')
}

function formatTime(value: string | null) {
  if (!value) return ''
  return value.slice(0, 5)
}

function inspectionTitle(round: EbInspectionRound) {
  return `${round.inspection.variant}${round.inspection.sequenceNo}`
}

function createInitialForm(round: EbInspectionRound): NoteFormState {
  return {
    markerKey: round.markers.find((marker) => marker.key === 'E')?.key ?? round.markers[0]?.key ?? '',
    statusKey:
      round.statuses.find((status) => status.isDefault)?.key ?? round.statuses[0]?.key ?? 'open',
    location: '',
    room: '',
    placeDetail: '',
    noteText: '',
    responsibleParty: '',
    tradeGroup: '',
  }
}

function formFromNote(note: EbNote): NoteFormState {
  return {
    markerKey: note.markerKey ?? '',
    statusKey: note.statusKey,
    location: note.location ?? '',
    room: note.room ?? '',
    placeDetail: note.placeDetail ?? '',
    noteText: note.noteText,
    responsibleParty: note.responsibleParty ?? '',
    tradeGroup: note.tradeGroup ?? '',
  }
}

function getNoteLabel(round: EbInspectionRound, note: EbNote | null, nextNumber: number) {
  return `${round.project.notePrefix} ${note?.noteNumber ?? nextNumber}`
}

function sortNotes(notes: EbNote[]) {
  return [...notes].sort((left, right) => {
    if ((left.noteNumber ?? 0) !== (right.noteNumber ?? 0)) {
      return (left.noteNumber ?? 0) - (right.noteNumber ?? 0)
    }
    return String(left.createdAt ?? '').localeCompare(String(right.createdAt ?? ''))
  })
}

function sortImages(images: EbNoteImage[]) {
  return [...images].sort((left, right) => {
    if ((left.sortOrder ?? 0) !== (right.sortOrder ?? 0)) {
      return (left.sortOrder ?? 0) - (right.sortOrder ?? 0)
    }
    return String(left.createdAt ?? '').localeCompare(String(right.createdAt ?? ''))
  })
}

function filterSuggestions(value: string, candidates: string[]) {
  const normalizedValue = value.trim().toLocaleLowerCase('sv-SE')
  if (normalizedValue.length < 1) return []
  return candidates
    .filter((candidate) => {
      const normalizedCandidate = candidate.toLocaleLowerCase('sv-SE')
      return normalizedCandidate.startsWith(normalizedValue) && normalizedCandidate !== normalizedValue
    })
    .slice(0, 5)
}

function imageFileNameAsJpeg(name: string) {
  const baseName = name.replace(/\.[^.]+$/, '').trim()
  return `${baseName || 'bild'}.jpg`
}

function loadImageFromFile(file: File) {
  return new Promise<{ image: HTMLImageElement; objectUrl: string }>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => resolve({ image, objectUrl })
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Kunde inte läsa bilden.'))
    }
    image.src = objectUrl
  })
}

function canvasToJpegBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', IMAGE_UPLOAD_JPEG_QUALITY)
  })
}

async function prepareImageForUpload(file: File) {
  const contentType = file.type.toLowerCase()
  if (
    typeof document === 'undefined' ||
    typeof URL === 'undefined' ||
    !contentType.startsWith('image/') ||
    contentType === 'image/gif' ||
    contentType === 'image/svg+xml'
  ) {
    return file
  }

  let objectUrl: string | null = null

  try {
    const loaded = await loadImageFromFile(file)
    objectUrl = loaded.objectUrl
    const { image } = loaded
    const sourceWidth = image.naturalWidth
    const sourceHeight = image.naturalHeight
    if (sourceWidth <= 0 || sourceHeight <= 0) return file

    const scale = Math.min(1, IMAGE_UPLOAD_MAX_EDGE / Math.max(sourceWidth, sourceHeight))
    const shouldResize = scale < 1
    const shouldReencode =
      file.size > IMAGE_UPLOAD_REENCODE_THRESHOLD_BYTES || contentType !== 'image/jpeg'
    if (!shouldResize && !shouldReencode) return file

    const targetWidth = Math.max(1, Math.round(sourceWidth * scale))
    const targetHeight = Math.max(1, Math.round(sourceHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = targetWidth
    canvas.height = targetHeight
    const context = canvas.getContext('2d')
    if (!context) return file

    context.drawImage(image, 0, 0, targetWidth, targetHeight)
    const blob = await canvasToJpegBlob(canvas)
    if (!blob || blob.size >= file.size * 0.98) return file

    return new File([blob], imageFileNameAsJpeg(file.name), {
      type: 'image/jpeg',
      lastModified: file.lastModified,
    })
  } catch {
    return file
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl)
  }
}

/*
function DisciplineSheet({
  open,
  activeDisciplineId,
  disciplines,
  notes,
  canClose,
  onClose,
  onSelect,
}: {
  open: boolean
  activeDisciplineId: string | null
  disciplines: EbDiscipline[]
  notes: EbNote[]
  canClose: boolean
  onClose: () => void
  onSelect: (disciplineId: string) => void
}) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-[120] bg-white md:bg-slate-950/50 md:p-4">
      <div className="flex h-full flex-col bg-white md:mx-auto md:max-w-2xl md:overflow-hidden md:rounded-lg md:shadow-2xl">
        <div className="flex items-center justify-between border-b border-emerald-100 px-4 py-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Starta runda</p>
            <h2 className="text-lg font-semibold text-gray-950">Välj fack</h2>
          </div>
          {canClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Stäng"
              title="Stäng"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            >
              <X size={18} />
            </button>
          ) : null}
        </div>

        <div className="flex-1 overflow-auto p-4">
          <div className="space-y-2">
            {disciplines.map((discipline) => {
              const count = notes.filter((note) => note.disciplineId === discipline.id).length
              const active = activeDisciplineId === discipline.id
              return (
                <button
                  key={discipline.id}
                  type="button"
                  onClick={() => onSelect(discipline.id)}
                  className={
                    active
                      ? 'flex min-h-16 w-full items-center justify-between rounded-lg border border-emerald-700 bg-emerald-700 px-4 py-3 text-left text-white shadow-sm'
                      : 'flex min-h-16 w-full items-center justify-between rounded-lg border border-emerald-200 bg-white px-4 py-3 text-left text-gray-950 shadow-sm transition hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600'
                  }
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{discipline.label}</span>
                    <span className={active ? 'block text-xs text-white/80' : 'block text-xs text-gray-600'}>
                      {discipline.littera ?? discipline.key}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span
                      className={
                        active
                          ? 'rounded-full bg-white/20 px-2.5 py-1 text-xs font-semibold text-white'
                          : 'rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800'
                      }
                    >
                      {count}
                    </span>
                    {active ? <CheckCircle2 size={18} /> : <ChevronRight size={18} />}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

*/

export default function EbInspectionMobileRoundClient({
  initialRound,
  initialDisciplineId,
}: EbInspectionMobileRoundClientProps) {
  const cameraInputRef = useRef<HTMLInputElement | null>(null)
  const galleryInputRef = useRef<HTMLInputElement | null>(null)
  const noteHistoryOpenRef = useRef(false)
  const initialDiscipline = initialRound.disciplines.find(
    (discipline) => discipline.id === initialDisciplineId
  )
  const [round, setRound] = useState(initialRound)
  const [activeDisciplineId, setActiveDisciplineId] = useState<string | null>(
    initialDiscipline?.id ?? initialRound.disciplines[0]?.id ?? null
  )
  const [noteSheetOpen, setNoteSheetOpen] = useState(false)
  const [editingNote, setEditingNote] = useState<EbNote | null>(null)
  const [form, setForm] = useState<NoteFormState>(() => createInitialForm(initialRound))
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [imageUploadStatus, setImageUploadStatus] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deletingImageId, setDeletingImageId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const activeDiscipline =
    round.disciplines.find((discipline) => discipline.id === activeDisciplineId) ?? null
  const filteredNotes = useMemo(
    () =>
      activeDisciplineId
        ? sortNotes(round.notes.filter((note) => note.disciplineId === activeDisciplineId))
        : [],
    [activeDisciplineId, round.notes]
  )
  const nextNoteNumber = useMemo(
    () => round.notes.reduce((max, note) => Math.max(max, note.noteNumber ?? 0), 0) + 1,
    [round.notes]
  )
  const imagesByNoteId = useMemo(() => {
    const map = new Map<string, EbNoteImage[]>()
    for (const image of round.images) {
      if (!image.noteId) continue
      map.set(image.noteId, [...(map.get(image.noteId) ?? []), image])
    }
    for (const [noteId, images] of map) {
      map.set(noteId, sortImages(images))
    }
    return map
  }, [round.images])
  const suggestionCandidates = useMemo(() => {
    const unique = new Map<string, string>()
    for (const suggestion of round.suggestions) {
      unique.set(suggestion.phrase.toLocaleLowerCase('sv-SE'), suggestion.phrase)
    }
    for (const note of round.notes) {
      if (note.noteText.trim()) {
        unique.set(note.noteText.trim().toLocaleLowerCase('sv-SE'), note.noteText.trim())
      }
    }
    return Array.from(unique.values())
  }, [round.notes, round.suggestions])
  const roomSuggestionCandidates = useMemo(
    () =>
      Array.from(
        new Map(
          round.notes
            .map((note) => note.room?.trim())
            .filter((value): value is string => Boolean(value))
            .map((value) => [value.toLocaleLowerCase('sv-SE'), value])
        ).values()
      ),
    [round.notes]
  )
  const locationSuggestionCandidates = useMemo(
    () =>
      Array.from(
        new Map(
          round.notes
            .map((note) => note.location?.trim())
            .filter((value): value is string => Boolean(value))
            .map((value) => [value.toLocaleLowerCase('sv-SE'), value])
        ).values()
      ),
    [round.notes]
  )
  const visibleSuggestions = useMemo(
    () => filterSuggestions(form.noteText, suggestionCandidates),
    [form.noteText, suggestionCandidates]
  )
  const visibleRoomSuggestions = useMemo(
    () => filterSuggestions(form.room, roomSuggestionCandidates),
    [form.room, roomSuggestionCandidates]
  )
  const visibleLocationSuggestions = useMemo(
    () => filterSuggestions(form.location, locationSuggestionCandidates),
    [form.location, locationSuggestionCandidates]
  )

  const roundPath = `/api/eb/projects/${round.project.id}/inspections/${round.inspection.inspectionId}/round`
  const notesBasePath = `/api/eb/projects/${round.project.id}/inspections/${round.inspection.inspectionId}/notes`
  const adminHref = `/eb/projects/${round.project.id}/inspections/${round.inspection.inspectionId}/perform${
    activeDisciplineId ? `?disciplineId=${activeDisciplineId}` : ''
  }`

  useEffect(() => {
    const handlePopState = () => {
      if (!noteHistoryOpenRef.current) return
      noteHistoryOpenRef.current = false
      setNoteSheetOpen(false)
      setEditingNote(null)
      setForm(createInitialForm(round))
      setError(null)
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [round])

  const updateField = <K extends keyof NoteFormState>(field: K, value: NoteFormState[K]) => {
    setForm((current) => ({ ...current, [field]: value }))
  }

  const openNoteSheet = () => {
    if (!noteHistoryOpenRef.current) {
      window.history.pushState({ ebNoteSheet: true }, '', window.location.href)
      noteHistoryOpenRef.current = true
    }
    setNoteSheetOpen(true)
  }

  const openNewNote = () => {
    if (!activeDisciplineId) {
      setError('Fack saknas för rundan.')
      return
    }
    setEditingNote(null)
    setForm(createInitialForm(round))
    setError(null)
    openNoteSheet()
  }

  const handleEdit = (note: EbNote) => {
    setEditingNote(note)
    setActiveDisciplineId(note.disciplineId)
    setForm(formFromNote(note))
    setError(null)
    openNoteSheet()
  }

  const closeNoteSheet = () => {
    if (saving) return
    if (noteHistoryOpenRef.current) {
      noteHistoryOpenRef.current = false
      window.history.back()
    }
    setNoteSheetOpen(false)
    setEditingNote(null)
    setForm(createInitialForm(round))
    setError(null)
  }

  const upsertNoteInState = (note: EbNote) => {
    setRound((current) => {
      const notes = sortNotes([...current.notes.filter((item) => item.id !== note.id), note])
      const phrase = note.noteText.trim()
      const hasSuggestion = current.suggestions.some(
        (suggestion) =>
          suggestion.phrase.toLocaleLowerCase('sv-SE') === phrase.toLocaleLowerCase('sv-SE')
      )
      return {
        ...current,
        notes,
        suggestions:
          phrase && !hasSuggestion
            ? [
                {
                  id: `local-${note.id}`,
                  phrase,
                  normalizedPrefix: phrase.slice(0, 1).toLocaleLowerCase('sv-SE'),
                  useCount: 1,
                  lastUsedAt: note.updatedAt ?? note.createdAt,
                },
                ...current.suggestions,
              ]
            : current.suggestions,
      }
    })
  }

  const upsertImageInState = (image: EbNoteImage) => {
    setRound((current) => ({
      ...current,
      images: sortImages([...current.images.filter((item) => item.id !== image.id), image]),
    }))
  }

  const saveCurrentNote = async () => {
    if (!activeDisciplineId) {
      throw new Error('Fack saknas för rundan.')
    }
    if (!form.noteText.trim()) {
      throw new Error('Skriv en noteringstext innan du sparar.')
    }

    setSaving(true)
    const response = await fetch(
      editingNote ? `${notesBasePath}/${editingNote.id}` : notesBasePath,
      {
        method: editingNote ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          disciplineId: activeDisciplineId,
        }),
      }
    )
    const payload = (await response.json().catch(() => ({}))) as NoteResponse
    if (!response.ok || !payload.note) {
      throw new Error(payload.error ?? 'Kunde inte spara noteringen.')
    }

    upsertNoteInState(payload.note)
    setEditingNote(payload.note)
    setForm(formFromNote(payload.note))
    setNoteSheetOpen(true)
    return payload.note
  }

  const uploadImage = async (file: File) => {
    if (uploadingImage) return

    try {
      setUploadingImage(true)
      setImageUploadStatus(editingNote ? 'Optimerar bild...' : 'Sparar notering...')
      setError(null)
      const note = editingNote ?? (await saveCurrentNote())
      setSaving(false)
      setImageUploadStatus('Optimerar bild...')
      const uploadFile = await prepareImageForUpload(file)
      setImageUploadStatus('Laddar upp bild...')
      const formData = new FormData()
      formData.append('file', uploadFile)
      const response = await fetch(`${notesBasePath}/${note.id}/images`, {
        method: 'POST',
        body: formData,
      })
      const payload = (await response.json().catch(() => ({}))) as ImageResponse
      if (!response.ok || !payload.image) {
        throw new Error(payload.error ?? 'Kunde inte ladda upp bild.')
      }
      upsertImageInState(payload.image)
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Kunde inte ladda upp bild.')
    } finally {
      setSaving(false)
      setUploadingImage(false)
      setImageUploadStatus(null)
    }
  }

  const handleImageSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    await uploadImage(file)
  }

  const deleteImage = async (image: EbNoteImage) => {
    if (!editingNote || deletingImageId) return
    const confirmed = window.confirm('Radera bilden?')
    if (!confirmed) return

    try {
      setDeletingImageId(image.id)
      setError(null)
      const response = await fetch(`${notesBasePath}/${editingNote.id}/images`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId: image.id }),
      })
      const payload = (await response.json().catch(() => ({}))) as ImageResponse
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? 'Kunde inte radera bilden.')
      }
      setRound((current) => ({
        ...current,
        images: current.images.filter((item) => item.id !== image.id),
      }))
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Kunde inte radera bilden.')
    } finally {
      setDeletingImageId(null)
    }
  }

  const refreshRound = async () => {
    if (refreshing) return

    try {
      setRefreshing(true)
      setError(null)
      const response = await fetch(roundPath)
      const payload = (await response.json().catch(() => ({}))) as RoundResponse
      if (!response.ok || !payload.round) {
        throw new Error(payload.error ?? 'Kunde inte uppdatera rundan.')
      }
      setRound(payload.round)
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Kunde inte uppdatera rundan.')
    } finally {
      setRefreshing(false)
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving || !activeDisciplineId) return

    try {
      setError(null)
      await saveCurrentNote()
      closeNoteSheet()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Kunde inte spara noteringen.')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveAndNew = async () => {
    if (saving || !activeDisciplineId) return

    try {
      setError(null)
      await saveCurrentNote()
      setEditingNote(null)
      setForm(createInitialForm(round))
      setNoteSheetOpen(true)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Kunde inte spara noteringen.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (note: EbNote) => {
    if (deletingId) return
    const confirmed = window.confirm(`Radera ${round.project.notePrefix} ${note.noteNumber}?`)
    if (!confirmed) return

    try {
      setDeletingId(note.id)
      setError(null)
      const response = await fetch(`${notesBasePath}/${note.id}`, { method: 'DELETE' })
      const payload = (await response.json().catch(() => ({}))) as DeleteResponse
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? 'Kunde inte radera noteringen.')
      }
      setRound((current) => ({
        ...current,
        notes: current.notes.filter((item) => item.id !== note.id),
      }))
      if (editingNote?.id === note.id) {
        closeNoteSheet()
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Kunde inte radera noteringen.')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <Protected>
      <main className="min-h-dvh bg-[#fbfefc] pb-16 text-gray-950">
        <header className="sticky top-0 z-40 border-b border-emerald-100 bg-white/95 backdrop-blur">
          <div className="mx-auto w-full max-w-4xl px-3 py-2.5">
            <div className="flex items-start gap-3">
              <Link
                href={`/eb/projects/${round.project.id}`}
                aria-label="Tillbaka"
                title="Tillbaka"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-emerald-200 bg-white text-emerald-800 transition hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
              >
                <ArrowLeft size={17} strokeWidth={2} />
              </Link>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex rounded-full bg-emerald-700 px-2.5 py-1 text-xs font-semibold text-white">
                    {inspectionTitle(round)}
                  </span>
                  <span className="truncate text-xs font-semibold text-emerald-800">
                    {activeDiscipline?.label ?? 'Fack saknas'}
                  </span>
                  <span className="truncate text-xs text-gray-600">
                    {formatDate(round.inspection.date)}
                    {round.inspection.inspectionTime ? ` ${formatTime(round.inspection.inspectionTime)}` : ''}
                  </span>
                </div>
                <h1 className="mt-1 truncate text-base font-semibold text-gray-950">{round.project.title}</h1>
                <button
                  type="button"
                  onClick={undefined}
                  className="hidden"
                >
                  {null}
                  <span className="truncate">{activeDiscipline ? activeDiscipline.label : 'Välj fack'}</span>
                </button>
              </div>
            </div>
          </div>

          <div className="hidden">
            <div className="flex min-w-max gap-2">
              {round.disciplines.map((discipline) => {
                const count = round.notes.filter((note) => note.disciplineId === discipline.id).length
                const active = discipline.id === activeDisciplineId
                return (
                  <button
                    key={discipline.id}
                    type="button"
                    onClick={undefined}
                    className={
                      active
                        ? 'inline-flex items-center gap-2 rounded-full bg-emerald-700 px-3 py-2 text-sm font-semibold text-white shadow-sm'
                        : 'inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-emerald-900'
                    }
                  >
                    {discipline.label}
                    <span
                      className={
                        active
                          ? 'rounded-full bg-white/20 px-2 py-0.5 text-xs text-white'
                          : 'rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800'
                      }
                    >
                      {count}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </header>

        <div className="mx-auto w-full max-w-4xl px-3 py-3">
          <section className="grid grid-cols-[1fr_auto_auto] gap-2">
            <button
              type="button"
              onClick={openNewNote}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-emerald-700 px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800"
            >
              <Plus size={16} />
              Notering
            </button>
            <button
              type="button"
              onClick={undefined}
              className="hidden"
            >
              {null}
              Fack
            </button>
            <button
              type="button"
              onClick={() => void refreshRound()}
              disabled={refreshing}
              className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-emerald-200 bg-white text-emerald-800 shadow-sm transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
              aria-label="Uppdatera"
              title="Uppdatera"
            >
              {refreshing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            </button>
          </section>

          <section className="mt-2 grid grid-cols-[1fr_auto] items-center gap-3 rounded-md border border-emerald-100 bg-white px-3 py-2 shadow-sm">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-gray-950">
                {activeDiscipline ? activeDiscipline.label : 'Inget fack valt'}
              </p>
              <p className="text-xs text-gray-600">
                {filteredNotes.length} noteringar av {round.notes.length} totalt
              </p>
            </div>
            <Link
              href={adminHref}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-emerald-200 bg-white text-emerald-800 transition hover:bg-emerald-50"
              aria-label="Admin"
              title="Admin"
            >
              <Settings size={16} />
            </Link>
          </section>

          {error ? (
            <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          ) : null}

          <section className="mt-3 space-y-3">
            {filteredNotes.length === 0 ? (
              <div className="rounded-lg border border-dashed border-emerald-200 bg-white px-4 py-10 text-center text-sm text-gray-600">
                Inga noteringar i detta fack.
              </div>
            ) : (
              filteredNotes.map((note) => (
                <article key={note.id} className="overflow-hidden rounded-md border border-emerald-100 bg-white shadow-sm">
                  <button
                    type="button"
                    onClick={() => handleEdit(note)}
                    className="block w-full p-3 text-left transition hover:bg-emerald-50/35"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex rounded-full bg-emerald-700 px-2.5 py-1 text-xs font-semibold text-white">
                            {round.project.notePrefix} {note.noteNumber}
                          </span>
                          {note.markerKey ? (
                            <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900">
                              {note.markerKey}
                            </span>
                          ) : null}
                          <span className="inline-flex rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-700">
                            {note.statusLabel ?? note.statusKey}
                          </span>
                        </div>
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-950">
                          {note.noteText}
                        </p>
                      </div>
                      <Pencil size={15} className="mt-1 shrink-0 text-emerald-700" />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
                      {note.room ? <span>Rum: {note.room}</span> : null}
                      {note.location ? <span>Plats: {note.location}</span> : null}
                      {note.placeDetail ? <span>Detalj: {note.placeDetail}</span> : null}
                      {note.tradeGroup ? <span>Yrkesgrupp: {note.tradeGroup}</span> : null}
                      {note.responsibleParty ? <span>Ansvarig: {note.responsibleParty}</span> : null}
                    </div>
                  </button>
                  {(imagesByNoteId.get(note.id)?.length ?? 0) > 0 ? (
                    <div className="flex gap-2 overflow-x-auto border-t border-emerald-100 px-3 py-2">
                      {(imagesByNoteId.get(note.id) ?? []).slice(0, 8).map((image) => (
                        <img
                          key={image.id}
                          src={image.publicUrl}
                          alt={image.label ?? 'Bild'}
                          className="h-14 w-14 shrink-0 rounded-md border border-emerald-100 object-cover"
                        />
                      ))}
                    </div>
                  ) : null}
                </article>
              ))
            )}
          </section>
        </div>

        <div className="fixed inset-x-0 bottom-0 z-50 border-t border-emerald-100 bg-white/95 px-3 py-2 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur md:hidden">
          <div className="mx-auto max-w-4xl">
            <button
              type="button"
              onClick={openNewNote}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white"
            >
              <Plus size={16} />
              Ny notering
            </button>
          </div>
        </div>

        {noteSheetOpen ? (
          <div className="fixed inset-0 z-[110] bg-white md:bg-slate-950/50 md:p-4">
            <div className="flex h-full flex-col bg-white md:mx-auto md:max-w-3xl md:overflow-hidden md:rounded-lg md:shadow-2xl">
              <div className="flex items-center justify-between border-b border-emerald-100 px-3 py-2.5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
                    {editingNote ? 'Redigera' : 'Ny notering'}
                  </p>
                  <h2 className="text-base font-semibold text-gray-950">
                    {getNoteLabel(round, editingNote, nextNoteNumber)}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={closeNoteSheet}
                  aria-label="Stäng"
                  title="Stäng"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                >
                  <ArrowLeft size={17} />
                </button>
              </div>

              <form onSubmit={(event) => void handleSubmit(event)} className="flex min-h-0 flex-1 flex-col">
                <div className="flex-1 space-y-3 overflow-auto p-3">
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="block text-xs font-semibold text-gray-700">Beteckning</span>
                      <select
                        value={form.markerKey}
                        onChange={(event) => updateField('markerKey', event.target.value)}
                        className={`${inputClassName()} mt-1`}
                      >
                        {round.markers.map((marker) => (
                          <option key={marker.key} value={marker.key}>
                            {marker.key} - {marker.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="block text-xs font-semibold text-gray-700">Status</span>
                      <select
                        value={form.statusKey}
                        onChange={(event) => updateField('statusKey', event.target.value)}
                        className={`${inputClassName()} mt-1`}
                      >
                        {round.statuses.map((status) => (
                          <option key={status.key} value={status.key}>
                            {status.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="block text-xs font-semibold text-gray-700">Rum</span>
                      <input
                        value={form.room}
                        onChange={(event) => updateField('room', event.target.value)}
                        className={`${inputClassName()} mt-1`}
                      />
                      {visibleRoomSuggestions.length > 0 ? (
                        <span className="mt-1 block space-y-1">
                          {visibleRoomSuggestions.map((suggestion) => (
                            <button
                              key={suggestion}
                              type="button"
                              onClick={() => updateField('room', suggestion)}
                              className="block w-full rounded-md border border-emerald-100 bg-emerald-50 px-2 py-1.5 text-left text-xs text-emerald-950"
                            >
                              {suggestion}
                            </button>
                          ))}
                        </span>
                      ) : null}
                    </label>
                    <label className="block">
                      <span className="block text-xs font-semibold text-gray-700">Plats</span>
                      <input
                        value={form.location}
                        onChange={(event) => updateField('location', event.target.value)}
                        className={`${inputClassName()} mt-1`}
                      />
                      {visibleLocationSuggestions.length > 0 ? (
                        <span className="mt-1 block space-y-1">
                          {visibleLocationSuggestions.map((suggestion) => (
                            <button
                              key={suggestion}
                              type="button"
                              onClick={() => updateField('location', suggestion)}
                              className="block w-full rounded-md border border-emerald-100 bg-emerald-50 px-2 py-1.5 text-left text-xs text-emerald-950"
                            >
                              {suggestion}
                            </button>
                          ))}
                        </span>
                      ) : null}
                    </label>
                  </div>

                  <label className="block">
                    <span className="block text-xs font-semibold text-gray-700">Detalj</span>
                    <input
                      value={form.placeDetail}
                      onChange={(event) => updateField('placeDetail', event.target.value)}
                      className={`${inputClassName()} mt-1`}
                    />
                  </label>

                  <label className="block">
                    <span className="block text-xs font-semibold text-gray-700">Notering</span>
                    <textarea
                      value={form.noteText}
                      onChange={(event) => updateField('noteText', event.target.value)}
                      rows={5}
                      required
                      className={`${inputClassName()} mt-1 min-h-32 resize-y leading-6`}
                    />
                  </label>

                  {visibleSuggestions.length > 0 ? (
                    <div className="space-y-2">
                      {visibleSuggestions.map((suggestion) => (
                        <button
                          key={suggestion}
                          type="button"
                          onClick={() => updateField('noteText', suggestion)}
                          className="block w-full rounded-md border border-emerald-100 bg-emerald-50 px-3 py-2 text-left text-sm text-emerald-950 transition hover:bg-emerald-100"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  ) : null}

                  <section className="rounded-md border border-emerald-100 bg-emerald-50/25 p-2.5">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
                            Bilder
                          </p>
                          <p className="text-sm font-semibold text-gray-950">
                            {editingNote ? (imagesByNoteId.get(editingNote.id)?.length ?? 0) : 0} st
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => cameraInputRef.current?.click()}
                            disabled={uploadingImage}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-emerald-700 text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-emerald-300"
                            aria-label="Kamera"
                            title="Kamera"
                          >
                            {uploadingImage ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} />}
                          </button>
                          <button
                            type="button"
                            onClick={() => galleryInputRef.current?.click()}
                            disabled={uploadingImage}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-emerald-200 bg-white text-emerald-800 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                            aria-label="Bild"
                            title="Bild"
                          >
                            <ImageIcon size={18} />
                          </button>
                        </div>
                      </div>

                      <input
                        ref={cameraInputRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={(event) => void handleImageSelected(event)}
                        className="hidden"
                      />
                      <input
                        ref={galleryInputRef}
                        type="file"
                        accept="image/*"
                        onChange={(event) => void handleImageSelected(event)}
                        className="hidden"
                      />
                      {uploadingImage ? (
                        <p className="mt-2 text-xs font-medium text-emerald-800">
                          {imageUploadStatus ?? 'Laddar upp bild...'}
                        </p>
                      ) : null}

                      {editingNote && (imagesByNoteId.get(editingNote.id)?.length ?? 0) > 0 ? (
                        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                          {(imagesByNoteId.get(editingNote.id) ?? []).map((image) => (
                            <div key={image.id} className="relative overflow-hidden rounded-md border border-emerald-100 bg-white">
                              <img
                                src={image.publicUrl}
                                alt={image.label ?? 'Bild'}
                                className="aspect-square w-full object-cover"
                              />
                              <button
                                type="button"
                                onClick={() => void deleteImage(image)}
                                disabled={deletingImageId === image.id}
                                className="absolute right-1 top-1 inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-rose-700 shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                                aria-label="Radera bild"
                                title="Radera bild"
                              >
                                {deletingImageId === image.id ? (
                                  <Loader2 size={15} className="animate-spin" />
                                ) : (
                                  <Trash2 size={15} />
                                )}
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </section>

                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="block text-xs font-semibold text-gray-700">Ansvarig</span>
                      <input
                        value={form.responsibleParty}
                        onChange={(event) => updateField('responsibleParty', event.target.value)}
                        className={`${inputClassName()} mt-1`}
                      />
                    </label>
                    <label className="block">
                      <span className="block text-xs font-semibold text-gray-700">Yrkesgrupp</span>
                      <input
                        value={form.tradeGroup}
                        onChange={(event) => updateField('tradeGroup', event.target.value)}
                        className={`${inputClassName()} mt-1`}
                      />
                    </label>
                  </div>

                  {error ? (
                    <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                      {error}
                    </div>
                  ) : null}
                </div>

                <div className="border-t border-emerald-100 bg-white p-2">
                  <div className="flex gap-2">
                    {editingNote ? (
                      <button
                        type="button"
                        onClick={() => void handleDelete(editingNote)}
                        disabled={deletingId === editingNote.id}
                        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-rose-200 bg-white text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                        aria-label="Radera"
                        title="Radera"
                      >
                        {deletingId === editingNote.id ? (
                          <Loader2 size={18} className="animate-spin" />
                        ) : (
                          <Trash2 size={18} />
                        )}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void handleSaveAndNew()}
                      disabled={saving || !activeDisciplineId}
                      className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md border border-emerald-200 bg-white px-3 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Plus size={16} />
                      Ny notering
                    </button>
                    <button
                      type="submit"
                      disabled={saving || !activeDisciplineId}
                      className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-emerald-300"
                    >
                      {saving ? (
                        <Loader2 size={18} className="animate-spin" />
                      ) : (
                        <Save size={18} />
                      )}
                      {saving ? 'Sparar...' : 'Klar'}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        ) : null}

      </main>
    </Protected>
  )
}
