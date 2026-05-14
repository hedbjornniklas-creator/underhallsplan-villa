'use client'

/* eslint-disable @next/next/no-img-element */

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import {
  ArrowLeft,
  Camera,
  ClipboardCheck,
  Image as ImageIcon,
  Loader2,
  Pencil,
  Plus,
  Save,
  Smartphone,
  Trash2,
  X,
} from 'lucide-react'
import Protected from '@/components/Protected'
import type { EbDiscipline, EbInspectionRound, EbNote, EbNoteImage } from '@/lib/eb/server'

type EbInspectionRoundClientProps = {
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

function StartDisciplineDialog({
  open,
  disciplines,
  onSelect,
}: {
  open: boolean
  disciplines: EbDiscipline[]
  onSelect: (disciplineId: string) => void
}) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/55 p-3">
      <div className="w-full max-w-2xl overflow-hidden rounded-lg border border-emerald-100 bg-white shadow-2xl">
        <div className="border-b border-emerald-100 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Starta runda</p>
          <h2 className="text-lg font-semibold text-gray-950">Välj ditt fack</h2>
        </div>
        <div className="grid gap-2 p-4 sm:grid-cols-2">
          {disciplines.map((discipline) => (
            <button
              key={discipline.id}
              type="button"
              onClick={() => onSelect(discipline.id)}
              className="flex min-h-16 items-center justify-between rounded-md border border-emerald-200 bg-white px-4 py-3 text-left transition hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
            >
              <span>
                <span className="block text-sm font-semibold text-gray-950">{discipline.label}</span>
                <span className="block text-xs text-gray-600">{discipline.littera ?? discipline.key}</span>
              </span>
              <ClipboardCheck size={18} className="text-emerald-700" />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function EbInspectionRoundClient({
  initialRound,
  initialDisciplineId,
}: EbInspectionRoundClientProps) {
  const router = useRouter()
  const pathname = usePathname()
  const cameraInputRef = useRef<HTMLInputElement | null>(null)
  const galleryInputRef = useRef<HTMLInputElement | null>(null)
  const [round, setRound] = useState(initialRound)
  const initialDiscipline = initialRound.disciplines.find(
    (discipline) => discipline.id === initialDisciplineId
  )
  const [activeDisciplineId, setActiveDisciplineId] = useState<string | null>(
    initialDiscipline?.id ?? null
  )
  const [startDialogOpen] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [form, setForm] = useState<NoteFormState>(() => createInitialForm(initialRound))
  const [editingNote, setEditingNote] = useState<EbNote | null>(null)
  const [saving, setSaving] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deletingImageId, setDeletingImageId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const activeDiscipline = round.disciplines.find((discipline) => discipline.id === activeDisciplineId) ?? null
  const filteredNotes = useMemo(
    () =>
      activeDisciplineId
        ? sortNotes(round.notes.filter((note) => note.disciplineId === activeDisciplineId))
        : sortNotes(round.notes),
    [activeDisciplineId, round.notes]
  )
  const imagesByNoteId = useMemo(() => {
    const map = new Map<string, EbNoteImage[]>()
    for (const image of round.images) {
      map.set(image.noteId, [...(map.get(image.noteId) ?? []), image])
    }
    for (const [noteId, images] of map) {
      map.set(noteId, sortImages(images))
    }
    return map
  }, [round.images])
  const allImages = useMemo(() => sortImages(round.images), [round.images])
  const nextNoteNumber = useMemo(
    () => round.notes.reduce((max, note) => Math.max(max, note.noteNumber ?? 0), 0) + 1,
    [round.notes]
  )
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
  const visibleSuggestions = useMemo(() => {
    const value = form.noteText.trim().toLocaleLowerCase('sv-SE')
    if (value.length < 1) return []
    return suggestionCandidates
      .filter((candidate) => {
        const normalized = candidate.toLocaleLowerCase('sv-SE')
        return normalized.startsWith(value) && normalized !== value
      })
      .slice(0, 5)
  }, [form.noteText, suggestionCandidates])

  useEffect(() => {
    if (editingNote) return
    setForm(createInitialForm(round))
  }, [activeDisciplineId, editingNote, round])

  const notesBasePath = `/api/eb/projects/${round.project.id}/inspections/${round.inspection.inspectionId}/notes`

  const selectDiscipline = (disciplineId: string) => {
    setActiveDisciplineId(disciplineId)
    setEditingNote(null)
    router.replace(`${pathname}?disciplineId=${disciplineId}`, { scroll: false })
  }

  const showAllDisciplines = () => {
    setActiveDisciplineId(null)
    setEditingNote(null)
    router.replace(pathname, { scroll: false })
  }

  const updateField = <K extends keyof NoteFormState>(field: K, value: NoteFormState[K]) => {
    setForm((current) => ({ ...current, [field]: value }))
  }

  const resetForm = () => {
    setEditingNote(null)
    setForm(createInitialForm(round))
    setError(null)
  }

  const closeEditor = () => {
    resetForm()
    setEditorOpen(false)
  }

  const upsertNoteInState = (note: EbNote) => {
    setRound((current) => {
      const withoutSame = current.notes.filter((item) => item.id !== note.id)
      const notes = [...withoutSame, note].sort((left, right) => {
        if ((left.noteNumber ?? 0) !== (right.noteNumber ?? 0)) {
          return (left.noteNumber ?? 0) - (right.noteNumber ?? 0)
        }
        return String(left.createdAt ?? '').localeCompare(String(right.createdAt ?? ''))
      })
      const hasSuggestion = current.suggestions.some(
        (suggestion) =>
          suggestion.phrase.toLocaleLowerCase('sv-SE') === note.noteText.toLocaleLowerCase('sv-SE')
      )
      return {
        ...current,
        notes,
        suggestions: hasSuggestion
          ? current.suggestions
          : [
              {
                id: `local-${note.id}`,
                phrase: note.noteText,
                normalizedPrefix: note.noteText.slice(0, 1).toLocaleLowerCase('sv-SE'),
                useCount: 1,
                lastUsedAt: note.updatedAt ?? note.createdAt,
              },
              ...current.suggestions,
            ],
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
    const disciplineId =
      editingNote?.disciplineId ?? activeDisciplineId ?? round.disciplines[0]?.id ?? null
    if (saving || !disciplineId) return null

    setSaving(true)
    const response = await fetch(editingNote ? `${notesBasePath}/${editingNote.id}` : notesBasePath, {
      method: editingNote ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        disciplineId,
      }),
    })
    const payload = (await response.json().catch(() => ({}))) as NoteResponse
    if (!response.ok || !payload.note) {
      throw new Error(payload.error ?? 'Kunde inte spara noteringen.')
    }

    upsertNoteInState(payload.note)
    setEditingNote(payload.note)
    setForm(formFromNote(payload.note))
    return payload.note
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving) return

    try {
      setError(null)
      await saveCurrentNote()
      closeEditor()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Kunde inte spara noteringen.')
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = (note: EbNote) => {
    setEditingNote(note)
    setEditorOpen(true)
    setActiveDisciplineId(note.disciplineId)
    if (note.disciplineId) {
      router.replace(`${pathname}?disciplineId=${note.disciplineId}`, { scroll: false })
    }
    setForm(formFromNote(note))
    setError(null)
  }

  const handleNewNote = () => {
    setEditingNote(null)
    setActiveDisciplineId((current) => current ?? round.disciplines[0]?.id ?? null)
    setForm(createInitialForm(round))
    setError(null)
    setEditorOpen(true)
  }

  const uploadImage = async (file: File) => {
    if (uploadingImage) return

    try {
      setUploadingImage(true)
      setError(null)
      const note = editingNote ?? (await saveCurrentNote())
      if (!note) return
      setSaving(false)

      const formData = new FormData()
      formData.append('file', file)
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
        resetForm()
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Kunde inte radera noteringen.')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <Protected>
      <main className="relative min-h-full overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(100% 72% at 50% 0%, rgba(220,252,231,0.08) 0%, rgba(220,252,231,0) 62%), linear-gradient(135deg, #ffffff 0%, #fbfefc 52%, #fafdfb 100%)',
          }}
        />
        <div className="pointer-events-none absolute inset-0 bg-white/62 backdrop-blur-[1px]" />

        <div className="relative mx-auto w-full max-w-7xl p-4 md:p-6">
          <header className="rounded-lg border border-emerald-100 bg-white/84 p-4 shadow-sm backdrop-blur-sm md:p-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <Link
                  href={`/eb/projects/${round.project.id}`}
                  aria-label="Tillbaka"
                  title="Tillbaka"
                  className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-emerald-200 bg-white text-emerald-800 transition hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                >
                  <ArrowLeft size={17} strokeWidth={2} />
                </Link>
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">
                    {inspectionTitle(round)}
                  </p>
                  <h1 className="truncate text-2xl font-semibold text-gray-950">{round.project.title}</h1>
                  <p className="mt-1 truncate text-sm text-gray-600">
                    {round.inspection.variantLabel} · {formatDate(round.inspection.date)}
                    {round.inspection.inspectionTime ? ` ${formatTime(round.inspection.inspectionTime)}` : ''}
                  </p>
                </div>
              </div>
              <Link
                href={`/eb/projects/${round.project.id}/inspections/${round.inspection.inspectionId}/round${
                  activeDisciplineId ? `?disciplineId=${activeDisciplineId}` : ''
                }`}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
              >
                <Smartphone size={16} />
                Mobil runda
              </Link>
            </div>
          </header>

          <section className="mt-3 overflow-x-auto border-y border-emerald-100 bg-white/70 px-2 py-2">
            <div className="flex min-w-max gap-2">
              <button
                type="button"
                onClick={showAllDisciplines}
                className={
                  activeDisciplineId === null
                    ? 'inline-flex items-center gap-2 rounded-md border border-emerald-700 bg-emerald-700 px-3 py-2 text-sm font-semibold text-white'
                    : 'inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-emerald-900 transition hover:bg-emerald-50'
                }
              >
                Alla
                <span
                  className={
                    activeDisciplineId === null
                      ? 'rounded-full bg-white/20 px-2 py-0.5 text-xs text-white'
                      : 'rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800'
                  }
                >
                  {round.notes.length}
                </span>
              </button>
              {round.disciplines.map((discipline) => {
                const count = round.notes.filter((note) => note.disciplineId === discipline.id).length
                const active = discipline.id === activeDisciplineId
                return (
                  <button
                    key={discipline.id}
                    type="button"
                    onClick={() => selectDiscipline(discipline.id)}
                    className={
                      active
                        ? 'inline-flex items-center gap-2 rounded-md border border-emerald-700 bg-emerald-700 px-3 py-2 text-sm font-semibold text-white'
                        : 'inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-emerald-900 transition hover:bg-emerald-50'
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
          </section>

          <div className="mt-3 min-h-[62vh]">
            <section className="min-w-0 border-y border-emerald-100 bg-white/82 backdrop-blur-sm">
              <div className="grid grid-cols-[6rem_7rem_8rem_8rem_1fr_5rem_3rem] items-center gap-3 border-b border-emerald-100 px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">
                <span>Nr</span>
                <span>Status</span>
                <span>Rum</span>
                <span>Plats</span>
                <span>Notering</span>
                <span>Bilder</span>
                <span />
              </div>
              <div className="flex items-center justify-between border-b border-emerald-100 px-3 py-2">
                <div>
                  <h2 className="text-sm font-semibold text-gray-950">
                    {activeDiscipline ? activeDiscipline.label : 'Alla noteringar'}
                  </h2>
                  <p className="text-xs text-gray-600">{activeDiscipline?.littera ?? 'Samtliga fack'}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-medium text-gray-500">{filteredNotes.length} st</span>
                  <button
                    type="button"
                    onClick={handleNewNote}
                    className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-emerald-700 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-emerald-300"
                  >
                    <Plus size={14} />
                    Ny notering
                  </button>
                </div>
              </div>

              {filteredNotes.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-gray-600">Inga noteringar.</div>
              ) : (
                <div className="divide-y divide-emerald-100">
                  {filteredNotes.map((note) => (
                    <article
                      key={note.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleEdit(note)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') handleEdit(note)
                      }}
                      className="grid cursor-pointer grid-cols-[6rem_7rem_8rem_8rem_1fr_5rem_3rem] items-center gap-3 px-3 py-2 text-sm transition hover:bg-emerald-50/70"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-emerald-900">
                          {round.project.notePrefix} {note.noteNumber}
                        </span>
                        {note.markerKey ? (
                          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-semibold text-amber-900">
                            {note.markerKey}
                          </span>
                        ) : null}
                      </div>
                      <span className="truncate text-xs font-medium text-gray-700">{note.statusLabel ?? note.statusKey}</span>
                      <span className="truncate text-gray-700">{note.room || '-'}</span>
                      <span className="truncate text-gray-700">{note.location || '-'}</span>
                      <span className="truncate text-gray-950">{note.noteText}</span>
                      <span className="text-xs font-medium text-gray-600">{imagesByNoteId.get(note.id)?.length ?? 0} st</span>
                      <div className="flex justify-end">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation()
                              handleEdit(note)
                            }}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-emerald-800 transition hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                            aria-label="Redigera"
                            title="Redigera"
                          >
                            <Pencil size={16} />
                          </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

          </div>
        </div>

        {editorOpen ? (
          <div className="fixed inset-0 z-[100] flex justify-end bg-slate-950/25" onClick={closeEditor}>
            <aside
              className="flex h-full w-full max-w-xl flex-col bg-white shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-emerald-100 px-4 py-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">
                    {editingNote ? 'Redigera' : 'Ny notering'}
                  </p>
                  <h2 className="text-lg font-semibold text-gray-950">
                    {getNoteLabel(round, editingNote, nextNoteNumber)}
                  </h2>
                </div>
                <button
                    type="button"
                    onClick={closeEditor}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-700 transition hover:bg-gray-50"
                    aria-label="Stäng"
                    title="Stäng"
                  >
                    <X size={16} />
                  </button>
              </div>

              <form onSubmit={(event) => void handleSubmit(event)} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
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
                  </label>
                  <label className="block">
                    <span className="block text-xs font-semibold text-gray-700">Plats</span>
                    <input
                      value={form.location}
                      onChange={(event) => updateField('location', event.target.value)}
                      className={`${inputClassName()} mt-1`}
                    />
                  </label>
                </div>

                <label className="block">
                  <span className="block text-xs font-semibold text-gray-700">Platskomplettering</span>
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
                    className={`${inputClassName()} mt-1 resize-y leading-6`}
                  />
                </label>

                {visibleSuggestions.length > 0 ? (
                  <div className="space-y-1">
                    {visibleSuggestions.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => updateField('noteText', suggestion)}
                        className="block w-full rounded-md border border-emerald-100 bg-emerald-50 px-3 py-2 text-left text-xs text-emerald-950 transition hover:bg-emerald-100"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                ) : null}

                <section className="border-y border-emerald-100 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">Bilder</p>
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
                  <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={(event) => void handleImageSelected(event)} className="hidden" />
                  <input ref={galleryInputRef} type="file" accept="image/*" onChange={(event) => void handleImageSelected(event)} className="hidden" />
                  {editingNote && (imagesByNoteId.get(editingNote.id)?.length ?? 0) > 0 ? (
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      {(imagesByNoteId.get(editingNote.id) ?? []).map((image) => (
                        <div key={image.id} className="relative overflow-hidden border border-emerald-100 bg-white">
                          <img src={image.publicUrl} alt={image.label ?? 'Bild'} className="aspect-square w-full object-cover" />
                          <button
                            type="button"
                            onClick={() => void deleteImage(image)}
                            disabled={deletingImageId === image.id}
                            className="absolute right-1 top-1 inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-rose-700 shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                            aria-label="Radera bild"
                            title="Radera bild"
                          >
                            {deletingImageId === image.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </section>

                <section className="border-b border-emerald-100 pb-3">
                  <div className="mb-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">Bildbank</p>
                    <p className="text-sm font-semibold text-gray-950">{allImages.length} bilder i besiktningen</p>
                  </div>
                  {allImages.length === 0 ? (
                    <p className="rounded-md border border-emerald-100 bg-emerald-50/40 px-3 py-3 text-sm text-gray-600">
                      Inga bilder i denna besiktning.
                    </p>
                  ) : (
                    <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto pr-1">
                      {allImages.map((image) => {
                        const note = round.notes.find((item) => item.id === image.noteId) ?? null
                        const active = editingNote?.id === note?.id
                        return (
                          <button
                            key={image.id}
                            type="button"
                            onClick={() => {
                              if (note) handleEdit(note)
                            }}
                            className={
                              active
                                ? 'overflow-hidden border-2 border-emerald-600 bg-white text-left'
                                : 'overflow-hidden border border-emerald-100 bg-white text-left transition hover:border-emerald-300'
                            }
                          >
                            <img src={image.publicUrl} alt={image.label ?? 'Bild'} className="aspect-square w-full object-cover" />
                            <span className="block truncate px-1.5 py-1 text-[11px] font-semibold text-gray-700">
                              {note ? `${round.project.notePrefix} ${note.noteNumber}` : 'Bild'}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  )}
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
                  <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {error}
                  </div>
                ) : null}

                {editingNote ? (
                  <button
                    type="button"
                    onClick={() => void handleDelete(editingNote)}
                    disabled={deletingId === editingNote.id}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-rose-200 bg-white px-4 py-2.5 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {deletingId === editingNote.id ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                    Radera notering
                  </button>
                ) : null}

                <button
                  type="submit"
                  disabled={saving || round.disciplines.length === 0}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-emerald-300"
                >
                  {saving ? <Loader2 size={16} className="animate-spin" /> : editingNote ? <Save size={16} /> : <Plus size={16} />}
                  {saving ? 'Sparar...' : editingNote ? 'Spara ändring' : 'Skapa notering'}
                </button>
              </form>
            </aside>
          </div>
        ) : null}

        <StartDisciplineDialog
          open={startDialogOpen}
          disciplines={round.disciplines}
          onSelect={selectDiscipline}
        />
      </main>
    </Protected>
  )
}
