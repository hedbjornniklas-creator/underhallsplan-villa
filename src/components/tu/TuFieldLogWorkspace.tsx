'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Camera,
  Check,
  ChevronRight,
  CircleAlert,
  FileText,
  Image as ImageIcon,
  Images,
  Loader2,
  MapPin,
  Mic,
  Paperclip,
  RefreshCw,
  Send,
  Square,
  X,
} from 'lucide-react'
import type { TuFieldQueueController, TuFieldCapturedAudio } from '@/hooks/useTuFieldQueue'
import type { TuObservation } from '@/lib/tu/evidence'
import type { TuFieldQueueItem } from '@/lib/tu/fieldQueue'

const MAX_IMAGE_FILES = 20
const MAX_IMAGE_BYTES = 15 * 1024 * 1024

type FieldImage = {
  id: string
  sectionKey: 'bank' | 'appendix' | 'cover'
  publicUrl: string
  caption: string | null
  createdAt: string | null
}

type ObservationResponse = {
  observations?: TuObservation[]
  error?: string
}

type Props = {
  inspectionId: string
  locked: boolean
  images: FieldImage[]
  queue: TuFieldQueueController
  onPreviewImage: (imageId: string) => void
  onOpenEvidence: () => void
}

type TimelineItem =
  | { kind: 'pending'; id: string; timestamp: string; item: TuFieldQueueItem }
  | { kind: 'observation'; id: string; timestamp: string; observation: TuObservation }
  | { kind: 'loose-image'; id: string; timestamp: string; image: FieldImage }

function formatTimestamp(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const today = new Date()
  const sameDate =
    date.getFullYear() === today.getFullYear()
    && date.getMonth() === today.getMonth()
    && date.getDate() === today.getDate()
  return new Intl.DateTimeFormat('sv-SE', {
    ...(sameDate ? {} : { month: 'short', day: 'numeric' }),
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function formatDuration(seconds: number) {
  const safeSeconds = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(safeSeconds / 60)
  const remainder = safeSeconds % 60
  return `${minutes}:${String(remainder).padStart(2, '0')}`
}

function queueStatus(item: TuFieldQueueItem) {
  if (item.status === 'failed') return 'Behöver nytt försök'
  if (item.activeStep === 'uploading') return 'Laddar upp bilder'
  if (item.activeStep === 'transcribing') return 'Transkriberar'
  if (item.activeStep === 'saving') return 'Sparar anteckning'
  return 'Väntar i bakgrunden'
}

function fileValidation(files: File[]) {
  const imageFiles = files.filter((file) => file.type.startsWith('image/'))
  if (imageFiles.length !== files.length) return 'Endast bildfiler kan läggas till.'
  if (imageFiles.length > MAX_IMAGE_FILES) return `Välj högst ${MAX_IMAGE_FILES} bilder åt gången.`
  const tooLarge = imageFiles.find((file) => file.size > MAX_IMAGE_BYTES)
  if (tooLarge) return `${tooLarge.name} är större än 15 MB.`
  return null
}

export default function TuFieldLogWorkspace({
  inspectionId,
  locked,
  images,
  queue,
  onPreviewImage,
  onOpenEvidence,
}: Props) {
  const [observations, setObservations] = useState<TuObservation[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [composerError, setComposerError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [noteText, setNoteText] = useState('')
  const [location, setLocation] = useState('')
  const [draftFiles, setDraftFiles] = useState<File[]>([])
  const [draftPreviewUrls, setDraftPreviewUrls] = useState<string[]>([])
  const [capturedAudio, setCapturedAudio] = useState<TuFieldCapturedAudio | null>(null)
  const [capturedAudioUrl, setCapturedAudioUrl] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null)
  const [enqueueing, setEnqueueing] = useState(false)

  const composerRef = useRef<HTMLDivElement>(null)
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const attachedCameraInputRef = useRef<HTMLInputElement>(null)
  const attachedGalleryInputRef = useRef<HTMLInputElement>(null)
  const looseCameraInputRef = useRef<HTMLInputElement>(null)
  const looseGalleryInputRef = useRef<HTMLInputElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const recordingStartedAtRef = useRef<number | null>(null)

  const loadObservations = useCallback(async () => {
    setLoadError(null)
    try {
      const response = await fetch(`/api/tu/investigations/${inspectionId}/observations`)
      const payload = (await response.json().catch(() => ({}))) as ObservationResponse
      if (!response.ok) throw new Error(payload.error ?? 'Kunde inte hämta fältloggen.')
      setObservations(payload.observations ?? [])
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Kunde inte hämta fältloggen.')
    } finally {
      setLoading(false)
    }
  }, [inspectionId])

  useEffect(() => {
    void loadObservations()
  }, [loadObservations, queue.completedRevision])

  useEffect(() => {
    const nextUrls = draftFiles.map((file) => URL.createObjectURL(file))
    setDraftPreviewUrls(nextUrls)
    return () => nextUrls.forEach((url) => URL.revokeObjectURL(url))
  }, [draftFiles])

  useEffect(() => {
    if (!capturedAudio) {
      setCapturedAudioUrl(null)
      return
    }
    const url = URL.createObjectURL(capturedAudio.blob)
    setCapturedAudioUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [capturedAudio])

  useEffect(() => {
    if (!recording) return
    const timer = window.setInterval(() => {
      const startedAt = recordingStartedAtRef.current
      if (startedAt) setRecordingSeconds(Math.max(0, Math.round((Date.now() - startedAt) / 1000)))
    }, 500)
    return () => window.clearInterval(timer)
  }, [recording])

  useEffect(
    () => () => {
      const recorder = mediaRecorderRef.current
      recorder?.stream.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
    },
    []
  )

  const serverImageById = useMemo(
    () => new Map(images.map((image) => [image.id, image])),
    [images]
  )
  const linkedImageIds = useMemo(
    () => new Set(observations.flatMap((observation) => observation.imageIds)),
    [observations]
  )
  const queuedServerImageIds = useMemo(
    () => new Set(queue.items.flatMap((item) => item.images.map((image) => image.serverImageId).filter(Boolean))),
    [queue.items]
  )

  const timeline = useMemo<TimelineItem[]>(() => {
    const pending: TimelineItem[] = queue.items.map((item) => ({
      kind: 'pending',
      id: `pending-${item.id}`,
      timestamp: item.observedAt,
      item,
    }))
    const saved: TimelineItem[] = observations.map((observation) => ({
      kind: 'observation',
      id: `observation-${observation.id}`,
      timestamp: observation.observedAt,
      observation,
    }))
    const loose: TimelineItem[] = images
      .filter(
        (image) =>
          image.sectionKey === 'bank'
          && !linkedImageIds.has(image.id)
          && !queuedServerImageIds.has(image.id)
      )
      .map((image) => ({
        kind: 'loose-image',
        id: `image-${image.id}`,
        timestamp: image.createdAt ?? '',
        image,
      }))
    return [...pending, ...saved, ...loose].sort(
      (left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime()
    )
  }, [images, linkedImageIds, observations, queue.items, queuedServerImageIds])

  const addAttachedFiles = (files: File[]) => {
    const error = fileValidation(files)
    if (error) {
      setComposerError(error)
      return
    }
    setComposerError(null)
    setDraftFiles((current) => [...current, ...files].slice(0, MAX_IMAGE_FILES))
    window.requestAnimationFrame(() => {
      composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      noteRef.current?.focus({ preventScroll: true })
    })
  }

  const enqueueLooseFiles = async (files: File[]) => {
    const error = fileValidation(files)
    if (error) {
      setComposerError(error)
      return
    }
    setComposerError(null)
    try {
      await queue.enqueueLooseImages(files)
      setNotice(`${files.length} lös bild${files.length === 1 ? '' : 'er'} sparad${files.length === 1 ? '' : 'e'} lokalt.`)
    } catch (enqueueError) {
      setComposerError(enqueueError instanceof Error ? enqueueError.message : 'Kunde inte köa bilderna.')
    }
  }

  const startRecording = async () => {
    if (locked || recording || capturedAudio) return
    setComposerError(null)
    setNotice(null)
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setComposerError('Röstinspelning stöds inte i den här webbläsaren.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const supportedTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
      const mimeType = supportedTypes.find((candidate) => MediaRecorder.isTypeSupported(candidate))
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      mediaStreamRef.current = stream
      mediaRecorderRef.current = recorder
      audioChunksRef.current = []
      recordingStartedAtRef.current = Date.now()
      setRecordingSeconds(0)

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data)
      }
      recorder.onstop = () => {
        const contentType = recorder.mimeType || audioChunksRef.current[0]?.type || 'audio/webm'
        const blob = new Blob(audioChunksRef.current, { type: contentType })
        const startedAt = recordingStartedAtRef.current
        const durationSeconds = startedAt ? Math.max(1, Math.round((Date.now() - startedAt) / 1000)) : 0
        stream.getTracks().forEach((track) => track.stop())
        mediaStreamRef.current = null
        mediaRecorderRef.current = null
        recordingStartedAtRef.current = null
        setRecording(false)
        if (blob.size > 0) setCapturedAudio({ blob, contentType, durationSeconds })
      }
      recorder.start(500)
      setRecording(true)
    } catch (error) {
      setComposerError(
        error instanceof Error && error.name === 'NotAllowedError'
          ? 'Tillåt mikrofonen för att spela in en röstanteckning.'
          : 'Kunde inte starta mikrofonen.'
      )
    }
  }

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state === 'inactive') return
    recorder.stop()
  }

  const submitEntry = async () => {
    if (recording || enqueueing) return
    setComposerError(null)
    setNotice(null)
    setEnqueueing(true)
    try {
      await queue.enqueueFieldEntry({
        noteText,
        location,
        files: draftFiles,
        audio: capturedAudio,
      })
      setNoteText('')
      setLocation('')
      setDraftFiles([])
      setCapturedAudio(null)
      setNotice('Fältanteckningen är sparad lokalt och bearbetas i bakgrunden.')
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : 'Kunde inte spara fältanteckningen.')
    } finally {
      setEnqueueing(false)
    }
  }

  const focusComposer = () => {
    composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    window.setTimeout(() => noteRef.current?.focus({ preventScroll: true }), 350)
  }

  const renderQueueStatus = () => {
    if (queue.counts.total === 0 && !queue.queueError) return null
    const hasFailure = queue.counts.failed > 0 || Boolean(queue.queueError)
    return (
      <div
        className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs ${
          hasFailure
            ? 'border-amber-200 bg-amber-50 text-amber-950'
            : 'border-violet-200 bg-violet-50 text-violet-950'
        }`}
        aria-live="polite"
      >
        <div className="flex items-center gap-2">
          {hasFailure ? <CircleAlert size={15} aria-hidden /> : <Loader2 size={15} className="animate-spin" aria-hidden />}
          <span>
            <strong>{queue.counts.total} lokalt sparad{queue.counts.total === 1 ? '' : 'e'} post{queue.counts.total === 1 ? '' : 'er'}.</strong>{' '}
            {queue.counts.uploading ? `${queue.counts.uploading} laddas upp. ` : ''}
            {queue.counts.transcribing ? `${queue.counts.transcribing} transkriberas. ` : ''}
            {queue.counts.saving ? `${queue.counts.saving} sparas. ` : ''}
            {queue.counts.waiting ? `${queue.counts.waiting} väntar. ` : ''}
            {queue.counts.failed ? `${queue.counts.failed} behöver nytt försök.` : ''}
            {queue.queueError ? ` ${queue.queueError}` : ''}
          </span>
        </div>
        {hasFailure ? (
          <button
            type="button"
            onClick={() => void queue.retryAll()}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-amber-300 bg-white px-2.5 font-semibold text-amber-950"
          >
            <RefreshCw size={13} aria-hidden />
            Försök igen
          </button>
        ) : null}
      </div>
    )
  }

  const renderPendingItem = (item: TuFieldQueueItem) => (
    <article className="rounded-lg border border-violet-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded bg-violet-100 px-2 py-1 text-[11px] font-semibold text-violet-900">
              {item.status === 'failed' ? <CircleAlert size={12} aria-hidden /> : <Loader2 size={12} className="animate-spin" aria-hidden />}
              {queueStatus(item)}
            </span>
            <span className="text-xs text-gray-500">{formatTimestamp(item.observedAt)}</span>
          </div>
          {item.location ? (
            <div className="mt-2 flex items-center gap-1 text-xs font-medium text-gray-600">
              <MapPin size={13} aria-hidden />
              {item.location}
            </div>
          ) : null}
          {item.noteText ? <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-900">{item.noteText}</p> : null}
          {item.audio ? (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-gray-600">
              <Mic size={13} aria-hidden />
              Röstanteckning {formatDuration(item.audio.durationSeconds)}
            </p>
          ) : null}
          {item.error ? <p className="mt-2 text-xs font-medium text-amber-800">{item.error}</p> : null}
        </div>
        {item.status === 'failed' ? (
          <button
            type="button"
            onClick={() => void queue.retryItem(item.id)}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-amber-300 px-2 text-xs font-semibold text-amber-900"
          >
            <RefreshCw size={12} aria-hidden />
            Försök igen
          </button>
        ) : null}
      </div>
      {item.images.length > 0 ? (
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {item.images.map((image) => {
            const src = queue.previewUrls[image.id]
            if (!src) return null
            return (
              <button
                key={image.id}
                type="button"
                onClick={() => setLocalPreviewUrl(src)}
                className="relative aspect-square overflow-hidden rounded-md bg-gray-100"
                aria-label="Visa lokal bild i full storlek"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="Lokalt sparad fältbild" className="h-full w-full object-cover" />
                <span className="absolute bottom-1 left-1 rounded bg-gray-950/75 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  {image.status === 'uploaded' ? 'Uppladdad' : image.status === 'failed' ? 'Fel' : 'Lokalt'}
                </span>
              </button>
            )
          })}
        </div>
      ) : null}
    </article>
  )

  const renderObservation = (observation: TuObservation) => {
    const linkedImages = observation.imageIds
      .map((id) => serverImageById.get(id))
      .filter((image): image is FieldImage => Boolean(image))
    const transcript = observation.transcriptText?.trim()
    const showTranscript = transcript && transcript !== observation.noteText.trim()
    return (
      <article className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded bg-gray-100 px-2 py-1 text-[11px] font-semibold text-gray-700">
            <Check size={12} aria-hidden />
            Sparad
          </span>
          <span className="text-xs text-gray-500">{formatTimestamp(observation.observedAt)}</span>
          <span className="text-xs text-gray-500">Obearbetad</span>
        </div>
        {observation.location ? (
          <div className="mt-2 flex items-center gap-1 text-xs font-medium text-gray-600">
            <MapPin size={13} aria-hidden />
            {observation.location}
          </div>
        ) : null}
        {observation.noteText.trim() ? (
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-900">{observation.noteText}</p>
        ) : null}
        {showTranscript ? (
          <div className="mt-2 border-l-2 border-violet-200 pl-3 text-sm leading-6 text-gray-700">
            <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase text-violet-800">
              <Mic size={12} aria-hidden />
              Transkribering
            </div>
            <p className="whitespace-pre-wrap">{transcript}</p>
          </div>
        ) : null}
        {linkedImages.length > 0 ? (
          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {linkedImages.map((image) => (
              <button
                key={image.id}
                type="button"
                onClick={() => onPreviewImage(image.id)}
                className="aspect-square overflow-hidden rounded-md bg-gray-100"
                aria-label="Visa kopplad bild i full storlek"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.publicUrl} alt={image.caption ?? 'Fältbild'} className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        ) : null}
      </article>
    )
  }

  return (
    <section className="space-y-4 pb-24 md:pb-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase text-violet-700">På plats</p>
          <h2 className="mt-1 text-xl font-semibold text-gray-950">Fältlogg</h2>
          <p className="mt-1 max-w-2xl text-sm text-gray-600">
            Spara det du ser och hör i den ordning det kommer. Struktureringen görs senare under Bearbeta underlag.
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenEvidence}
          className="inline-flex h-10 items-center gap-2 rounded-md border border-violet-200 bg-white px-3 text-sm font-semibold text-violet-800 shadow-sm hover:bg-violet-50"
        >
          <FileText size={16} aria-hidden />
          Bearbeta underlag
          <ChevronRight size={15} aria-hidden />
        </button>
      </div>

      {renderQueueStatus()}

      {notice ? (
        <div className="rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-950" aria-live="polite">
          {notice}
        </div>
      ) : null}
      {composerError ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800" role="alert">
          {composerError}
        </div>
      ) : null}

      <div ref={composerRef} className="rounded-lg border border-violet-200 bg-white shadow-sm scroll-mt-4">
        <div className="border-b border-gray-200 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase text-violet-700">Ny fältpost</p>
              <h3 className="mt-1 text-base font-semibold text-gray-950">Anteckning, röst och bilder hör ihop här</h3>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => attachedCameraInputRef.current?.click()}
                disabled={locked}
                className="inline-flex h-10 items-center gap-2 rounded-md border border-gray-300 bg-white px-3 text-sm font-semibold text-gray-800 shadow-sm hover:bg-gray-50 disabled:opacity-50"
              >
                <Camera size={17} aria-hidden />
                Bild med anteckning
              </button>
              <button
                type="button"
                onClick={() => looseCameraInputRef.current?.click()}
                disabled={locked}
                className="inline-flex h-10 items-center gap-2 rounded-md border border-gray-300 bg-white px-3 text-sm font-semibold text-gray-800 shadow-sm hover:bg-gray-50 disabled:opacity-50"
              >
                <ImageIcon size={17} aria-hidden />
                Lös bild
              </button>
              <button
                type="button"
                onClick={() => looseGalleryInputRef.current?.click()}
                disabled={locked}
                className="inline-flex h-10 items-center gap-2 rounded-md border border-gray-300 bg-white px-3 text-sm font-semibold text-gray-800 shadow-sm hover:bg-gray-50 disabled:opacity-50"
              >
                <Images size={17} aria-hidden />
                Välj lösa bilder
              </button>
            </div>
          </div>
        </div>

        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_250px]">
          <div className="space-y-4 p-4">
            <label className="block">
              <span className="mb-1.5 flex items-center gap-1 text-sm font-medium text-gray-700">
                <MapPin size={14} aria-hidden />
                Plats eller rum <span className="font-normal text-gray-400">(valfritt)</span>
              </span>
              <input
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                disabled={locked}
                placeholder="Exempel: Sovrum mot norr"
                className="h-11 w-full rounded-md border border-gray-300 px-3 text-base text-gray-950 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100 disabled:bg-gray-100"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-gray-700">Anteckning</span>
              <textarea
                ref={noteRef}
                value={noteText}
                onChange={(event) => setNoteText(event.target.value)}
                disabled={locked}
                rows={5}
                placeholder="Skriv fritt vad som observerades eller vad beställaren berättade."
                className="w-full resize-y rounded-md border border-gray-300 px-3 py-2.5 text-base leading-6 text-gray-950 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100 disabled:bg-gray-100"
              />
            </label>

            {draftFiles.length > 0 ? (
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-gray-700">
                    {draftFiles.length} kopplad bild{draftFiles.length === 1 ? '' : 'er'}
                  </span>
                  <button
                    type="button"
                    onClick={() => attachedGalleryInputRef.current?.click()}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-violet-800"
                  >
                    <Paperclip size={13} aria-hidden />
                    Lägg till fler
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {draftPreviewUrls.map((url, index) => (
                    <div key={url} className="relative aspect-square overflow-hidden rounded-md bg-gray-100">
                      <button
                        type="button"
                        onClick={() => setLocalPreviewUrl(url)}
                        className="h-full w-full"
                        aria-label="Visa vald bild i full storlek"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt="Vald fältbild" className="h-full w-full object-cover" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDraftFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}
                        className="absolute right-1 top-1 inline-flex h-7 w-7 items-center justify-center rounded-full bg-gray-950/75 text-white"
                        aria-label="Ta bort vald bild"
                      >
                        <X size={14} aria-hidden />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => attachedGalleryInputRef.current?.click()}
                disabled={locked}
                className="inline-flex h-10 items-center gap-2 rounded-md border border-dashed border-violet-300 px-3 text-sm font-semibold text-violet-800 hover:bg-violet-50 disabled:opacity-50"
              >
                <Images size={16} aria-hidden />
                Välj bilder från enheten
              </button>
            )}

            {capturedAudio ? (
              <div className="flex flex-wrap items-center gap-3 rounded-md border border-violet-200 bg-violet-50 p-3">
                <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-violet-700 text-white">
                  <Mic size={17} aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-violet-950">
                    Röstanteckning klar · {formatDuration(capturedAudio.durationSeconds)}
                  </div>
                  {capturedAudioUrl ? <audio controls src={capturedAudioUrl} className="mt-2 h-8 max-w-full" /> : null}
                </div>
                <button
                  type="button"
                  onClick={() => setCapturedAudio(null)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-violet-200 bg-white text-violet-800"
                  aria-label="Ta bort röstanteckning"
                >
                  <X size={15} aria-hidden />
                </button>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-4">
              <p className="max-w-md text-xs leading-5 text-gray-500">
                Posten sparas först på den här enheten. Du kan fortsätta direkt medan bilder laddas upp och rösten transkriberas.
              </p>
              <button
                type="button"
                onClick={() => void submitEntry()}
                disabled={locked || recording || enqueueing || (!noteText.trim() && draftFiles.length === 0 && !capturedAudio)}
                className="inline-flex h-11 items-center gap-2 rounded-md bg-violet-700 px-4 text-sm font-semibold text-white shadow-sm hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {enqueueing ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Send size={16} aria-hidden />}
                Spara i fältloggen
              </button>
            </div>
          </div>

          <div className="flex flex-col items-center justify-center border-t border-gray-200 bg-gray-50 p-5 lg:border-l lg:border-t-0">
            <button
              type="button"
              onClick={recording ? stopRecording : () => void startRecording()}
              disabled={locked || Boolean(capturedAudio)}
              className={`inline-flex h-24 w-24 items-center justify-center rounded-full text-white shadow-md transition ${
                recording
                  ? 'bg-rose-600 ring-8 ring-rose-100'
                  : 'bg-violet-700 hover:bg-violet-800 disabled:bg-gray-300'
              }`}
              aria-label={recording ? 'Stoppa röstinspelning' : 'Starta röstinspelning'}
            >
              {recording ? <Square size={30} fill="currentColor" aria-hidden /> : <Mic size={34} aria-hidden />}
            </button>
            <div className="mt-3 text-center">
              <div className="text-sm font-semibold text-gray-950">
                {recording ? `Spelar in ${formatDuration(recordingSeconds)}` : capturedAudio ? 'Inspelning klar' : 'Röstanteckning'}
              </div>
              <p className="mt-1 text-xs leading-5 text-gray-500">
                {recording ? 'Tryck igen för att stoppa.' : 'Transkriberas efter att posten sparats.'}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-gray-200 pb-2">
        <div>
          <h3 className="text-base font-semibold text-gray-950">Senaste från platsen</h3>
          <p className="mt-0.5 text-xs text-gray-500">
            {timeline.length} post{timeline.length === 1 ? '' : 'er'} inklusive lösa bilder
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadObservations()}
          className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-semibold text-gray-600 hover:bg-gray-100"
        >
          <RefreshCw size={13} aria-hidden />
          Uppdatera
        </button>
      </div>

      {loadError ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{loadError}</div>
      ) : null}
      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-gray-600">
          <Loader2 size={17} className="animate-spin" aria-hidden />
          Hämtar fältlogg...
        </div>
      ) : timeline.length === 0 ? (
        <div className="py-10 text-center">
          <Camera size={28} className="mx-auto text-violet-500" aria-hidden />
          <p className="mt-3 text-sm font-semibold text-gray-900">Fältloggen är tom</p>
          <p className="mt-1 text-sm text-gray-500">Börja med en röstanteckning, text eller bild.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {timeline.map((timelineItem) => {
            if (timelineItem.kind === 'pending') return <div key={timelineItem.id}>{renderPendingItem(timelineItem.item)}</div>
            if (timelineItem.kind === 'observation') return <div key={timelineItem.id}>{renderObservation(timelineItem.observation)}</div>
            return (
              <article key={timelineItem.id} className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1 rounded bg-gray-100 px-2 py-1 text-[11px] font-semibold text-gray-700">
                    <ImageIcon size={12} aria-hidden />
                    Lös bild
                  </span>
                  <span className="text-xs text-gray-500">{formatTimestamp(timelineItem.timestamp)}</span>
                </div>
                <button
                  type="button"
                  onClick={() => onPreviewImage(timelineItem.image.id)}
                  className="block max-w-sm overflow-hidden rounded-md bg-gray-100"
                  aria-label="Visa lös bild i full storlek"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={timelineItem.image.publicUrl}
                    alt={timelineItem.image.caption ?? 'Lös fältbild'}
                    className="max-h-72 w-full object-contain"
                  />
                </button>
                {timelineItem.image.caption ? (
                  <p className="mt-2 text-sm text-gray-700">{timelineItem.image.caption}</p>
                ) : null}
              </article>
            )
          })}
        </div>
      )}

      <div className="fixed inset-x-3 bottom-3 z-30 grid grid-cols-3 gap-1 rounded-lg border border-violet-200 bg-white p-1.5 shadow-lg md:hidden">
        <button
          type="button"
          onClick={focusComposer}
          disabled={locked}
          className="inline-flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-md px-1 text-[11px] font-semibold text-violet-900 hover:bg-violet-50 disabled:opacity-50"
        >
          <FileText size={18} aria-hidden />
          Anteckning
        </button>
        <button
          type="button"
          onClick={() => attachedCameraInputRef.current?.click()}
          disabled={locked}
          className="inline-flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-md bg-violet-700 px-1 text-[11px] font-semibold text-white disabled:bg-gray-300"
        >
          <Camera size={18} aria-hidden />
          Bild + text
        </button>
        <button
          type="button"
          onClick={() => looseCameraInputRef.current?.click()}
          disabled={locked}
          className="inline-flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-md px-1 text-[11px] font-semibold text-violet-900 hover:bg-violet-50 disabled:opacity-50"
        >
          <ImageIcon size={18} aria-hidden />
          Lös bild
        </button>
      </div>

      <input
        ref={attachedCameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(event) => {
          addAttachedFiles(Array.from(event.currentTarget.files ?? []))
          event.currentTarget.value = ''
        }}
      />
      <input
        ref={attachedGalleryInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          addAttachedFiles(Array.from(event.currentTarget.files ?? []))
          event.currentTarget.value = ''
        }}
      />
      <input
        ref={looseCameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(event) => {
          void enqueueLooseFiles(Array.from(event.currentTarget.files ?? []))
          event.currentTarget.value = ''
        }}
      />
      <input
        ref={looseGalleryInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          void enqueueLooseFiles(Array.from(event.currentTarget.files ?? []))
          event.currentTarget.value = ''
        }}
      />

      {localPreviewUrl ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-gray-950/90 p-3" role="dialog" aria-modal="true" aria-label="Bildförhandsvisning">
          <button
            type="button"
            onClick={() => setLocalPreviewUrl(null)}
            className="absolute right-3 top-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white text-gray-950 shadow"
            aria-label="Stäng bildförhandsvisning"
          >
            <X size={20} aria-hidden />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={localPreviewUrl} alt="Fältbild i full storlek" className="max-h-full max-w-full object-contain" />
        </div>
      ) : null}
    </section>
  )
}
