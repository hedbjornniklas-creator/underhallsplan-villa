'use client'

/* eslint-disable @next/next/no-img-element */

import Link from 'next/link'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
} from 'react'
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
import { useEbToast } from '@/components/eb/EbToastProvider'
import DebouncedTextarea from '@/components/ob/DebouncedTextarea'
import { useAutosaveQueue } from '@/hooks/useAutosaveQueue'
import { useEbNoteImageUploadQueue } from '@/hooks/useEbNoteImageUploadQueue'
import type { EbNoteImageUploadItem } from '@/lib/eb/noteImageUploadQueue'
import type { EbInspectionRound, EbNote, EbNoteImage, EbProjectAttachment } from '@/lib/eb/server'

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
  remediationAssigneeId: string
  remediationAssigneeName: string
  investigationResponsibleParty: string
  investigationResponsibleNote: string
  investigationCostParty: string
  investigationDueDate: string
  deductionAmount: string
}

type RoundResponse = {
  round?: EbInspectionRound
  error?: string
}

type NoteResponse = {
  note?: EbNote
  error?: string
}

type NoteSaveJob = {
  draftId: string
  disciplineId: string
  fingerprint: string
  form: NoteFormState
  commitRemediationAssignee?: boolean
}

type NoteSaveBatch = Record<string, NoteSaveJob>
type NoteSaveBatchResult = Record<string, EbNote>

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
const IMAGE_THUMBNAIL_MAX_EDGE = 420
const IMAGE_THUMBNAIL_JPEG_QUALITY = 0.68
const IMAGE_THUMBNAIL_REENCODE_THRESHOLD_BYTES = 120 * 1024
const IMAGE_UPLOAD_MAX_BATCH_FILES = 15
const IMAGE_UPLOAD_MAX_FILE_BYTES = 15 * 1024 * 1024

function createClientId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16)
    const value = character === 'x' ? random : (random & 0x3) | 0x8
    return value.toString(16)
  })
}

function noteFormFingerprint(form: NoteFormState, commitRemediationAssignee = false) {
  return JSON.stringify({ form, commitRemediationAssignee })
}

function noteSaveStorageKey(inspectionId: string) {
  return `eb-mobile-note-saves:${inspectionId}`
}

function readStoredNoteSaveJobs(inspectionId: string): NoteSaveBatch {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(noteSaveStorageKey(inspectionId))
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const jobs: NoteSaveBatch = {}
    for (const value of Object.values(parsed)) {
      const job = value as Partial<NoteSaveJob>
      if (
        typeof job.draftId === 'string' &&
        typeof job.disciplineId === 'string' &&
        typeof job.fingerprint === 'string' &&
        job.form &&
        typeof job.form.noteText === 'string'
      ) {
        jobs[job.draftId] = job as NoteSaveJob
      }
    }
    return jobs
  } catch {
    return {}
  }
}

function persistNoteSaveJob(inspectionId: string, job: NoteSaveJob) {
  if (typeof window === 'undefined') return
  try {
    const jobs = readStoredNoteSaveJobs(inspectionId)
    jobs[job.draftId] = job
    window.localStorage.setItem(noteSaveStorageKey(inspectionId), JSON.stringify(jobs))
  } catch {
    // Best-effort recovery storage; the live autosave request still proceeds.
  }
}

function removeStoredNoteSaveJob(inspectionId: string, draftId: string, fingerprint?: string) {
  if (typeof window === 'undefined') return
  try {
    const jobs = readStoredNoteSaveJobs(inspectionId)
    const current = jobs[draftId]
    if (!current || (fingerprint && current.fingerprint !== fingerprint)) return
    delete jobs[draftId]
    if (Object.keys(jobs).length === 0) {
      window.localStorage.removeItem(noteSaveStorageKey(inspectionId))
    } else {
      window.localStorage.setItem(noteSaveStorageKey(inspectionId), JSON.stringify(jobs))
    }
  } catch {
    // Best-effort cleanup.
  }
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
    remediationAssigneeId: '',
    remediationAssigneeName: '',
    investigationResponsibleParty: '',
    investigationResponsibleNote: '',
    investigationCostParty: '',
    investigationDueDate: '',
    deductionAmount: '',
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
    remediationAssigneeId: note.remediationAssigneeId ?? '',
    remediationAssigneeName: note.remediationAssigneeName ?? note.tradeGroup ?? note.responsibleParty ?? '',
    investigationResponsibleParty: note.investigationResponsibleParty ?? '',
    investigationResponsibleNote: note.investigationResponsibleNote ?? '',
    investigationCostParty: note.investigationCostParty ?? '',
    investigationDueDate: note.investigationDueDate ?? '',
    deductionAmount: note.deductionAmount ?? '',
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

function isImageFile(file: File) {
  return file.type.startsWith('image/') || /\.(avif|gif|heic|heif|jpe?g|png|webp)$/i.test(file.name)
}

function proxiedImageSrc(url: string | null | undefined, max = 420, quality = 68) {
  const trimmedUrl = url?.trim()
  if (!trimmedUrl) return null
  const params = new URLSearchParams({
    url: trimmedUrl,
    max: String(max),
    q: String(quality),
  })
  return `/api/image-proxy?${params.toString()}`
}

function projectAttachmentPreviewSrc(attachment: EbProjectAttachment) {
  return attachment.signedThumbnailUrl ?? proxiedImageSrc(attachment.signedUrl) ?? attachment.signedUrl
}

function projectAttachmentTitle(attachment: EbProjectAttachment) {
  return attachment.title || attachment.fileName || 'Entreprenadbild'
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

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality = IMAGE_UPLOAD_JPEG_QUALITY) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', quality)
  })
}

async function prepareImageForUpload(
  file: File,
  options: {
    maxEdge?: number
    quality?: number
    reencodeThresholdBytes?: number
  } = {}
) {
  const maxEdge = options.maxEdge ?? IMAGE_UPLOAD_MAX_EDGE
  const quality = options.quality ?? IMAGE_UPLOAD_JPEG_QUALITY
  const reencodeThresholdBytes = options.reencodeThresholdBytes ?? IMAGE_UPLOAD_REENCODE_THRESHOLD_BYTES
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

    const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight))
    const shouldResize = scale < 1
    const shouldReencode =
      file.size > reencodeThresholdBytes || contentType !== 'image/jpeg'
    if (!shouldResize && !shouldReencode) return file

    const targetWidth = Math.max(1, Math.round(sourceWidth * scale))
    const targetHeight = Math.max(1, Math.round(sourceHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = targetWidth
    canvas.height = targetHeight
    const context = canvas.getContext('2d')
    if (!context) return file

    context.drawImage(image, 0, 0, targetWidth, targetHeight)
    const blob = await canvasToJpegBlob(canvas, quality)
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

async function prepareImageFilesForUpload(file: File) {
  const uploadFile = await prepareImageForUpload(file)
  const thumbnailFile = await prepareImageForUpload(uploadFile, {
    maxEdge: IMAGE_THUMBNAIL_MAX_EDGE,
    quality: IMAGE_THUMBNAIL_JPEG_QUALITY,
    reencodeThresholdBytes: IMAGE_THUMBNAIL_REENCODE_THRESHOLD_BYTES,
  })

  return {
    uploadFile,
    thumbnailFile: thumbnailFile !== uploadFile ? thumbnailFile : null,
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
  const { showError } = useEbToast()
  const cameraInputRef = useRef<HTMLInputElement | null>(null)
  const galleryInputRef = useRef<HTMLInputElement | null>(null)
  const desktopGalleryInputRef = useRef<HTMLInputElement | null>(null)
  const noteHistoryOpenRef = useRef(false)
  const activeDraftIdRef = useRef<string | null>(null)
  const saveActiveDraftRef = useRef<() => void>(() => undefined)
  const ensureNoteReadyForImageRef = useRef<(noteId: string) => Promise<void>>(async () => undefined)
  const noteAutosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const serverNotesRef = useRef(new Map(initialRound.notes.map((note) => [note.id, note])))
  const lastQueuedFingerprintRef = useRef(new Map<string, string>())
  const noteSaveJobsRef = useRef(new Map<string, NoteSaveJob>())
  const noteSavePromisesRef = useRef(
    new Map<string, { fingerprint: string; promise: Promise<EbNote> }>()
  )
  const noteActionPendingRef = useRef(false)
  const initialDiscipline = initialRound.disciplines.find(
    (discipline) => discipline.id === initialDisciplineId
  )
  const [round, setRound] = useState(initialRound)
  const [activeDisciplineId, setActiveDisciplineId] = useState<string | null>(
    initialDiscipline?.id ?? initialRound.disciplines[0]?.id ?? null
  )
  const [noteSheetOpen, setNoteSheetOpen] = useState(false)
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null)
  const [editingNote, setEditingNote] = useState<EbNote | null>(null)
  const [form, setForm] = useState<NoteFormState>(() => createInitialForm(initialRound))
  const formRef = useRef(form)
  const [refreshing, setRefreshing] = useState(false)
  const [imageDragOver, setImageDragOver] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deletingImageId, setDeletingImageId] = useState<string | null>(null)
  const [noteActionPending, setNoteActionPending] = useState<'save-and-new' | 'save-and-close' | null>(null)
  const isLocked = Boolean(round.inspection.reportLockedAt)
  const lockedMessage = 'Utlåtandet är låst och kan inte ändras.'

  const handleQueuedImageUploaded = useCallback((image: EbNoteImage) => {
    setRound((current) => ({
      ...current,
      images: sortImages([...current.images.filter((item) => item.id !== image.id), image]),
    }))
  }, [])

  const imageUploadQueue = useEbNoteImageUploadQueue({
    projectId: round.project.id,
    inspectionId: round.inspection.inspectionId,
    enabled: Boolean(round.inspection.inspectionId),
    locked: isLocked,
    prepareFiles: prepareImageFilesForUpload,
    ensureNoteReady: (noteId) => ensureNoteReadyForImageRef.current(noteId),
    onUploaded: handleQueuedImageUploaded,
    onFailed: (message) => showError(message),
  })

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
  const showInvestigationFields = form.markerKey === 'S'
  const showDeductionFields = form.markerKey === 'N'
  const showReportFields = showInvestigationFields || showDeductionFields
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
  const projectImageAttachments = useMemo(
    () =>
      (round.projectAttachments ?? []).filter(
        (attachment) => attachment.attachmentType === 'image' && Boolean(attachment.signedUrl)
      ),
    [round.projectAttachments]
  )
  const linkedProjectAttachmentIds = useMemo(() => {
    const ids = new Set<string>()
    for (const image of round.images) {
      if (image.noteId && image.sourceAttachmentId) ids.add(image.sourceAttachmentId)
    }
    return ids
  }, [round.images])
  const queuedImagesByNoteId = useMemo(() => {
    const map = new Map<string, EbNoteImageUploadItem[]>()
    for (const item of imageUploadQueue.items) {
      map.set(item.noteId, [...(map.get(item.noteId) ?? []), item])
    }
    return map
  }, [imageUploadQueue.items])
  const queuedProjectAttachmentIds = useMemo(
    () =>
      new Set(
        imageUploadQueue.items
          .map((item) => item.sourceAttachmentId)
          .filter((id): id is string => Boolean(id))
      ),
    [imageUploadQueue.items]
  )
  const availableProjectImageAttachments = useMemo(
    () =>
      projectImageAttachments.filter(
        (attachment) =>
          !linkedProjectAttachmentIds.has(attachment.id) &&
          !queuedProjectAttachmentIds.has(attachment.id)
      ),
    [linkedProjectAttachmentIds, projectImageAttachments, queuedProjectAttachmentIds]
  )
  const activeQueuedImages = activeDraftId ? queuedImagesByNoteId.get(activeDraftId) ?? [] : []
  const activeSavedImages = activeDraftId ? imagesByNoteId.get(activeDraftId) ?? [] : []
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
      saveActiveDraftRef.current()
      noteHistoryOpenRef.current = false
      activeDraftIdRef.current = null
      setNoteSheetOpen(false)
      setActiveDraftId(null)
      setEditingNote(null)
      const nextForm = createInitialForm(round)
      formRef.current = nextForm
      setForm(nextForm)
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [round])

  const updateField = <K extends keyof NoteFormState>(field: K, value: NoteFormState[K]) => {
    setForm(() => {
      const current = formRef.current
      const next =
        field === 'markerKey'
          ? {
              ...current,
              [field]: value,
              investigationResponsibleParty:
                value === 'S' ? current.investigationResponsibleParty : '',
              investigationResponsibleNote:
                value === 'S' ? current.investigationResponsibleNote : '',
              investigationCostParty: value === 'S' ? current.investigationCostParty : '',
              investigationDueDate: value === 'S' ? current.investigationDueDate : '',
              deductionAmount: value === 'N' ? current.deductionAmount : '',
            }
          : { ...current, [field]: value }
      formRef.current = next
      return next
    })
  }

  const updateRemediationAssignee = (name: string) => {
    const normalized = name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('sv-SE')
    const match = round.remediationAssignees.find(
      (assignee) =>
        assignee.isActive &&
        assignee.name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('sv-SE') === normalized
    )
    setForm(() => {
      const next = {
        ...formRef.current,
        remediationAssigneeName: name,
        remediationAssigneeId: match?.id ?? '',
      }
      formRef.current = next
      return next
    })
  }

  const replaceForm = (nextForm: NoteFormState) => {
    formRef.current = nextForm
    setForm(nextForm)
  }

  const openNoteSheet = () => {
    if (!noteHistoryOpenRef.current) {
      window.history.pushState({ ebNoteSheet: true }, '', window.location.href)
      noteHistoryOpenRef.current = true
    }
    setNoteSheetOpen(true)
  }

  const openNewNote = () => {
    if (isLocked) {
      showError(lockedMessage)
      return
    }
    if (!activeDisciplineId) {
      showError('Fack saknas för rundan.')
      return
    }
    const draftId = createClientId()
    const nextForm = createInitialForm(round)
    activeDraftIdRef.current = draftId
    setActiveDraftId(draftId)
    setEditingNote(null)
    replaceForm(nextForm)
    openNoteSheet()
  }

  const handleEdit = (note: EbNote) => {
    const nextForm = formFromNote(note)
    activeDraftIdRef.current = note.id
    setActiveDraftId(note.id)
    serverNotesRef.current.set(note.id, note)
    lastQueuedFingerprintRef.current.set(note.id, noteFormFingerprint(nextForm))
    setEditingNote(note)
    setActiveDisciplineId(note.disciplineId)
    replaceForm(nextForm)
    openNoteSheet()
  }

  const closeNoteSheet = () => {
    saveActiveDraftRef.current()
    if (noteHistoryOpenRef.current) {
      noteHistoryOpenRef.current = false
      window.history.back()
    }
    activeDraftIdRef.current = null
    setNoteSheetOpen(false)
    setActiveDraftId(null)
    setEditingNote(null)
    replaceForm(createInitialForm(round))
  }

  const upsertNoteInState = useCallback((note: EbNote) => {
    setRound((current) => {
      const notes = sortNotes([...current.notes.filter((item) => item.id !== note.id), note])
      const phrase = note.noteText.trim()
      const hasSuggestion = current.suggestions.some(
        (suggestion) =>
          suggestion.phrase.toLocaleLowerCase('sv-SE') === phrase.toLocaleLowerCase('sv-SE')
      )
      const hasRemediationAssignee =
        !note.remediationAssigneeId ||
        current.remediationAssignees.some((assignee) => assignee.id === note.remediationAssigneeId)
      return {
        ...current,
        notes,
        remediationAssignees:
          hasRemediationAssignee || !note.remediationAssigneeId || !note.remediationAssigneeName
            ? current.remediationAssignees
            : [
                ...current.remediationAssignees,
                {
                  id: note.remediationAssigneeId,
                  name: note.remediationAssigneeName,
                  companyName: null,
                  contactName: null,
                  email: null,
                  phone: null,
                  isActive: true,
                },
              ].sort((left, right) => left.name.localeCompare(right.name, 'sv-SE')),
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
  }, [])

  const saveNoteBatch = useCallback(
    async (batch: NoteSaveBatch): Promise<NoteSaveBatchResult> => {
      const result: NoteSaveBatchResult = {}

      for (const job of Object.values(batch)) {
        const noteExists = serverNotesRef.current.has(job.draftId)
        const response = await fetch(
          noteExists ? `${notesBasePath}/${job.draftId}` : notesBasePath,
          {
            method: noteExists ? 'PATCH' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...job.form,
              disciplineId: job.disciplineId,
              remediationAssigneeCommit: job.commitRemediationAssignee === true,
              ...(noteExists ? {} : { clientNoteId: job.draftId }),
            }),
          }
        )
        const payload = (await response.json().catch(() => ({}))) as NoteResponse
        if (!response.ok || !payload.note) {
          throw new Error(payload.error ?? 'Kunde inte spara noteringen.')
        }

        serverNotesRef.current.set(payload.note.id, payload.note)
        if (noteSaveJobsRef.current.get(job.draftId)?.fingerprint === job.fingerprint) {
          noteSaveJobsRef.current.delete(job.draftId)
        }
        removeStoredNoteSaveJob(round.inspection.inspectionId, job.draftId, job.fingerprint)
        result[job.draftId] = payload.note
        upsertNoteInState(payload.note)
      }

      return result
    },
    [notesBasePath, round.inspection.inspectionId, upsertNoteInState]
  )

  const noteAutosave = useAutosaveQueue<NoteSaveBatch, NoteSaveBatchResult>({
    save: saveNoteBatch,
    mergePayload: (previous, next) => ({ ...previous, ...next }),
    onSaved: (savedNotes) => {
      for (const note of Object.values(savedNotes)) {
        if (activeDraftIdRef.current === note.id) {
          setEditingNote(note)
          if (
            note.remediationAssigneeId &&
            note.remediationAssigneeName &&
            formRef.current.remediationAssigneeName.trim().toLocaleLowerCase('sv-SE') ===
              note.remediationAssigneeName.trim().toLocaleLowerCase('sv-SE')
          ) {
            const nextForm = {
              ...formRef.current,
              remediationAssigneeId: note.remediationAssigneeId,
              remediationAssigneeName: note.remediationAssigneeName,
            }
            formRef.current = nextForm
            setForm(nextForm)
          }
        }
      }
    },
    onError: (saveError, failedBatch) => {
      for (const job of Object.values(failedBatch)) {
        if (lastQueuedFingerprintRef.current.get(job.draftId) === job.fingerprint) {
          lastQueuedFingerprintRef.current.delete(job.draftId)
        }
      }
      showError(saveError, 'Kunde inte autospara noteringen.')
    },
  })
  const { enqueue: enqueueNoteSave } = noteAutosave

  const queueNoteSnapshot = useCallback(
    (
      draftId: string,
      snapshot: NoteFormState,
      disciplineId: string,
      options?: { commitRemediationAssignee?: boolean }
    ): Promise<EbNote> => {
      if (isLocked) return Promise.reject(new Error(lockedMessage))
      if (!snapshot.noteText.trim()) {
        return Promise.reject(new Error('Skriv en noteringstext innan du sparar.'))
      }

      const commitRemediationAssignee = options?.commitRemediationAssignee === true
      const fingerprint = noteFormFingerprint(snapshot, commitRemediationAssignee)
      const pending = noteSavePromisesRef.current.get(draftId)
      if (pending?.fingerprint === fingerprint) return pending.promise

      const savedNote = serverNotesRef.current.get(draftId)
      if (savedNote && lastQueuedFingerprintRef.current.get(draftId) === fingerprint) {
        return Promise.resolve(savedNote)
      }

      const job: NoteSaveJob = {
        draftId,
        disciplineId,
        fingerprint,
        form: { ...snapshot },
        commitRemediationAssignee,
      }
      lastQueuedFingerprintRef.current.set(draftId, fingerprint)
      noteSaveJobsRef.current.set(draftId, job)
      persistNoteSaveJob(round.inspection.inspectionId, job)
      const promise = enqueueNoteSave({
          [draftId]: job,
        })
        .then((savedNotes) => {
          const note = savedNotes?.[draftId] ?? serverNotesRef.current.get(draftId)
          if (!note) throw new Error('Servern returnerade ingen sparad notering.')
          return note
        })

      noteSavePromisesRef.current.set(draftId, { fingerprint, promise })
      void promise.finally(() => {
        if (noteSavePromisesRef.current.get(draftId)?.promise === promise) {
          noteSavePromisesRef.current.delete(draftId)
        }
      }).catch(() => undefined)
      return promise
    },
    [enqueueNoteSave, isLocked, lockedMessage, round.inspection.inspectionId]
  )

  ensureNoteReadyForImageRef.current = async (noteId: string) => {
    if (serverNotesRef.current.has(noteId)) return
    const pending = noteSavePromisesRef.current.get(noteId)?.promise
    if (pending) {
      await pending
      return
    }
    const storedJob = noteSaveJobsRef.current.get(noteId) ?? readStoredNoteSaveJobs(round.inspection.inspectionId)[noteId]
    if (!storedJob) throw new Error('Noteringen måste sparas innan bilden kan laddas upp.')
    await queueNoteSnapshot(
      storedJob.draftId,
      storedJob.form,
      storedJob.disciplineId,
      { commitRemediationAssignee: storedJob.commitRemediationAssignee === true }
    )
  }

  useEffect(() => {
    if (isLocked) return
    const storedJobs = readStoredNoteSaveJobs(round.inspection.inspectionId)
    const pendingJobs = Object.values(storedJobs)
    if (pendingJobs.length === 0) return
    for (const job of pendingJobs) noteSaveJobsRef.current.set(job.draftId, job)
    void enqueueNoteSave(
      Object.fromEntries(pendingJobs.map((job) => [job.draftId, job]))
    ).catch(() => undefined)
  }, [enqueueNoteSave, isLocked, round.inspection.inspectionId])

  const retryStoredNoteSaves = () => {
    const storedJobs = readStoredNoteSaveJobs(round.inspection.inspectionId)
    const jobs = Object.values(storedJobs)
    if (jobs.length === 0) return
    noteAutosave.resetError()
    void enqueueNoteSave(Object.fromEntries(jobs.map((job) => [job.draftId, job]))).catch(
      () => undefined
    )
  }

  const saveCurrentNote = useCallback(() => {
    const draftId = activeDraftIdRef.current
    const disciplineId = editingNote?.disciplineId ?? activeDisciplineId
    if (!draftId) return Promise.reject(new Error('Noteringsutkast saknas.'))
    if (!disciplineId) return Promise.reject(new Error('Fack saknas för rundan.'))
    return queueNoteSnapshot(draftId, formRef.current, disciplineId, {
      commitRemediationAssignee: true,
    })
  }, [activeDisciplineId, editingNote?.disciplineId, queueNoteSnapshot])

  saveActiveDraftRef.current = () => {
    const draftId = activeDraftIdRef.current
    const disciplineId = editingNote?.disciplineId ?? activeDisciplineId
    const snapshot = formRef.current
    if (!draftId || !disciplineId || !snapshot.noteText.trim() || isLocked) return
    void queueNoteSnapshot(draftId, snapshot, disciplineId, {
      commitRemediationAssignee: true,
    }).catch(() => undefined)
  }

  useEffect(() => {
    if (noteAutosaveTimerRef.current) clearTimeout(noteAutosaveTimerRef.current)
    if (!noteSheetOpen || !activeDraftId || !activeDisciplineId || isLocked) return
    if (!form.noteText.trim()) return
    if (lastQueuedFingerprintRef.current.get(activeDraftId) === noteFormFingerprint(form)) return

    noteAutosaveTimerRef.current = setTimeout(() => {
      void queueNoteSnapshot(activeDraftId, form, activeDisciplineId).catch(() => undefined)
    }, 700)

    return () => {
      if (noteAutosaveTimerRef.current) clearTimeout(noteAutosaveTimerRef.current)
    }
  }, [activeDisciplineId, activeDraftId, form, isLocked, noteSheetOpen, queueNoteSnapshot])

  const handleImageSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ''
    await uploadSelectedImages(files)
  }

  const uploadSelectedImages = async (files: File[]) => {
    if (isLocked) {
      showError(lockedMessage)
      return
    }
    const imageFiles = files.filter(isImageFile)
    if (imageFiles.length === 0) {
      showError('Välj en eller flera bildfiler.')
      return
    }
    if (imageFiles.length > IMAGE_UPLOAD_MAX_BATCH_FILES) {
      showError(`Du kan lägga till högst ${IMAGE_UPLOAD_MAX_BATCH_FILES} bilder åt gången.`)
      return
    }
    const oversizedFile = imageFiles.find((file) => file.size > IMAGE_UPLOAD_MAX_FILE_BYTES)
    if (oversizedFile) {
      showError(`${oversizedFile.name} är större än 15 MB.`)
      return
    }

    try {
      const draftId = activeDraftIdRef.current
      const disciplineId = editingNote?.disciplineId ?? activeDisciplineId
      if (!draftId) throw new Error('Noteringsutkast saknas.')
      if (!disciplineId) throw new Error('Fack saknas för rundan.')
      if (!formRef.current.noteText.trim()) {
        throw new Error('Skriv en noteringstext innan du lägger till bilder.')
      }
      const noteSavePromise = queueNoteSnapshot(draftId, formRef.current, disciplineId)
      await imageUploadQueue.enqueueFiles(draftId, imageFiles)
      void noteSavePromise.catch(() => undefined)
    } catch (uploadError) {
      showError(uploadError, 'Kunde inte lägga bilderna i uppladdningskön.')
    }
  }

  const handleDesktopImagesSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ''
    await uploadSelectedImages(files)
  }

  const canDropImages = (event: DragEvent<HTMLElement>) =>
    !isLocked &&
    Array.from(event.dataTransfer.types).includes('Files') &&
    Array.from(event.dataTransfer.items).some((item) => item.kind === 'file')

  const handleImageDragOver = (event: DragEvent<HTMLElement>) => {
    if (!canDropImages(event)) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
    setImageDragOver(true)
  }

  const handleImageDragLeave = (event: DragEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    setImageDragOver(false)
  }

  const handleImageDrop = async (event: DragEvent<HTMLElement>) => {
    if (!canDropImages(event)) return
    event.preventDefault()
    event.stopPropagation()
    setImageDragOver(false)
    await uploadSelectedImages(Array.from(event.dataTransfer.files))
  }

  const copyProjectAttachmentToNote = async (attachment: EbProjectAttachment) => {
    if (isLocked) {
      showError(lockedMessage)
      return
    }
    try {
      const draftId = activeDraftIdRef.current
      const disciplineId = editingNote?.disciplineId ?? activeDisciplineId
      if (!draftId) throw new Error('Noteringsutkast saknas.')
      if (!disciplineId) throw new Error('Fack saknas för rundan.')
      if (!formRef.current.noteText.trim()) {
        throw new Error('Skriv en noteringstext innan du lägger till bilder.')
      }
      const noteSavePromise = queueNoteSnapshot(draftId, formRef.current, disciplineId)
      await imageUploadQueue.enqueueProjectAttachment(draftId, attachment)
      void noteSavePromise.catch(() => undefined)
    } catch (copyError) {
      showError(copyError, 'Kunde inte lägga entreprenadbilden i uppladdningskön.')
    }
  }

  const deleteImage = async (image: EbNoteImage) => {
    if (isLocked) {
      showError(lockedMessage)
      return
    }
    const noteId = image.noteId ?? activeDraftIdRef.current
    if (!noteId || deletingImageId) return
    const confirmed = window.confirm('Radera bilden?')
    if (!confirmed) return

    try {
      setDeletingImageId(image.id)
      const response = await fetch(`${notesBasePath}/${noteId}/images`, {
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
      showError(deleteError, 'Kunde inte radera bilden.')
    } finally {
      setDeletingImageId(null)
    }
  }

  const refreshRound = async () => {
    if (refreshing) return

    try {
      setRefreshing(true)
      const response = await fetch(roundPath)
      const payload = (await response.json().catch(() => ({}))) as RoundResponse
      if (!response.ok || !payload.round) {
        throw new Error(payload.error ?? 'Kunde inte uppdatera rundan.')
      }
      serverNotesRef.current = new Map(payload.round.notes.map((note) => [note.id, note]))
      setRound(payload.round)
    } catch (refreshError) {
      showError(refreshError, 'Kunde inte uppdatera rundan.')
    } finally {
      setRefreshing(false)
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isLocked) {
      showError(lockedMessage)
      return
    }
    if (!activeDisciplineId) return
    if (!formRef.current.noteText.trim()) {
      showError('Skriv en noteringstext innan du sparar.')
      return
    }

    if (noteActionPendingRef.current) return
    noteActionPendingRef.current = true
    setNoteActionPending('save-and-close')
    void saveCurrentNote()
      .catch((submitError) => {
        showError(submitError, 'Kunde inte spara noteringen.')
      })
      .finally(() => {
        noteActionPendingRef.current = false
        setNoteActionPending(null)
      })
    closeNoteSheet()
  }

  const handleSaveAndNew = () => {
    if (isLocked) {
      showError(lockedMessage)
      return
    }
    if (!activeDisciplineId) return
    if (!formRef.current.noteText.trim()) {
      showError('Skriv en noteringstext innan du sparar.')
      return
    }

    if (noteActionPendingRef.current) return
    noteActionPendingRef.current = true
    setNoteActionPending('save-and-new')
    void saveCurrentNote()
      .catch((submitError) => {
        showError(submitError, 'Kunde inte spara noteringen.')
      })
      .finally(() => {
        noteActionPendingRef.current = false
        setNoteActionPending(null)
      })
    const nextDraftId = createClientId()
    activeDraftIdRef.current = nextDraftId
    setActiveDraftId(nextDraftId)
    setEditingNote(null)
    replaceForm(createInitialForm(round))
    setNoteSheetOpen(true)
  }

  const handleDelete = async (note: EbNote) => {
    if (isLocked) {
      showError(lockedMessage)
      return
    }
    if (deletingId) return
    const queuedImages = queuedImagesByNoteId.get(note.id) ?? []
    if (queuedImages.some((item) => item.status === 'uploading')) {
      showError('Vänta tills pågående bilduppladdning är klar innan noteringen raderas.')
      return
    }
    const confirmed = window.confirm(`Radera ${round.project.notePrefix} ${note.noteNumber}?`)
    if (!confirmed) return

    try {
      setDeletingId(note.id)
      await Promise.all(queuedImages.map((item) => imageUploadQueue.discardItem(item.id)))
      const response = await fetch(`${notesBasePath}/${note.id}`, { method: 'DELETE' })
      const payload = (await response.json().catch(() => ({}))) as DeleteResponse
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? 'Kunde inte radera noteringen.')
      }
      setRound((current) => ({
        ...current,
        notes: current.notes.filter((item) => item.id !== note.id),
        images: current.images.map((image) =>
          image.noteId === note.id ? { ...image, noteId: null } : image
        ),
      }))
      serverNotesRef.current.delete(note.id)
      noteSaveJobsRef.current.delete(note.id)
      noteSavePromisesRef.current.delete(note.id)
      lastQueuedFingerprintRef.current.delete(note.id)
      removeStoredNoteSaveJob(round.inspection.inspectionId, note.id)
      if (editingNote?.id === note.id) {
        activeDraftIdRef.current = null
        closeNoteSheet()
      }
    } catch (deleteError) {
      showError(deleteError, 'Kunde inte radera noteringen.')
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
          {isLocked ? (
            <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
              Utlåtandet är låst och visas i läsläge.
            </div>
          ) : null}

          {noteAutosave.status === 'saving' ||
          noteAutosave.status === 'error' ||
          imageUploadQueue.counts.total > 0 ? (
            <div
              className={`mb-3 flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-xs font-semibold ${
                noteAutosave.status === 'error' || imageUploadQueue.counts.failed > 0
                  ? 'border-rose-200 bg-rose-50 text-rose-800'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-900'
              }`}
            >
              <span className="inline-flex items-center gap-2">
                {noteAutosave.status === 'saving' ||
                imageUploadQueue.counts.uploading > 0 ||
                imageUploadQueue.counts.waiting > 0 ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <ImageIcon size={14} />
                )}
                {noteAutosave.status === 'error'
                  ? 'En eller flera noteringar kunde inte sparas'
                  : imageUploadQueue.counts.failed > 0
                  ? `${imageUploadQueue.counts.failed} bildjobb misslyckades`
                  : noteAutosave.status === 'saving'
                    ? 'Noteringar sparas i bakgrunden'
                    : 'Bilder behandlas i bakgrunden'}
              </span>
              {noteAutosave.status === 'error' ? (
                <button
                  type="button"
                  onClick={retryStoredNoteSaves}
                  className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-white px-2 py-1"
                >
                  <RefreshCw size={12} />
                  Försök igen
                </button>
              ) : imageUploadQueue.counts.failed > 0 ? (
                <button
                  type="button"
                  onClick={() => void imageUploadQueue.retryAll()}
                  className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-white px-2 py-1"
                >
                  <RefreshCw size={12} />
                  Försök igen
                </button>
              ) : imageUploadQueue.counts.total > 0 ? (
                <span>
                  {imageUploadQueue.counts.uploading} laddas upp, {imageUploadQueue.counts.waiting} väntar
                </span>
              ) : null}
            </div>
          ) : null}

          <section className="grid grid-cols-[1fr_auto_auto] gap-2">
            <button
              type="button"
              onClick={openNewNote}
              disabled={isLocked}
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
                      {note.remediationAssigneeName ? (
                        <span>Åtgärdas av: {note.remediationAssigneeName}</span>
                      ) : null}
                    </div>
                  </button>
                  {(imagesByNoteId.get(note.id)?.length ?? 0) +
                    (queuedImagesByNoteId.get(note.id)?.length ?? 0) >
                  0 ? (
                    <div className="flex gap-2 overflow-x-auto border-t border-emerald-100 px-3 py-2">
                      {(queuedImagesByNoteId.get(note.id) ?? []).slice(0, 8).map((item) => {
                        const previewUrl = imageUploadQueue.previewUrls[item.id] ?? item.sourcePreviewUrl
                        return previewUrl ? (
                          <div key={item.id} className="relative h-14 w-14 shrink-0">
                            <img
                              src={previewUrl}
                              alt="Bild som väntar på uppladdning"
                              className="h-14 w-14 rounded-md border border-emerald-100 object-cover opacity-70"
                            />
                            <Loader2 className="absolute left-5 top-5 h-4 w-4 animate-spin text-white drop-shadow" />
                          </div>
                        ) : null
                      })}
                      {(imagesByNoteId.get(note.id) ?? [])
                        .slice(0, Math.max(0, 8 - (queuedImagesByNoteId.get(note.id)?.length ?? 0)))
                        .map((image) => (
                        <img
                          key={image.id}
                          src={image.thumbnailUrl ?? image.publicUrl}
                          alt={image.label ?? 'Bild'}
                          loading="lazy"
                          decoding="async"
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
              disabled={isLocked}
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
              <div className="flex items-center justify-between gap-3 border-b border-emerald-100 px-3 py-2.5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
                    {editingNote ? 'Redigera' : 'Ny notering'}
                  </p>
                  <h2 className="text-base font-semibold text-gray-950">
                    {getNoteLabel(round, editingNote, nextNoteNumber)}
                  </h2>
                </div>
                <div className="flex items-center gap-2">
                  {noteAutosave.status === 'saving' ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800">
                      <Loader2 size={13} className="animate-spin" />
                      Sparar
                    </span>
                  ) : noteAutosave.status === 'error' ? (
                    <span className="text-xs font-semibold text-rose-700">Ej sparad</span>
                  ) : null}
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
                    <DebouncedTextarea
                      key={activeDraftId ?? 'new-note'}
                      value={form.noteText}
                      draftKey={
                        activeDraftId
                          ? `eb-mobile-note:${round.inspection.inspectionId}:${activeDraftId}:text`
                          : undefined
                      }
                      debounceMs={700}
                      onValueChange={(value) => {
                        formRef.current = { ...formRef.current, noteText: value }
                      }}
                      onSave={async (value) => {
                        const nextForm = { ...formRef.current, noteText: value }
                        replaceForm(nextForm)
                        const draftId = activeDraftIdRef.current
                        const disciplineId = editingNote?.disciplineId ?? activeDisciplineId
                        if (!draftId || !disciplineId || !value.trim() || isLocked) return
                        await queueNoteSnapshot(draftId, nextForm, disciplineId)
                      }}
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

                  <section
                    onDragOver={handleImageDragOver}
                    onDragLeave={handleImageDragLeave}
                    onDrop={(event) => void handleImageDrop(event)}
                    className={`rounded-md border p-2.5 transition ${
                      imageDragOver
                        ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-100'
                        : 'border-emerald-100 bg-emerald-50/25'
                    }`}
                  >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
                            Bilder
                          </p>
                          <p className="text-sm font-semibold text-gray-950">
                            {activeSavedImages.length + activeQueuedImages.length} st
                          </p>
                        </div>
                        <div className="flex items-center gap-2 md:hidden">
                          <button
                            type="button"
                            onClick={() => cameraInputRef.current?.click()}
                            disabled={isLocked}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-emerald-700 text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-emerald-300"
                            aria-label="Kamera"
                            title="Kamera"
                          >
                            <Camera size={18} />
                          </button>
                          <button
                            type="button"
                            onClick={() => galleryInputRef.current?.click()}
                            disabled={isLocked}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-emerald-200 bg-white text-emerald-800 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                            aria-label="Bild"
                            title="Bild"
                          >
                            <ImageIcon size={18} />
                          </button>
                        </div>
                        <div className="hidden items-center gap-2 md:flex">
                          <button
                            type="button"
                            onClick={() => desktopGalleryInputRef.current?.click()}
                            disabled={isLocked}
                            className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-emerald-200 bg-white px-3 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <ImageIcon size={16} />
                            Välj bilder
                          </button>
                        </div>
                      </div>

                      <div
                        className={`mt-3 hidden rounded-md border border-dashed px-4 py-6 text-center transition md:block ${
                          imageDragOver
                            ? 'border-emerald-500 bg-white text-emerald-900'
                            : 'border-emerald-200 bg-white/75 text-gray-600'
                        }`}
                      >
                        <p className="text-sm font-semibold">
                          {imageDragOver ? 'Släpp bilder här' : 'Dra och släpp bilder här'}
                        </p>
                        <p className="mt-1 text-xs">
                          Upp till 15 bilder åt gången. Max 15 MB per bild. Om noteringen är ny sparas den först.
                        </p>
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
                        multiple
                        onChange={(event) => void handleImageSelected(event)}
                        className="hidden"
                      />
                      <input
                        ref={desktopGalleryInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={(event) => void handleDesktopImagesSelected(event)}
                        className="hidden"
                      />
                      {imageUploadQueue.counts.total > 0 || imageUploadQueue.queueError ? (
                        <div
                          className={`mt-2 flex items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-xs font-semibold ${
                            imageUploadQueue.counts.failed > 0 || imageUploadQueue.queueError
                              ? 'border-rose-200 bg-rose-50 text-rose-800'
                              : 'border-emerald-200 bg-white text-emerald-900'
                          }`}
                        >
                          <span className="inline-flex items-center gap-1.5">
                            {imageUploadQueue.counts.uploading > 0 ? (
                              <Loader2 size={13} className="animate-spin" />
                            ) : (
                              <ImageIcon size={13} />
                            )}
                            {imageUploadQueue.queueError ??
                              `${imageUploadQueue.counts.uploading} laddas upp, ${imageUploadQueue.counts.waiting} väntar`}
                          </span>
                          {imageUploadQueue.counts.failed > 0 ? (
                            <button
                              type="button"
                              onClick={() => void imageUploadQueue.retryAll()}
                              className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-white px-2 py-1 text-rose-800"
                            >
                              <RefreshCw size={12} />
                              Försök igen
                            </button>
                          ) : null}
                        </div>
                      ) : null}

                      <div className="mt-3 hidden md:block">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700">
                              Bildbank
                            </p>
                            <p className="text-xs text-gray-600">
                              Bilder uppladdade på entreprenaden. Lägg till en bild åt gången till noteringen.
                            </p>
                          </div>
                          <span className="text-xs font-medium text-gray-500">{availableProjectImageAttachments.length} st</span>
                        </div>
                        {availableProjectImageAttachments.length === 0 ? (
                          <p className="rounded-md border border-dashed border-emerald-200 bg-white/75 px-3 py-5 text-center text-sm text-gray-600">
                            Det finns inga okopplade bilder i bildbanken.
                          </p>
                        ) : (
                          <div className="grid grid-cols-4 gap-2">
                            {availableProjectImageAttachments.map((attachment) => {
                              const title = projectAttachmentTitle(attachment)
                              const imageUrl = projectAttachmentPreviewSrc(attachment)

                              return (
                                <button
                                  key={attachment.id}
                                  type="button"
                                  onClick={() => void copyProjectAttachmentToNote(attachment)}
                                  disabled={isLocked}
                                  className="relative overflow-hidden rounded-md border border-emerald-100 bg-white text-left transition hover:border-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
                                  title={title}
                                >
                                  {imageUrl ? (
                                    <img
                                      src={imageUrl}
                                      alt={title}
                                      loading="lazy"
                                      decoding="async"
                                      className="aspect-square w-full object-cover"
                                    />
                                  ) : (
                                    <div className="flex aspect-square w-full items-center justify-center bg-emerald-50 text-emerald-700">
                                      <ImageIcon size={18} aria-hidden="true" />
                                    </div>
                                  )}
                                  <span className="block truncate px-1.5 py-1 text-[11px] font-semibold text-emerald-800">
                                    Lägg till
                                  </span>
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </div>

                      {activeSavedImages.length + activeQueuedImages.length > 0 ? (
                        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                          {activeQueuedImages.map((item) => {
                            const previewUrl =
                              imageUploadQueue.previewUrls[item.id] ?? item.sourcePreviewUrl
                            return (
                              <div
                                key={item.id}
                                className="relative overflow-hidden rounded-md border border-emerald-100 bg-white"
                              >
                                {previewUrl ? (
                                  <img
                                    src={previewUrl}
                                    alt="Bild som väntar på uppladdning"
                                    className="aspect-square w-full object-cover opacity-70"
                                  />
                                ) : (
                                  <div className="flex aspect-square items-center justify-center bg-emerald-50 text-emerald-700">
                                    <ImageIcon size={18} />
                                  </div>
                                )}
                                {item.status === 'failed' ? (
                                  <button
                                    type="button"
                                    onClick={() => void imageUploadQueue.retryItem(item.id)}
                                    className="absolute inset-0 flex items-center justify-center bg-rose-950/45 text-white"
                                    aria-label="Försök ladda upp bilden igen"
                                    title={item.error ?? 'Försök igen'}
                                  >
                                    <RefreshCw size={18} />
                                  </button>
                                ) : (
                                  <Loader2 className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 animate-spin text-white drop-shadow" />
                                )}
                                <button
                                  type="button"
                                  onClick={() => void imageUploadQueue.discardItem(item.id)}
                                  disabled={item.status === 'uploading'}
                                  className="absolute right-1 top-1 inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-rose-700 shadow-sm disabled:opacity-50"
                                  aria-label="Ta bort bilden ur kön"
                                  title="Ta bort"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            )
                          })}
                          {activeSavedImages.map((image) => (
                            <div key={image.id} className="relative overflow-hidden rounded-md border border-emerald-100 bg-white">
                              <img
                                src={image.thumbnailUrl ?? image.publicUrl}
                                alt={image.label ?? 'Bild'}
                                loading="lazy"
                                decoding="async"
                                className="aspect-square w-full object-cover"
                              />
                              <button
                                type="button"
                                onClick={() => void deleteImage(image)}
                                disabled={isLocked || Boolean(deletingImageId)}
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

                  <label className="block">
                    <span className="block text-xs font-semibold text-gray-700">Åtgärdas av</span>
                    <input
                      value={form.remediationAssigneeName}
                      onChange={(event) => updateRemediationAssignee(event.target.value)}
                      onBlur={() => {
                        if (
                          !isLocked &&
                          formRef.current.noteText.trim() &&
                          formRef.current.remediationAssigneeName.trim() &&
                          !formRef.current.remediationAssigneeId
                        ) {
                          void saveCurrentNote().catch((error) =>
                            showError(error, 'Kunde inte spara Åtgärdas av.')
                          )
                        }
                      }}
                      list="eb-remediation-assignees-mobile"
                      placeholder="Välj befintlig eller skriv en ny"
                      autoComplete="off"
                      className={`${inputClassName()} mt-1`}
                    />
                    <datalist id="eb-remediation-assignees-mobile">
                      {round.remediationAssignees
                        .filter((assignee) => assignee.isActive)
                        .map((assignee) => (
                          <option key={assignee.id} value={assignee.name} />
                        ))}
                    </datalist>
                    <span className="mt-1 block text-xs text-gray-500">
                      Ett nytt namn läggs till när noteringen sparas.
                    </span>
                  </label>

                  {showReportFields ? (
                  <section className="rounded-md border border-emerald-100 bg-emerald-50/25 p-2.5">
                    <div className="mb-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">Utlåtandeuppgifter</p>
                      <p className="text-xs text-gray-600">
                        {showDeductionFields ? 'Nedsättning.' : 'Särskild utredning.'}
                      </p>
                    </div>
                    {showInvestigationFields ? (
                      <>
                        <div className="grid grid-cols-2 gap-3">
                          <label className="block">
                            <span className="block text-xs font-semibold text-gray-700">Utredning ansvarig</span>
                            <select
                              value={form.investigationResponsibleParty}
                              onChange={(event) => updateField('investigationResponsibleParty', event.target.value)}
                              className={`${inputClassName()} mt-1`}
                            >
                              <option value="">Ej vald</option>
                              <option value="contractor">Entreprenör</option>
                              <option value="client">Beställare</option>
                              <option value="other">Annat</option>
                            </select>
                          </label>
                          <label className="block">
                            <span className="block text-xs font-semibold text-gray-700">Kostnadsansvar</span>
                            <select
                              value={form.investigationCostParty}
                              onChange={(event) => updateField('investigationCostParty', event.target.value)}
                              className={`${inputClassName()} mt-1`}
                            >
                              <option value="">Ej vald</option>
                              <option value="contractor">Entreprenör</option>
                              <option value="client">Beställare</option>
                            </select>
                          </label>
                        </div>
                        <label className="mt-3 block">
                          <span className="block text-xs font-semibold text-gray-700">Klar senast</span>
                          <input
                            type="date"
                            value={form.investigationDueDate}
                            onChange={(event) => updateField('investigationDueDate', event.target.value)}
                            className={`${inputClassName()} mt-1`}
                          />
                        </label>
                        <label className="mt-3 block">
                          <span className="block text-xs font-semibold text-gray-700">Ansvarig/kommentar</span>
                          <input
                            value={form.investigationResponsibleNote}
                            onChange={(event) => updateField('investigationResponsibleNote', event.target.value)}
                            className={`${inputClassName()} mt-1`}
                          />
                        </label>
                      </>
                    ) : null}
                    {showDeductionFields ? (
                      <label className="block">
                        <span className="block text-xs font-semibold text-gray-700">
                          Uppskattad nedsättning, kronor
                        </span>
                        <input
                          value={form.deductionAmount}
                          onChange={(event) => updateField('deductionAmount', event.target.value)}
                          placeholder="Belopp"
                          className={`${inputClassName()} mt-1`}
                        />
                      </label>
                    ) : null}
                  </section>
                  ) : null}

                </div>

                <div className="border-t border-emerald-100 bg-white p-2">
                  <div className="flex gap-2">
                    {editingNote ? (
                      <button
                        type="button"
                        onClick={() => void handleDelete(editingNote)}
                        disabled={isLocked || deletingId === editingNote.id}
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
                      onClick={handleSaveAndNew}
                      disabled={isLocked || !activeDisciplineId || Boolean(noteActionPending)}
                      className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md border border-emerald-200 bg-white px-3 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {noteActionPending === 'save-and-new' ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                      {noteActionPending === 'save-and-new' ? 'Sparar...' : 'Spara och ny'}
                    </button>
                    <button
                      type="submit"
                      disabled={isLocked || !activeDisciplineId || Boolean(noteActionPending)}
                      className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-emerald-300"
                    >
                      {noteActionPending === 'save-and-close' ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                      {noteActionPending === 'save-and-close' ? 'Sparar...' : 'Spara och stäng'}
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
