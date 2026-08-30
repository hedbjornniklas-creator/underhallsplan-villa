'use client'

import { useEffect, useRef, useState, type Ref } from 'react'
import {
  Camera,
  Image as ImageIcon,
  Images,
  Loader2,
  MapPin,
  Mic,
  Paperclip,
  Send,
  Square,
  X,
} from 'lucide-react'
import type { TuFieldCapturedAudio, TuFieldQueueController } from '@/hooks/useTuFieldQueue'

const MAX_IMAGE_FILES = 20
const MAX_IMAGE_BYTES = 15 * 1024 * 1024

type Props = {
  locked: boolean
  queue: TuFieldQueueController
  containerRef?: Ref<HTMLDivElement>
  composerId?: string
  onQueued?: () => void
}

function formatDuration(seconds: number) {
  const safeSeconds = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(safeSeconds / 60)
  const remainder = safeSeconds % 60
  return `${minutes}:${String(remainder).padStart(2, '0')}`
}

function fileValidation(files: File[]) {
  const imageFiles = files.filter((file) => file.type.startsWith('image/'))
  if (imageFiles.length !== files.length) return 'Endast bildfiler kan läggas till.'
  if (imageFiles.length > MAX_IMAGE_FILES) return `Välj högst ${MAX_IMAGE_FILES} bilder åt gången.`
  const tooLarge = imageFiles.find((file) => file.size > MAX_IMAGE_BYTES)
  if (tooLarge) return `${tooLarge.name} är större än 15 MB.`
  return null
}

export default function TuFieldEntryComposer({
  locked,
  queue,
  containerRef,
  composerId = 'tu-field-entry-composer',
  onQueued,
}: Props) {
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

  const noteRef = useRef<HTMLTextAreaElement>(null)
  const attachedCameraInputRef = useRef<HTMLInputElement>(null)
  const attachedGalleryInputRef = useRef<HTMLInputElement>(null)
  const looseCameraInputRef = useRef<HTMLInputElement>(null)
  const looseGalleryInputRef = useRef<HTMLInputElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const recordingStartedAtRef = useRef<number | null>(null)

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

  const addAttachedFiles = (files: File[]) => {
    const error = fileValidation(files)
    if (error) {
      setComposerError(error)
      return
    }
    setComposerError(null)
    setDraftFiles((current) => [...current, ...files].slice(0, MAX_IMAGE_FILES))
    window.requestAnimationFrame(() => noteRef.current?.focus({ preventScroll: true }))
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
      onQueued?.()
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : 'Kunde inte spara fältanteckningen.')
    } finally {
      setEnqueueing(false)
    }
  }

  return (
    <div ref={containerRef} id={composerId} className="rounded-lg border border-violet-200 bg-white shadow-sm scroll-mt-4">
      {notice ? (
        <div className="border-b border-violet-200 bg-violet-50 px-4 py-2 text-sm text-violet-950" aria-live="polite">
          {notice}
        </div>
      ) : null}
      {composerError ? (
        <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-800" role="alert">
          {composerError}
        </div>
      ) : null}

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
              Ta foto
            </button>
            <button
              type="button"
              onClick={() => looseCameraInputRef.current?.click()}
              disabled={locked}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-gray-300 bg-white px-3 text-sm font-semibold text-gray-800 shadow-sm hover:bg-gray-50 disabled:opacity-50"
            >
              <ImageIcon size={17} aria-hidden />
              Foto utan anteckning
            </button>
            <button
              type="button"
              onClick={() => looseGalleryInputRef.current?.click()}
              disabled={locked}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-gray-300 bg-white px-3 text-sm font-semibold text-gray-800 shadow-sm hover:bg-gray-50 disabled:opacity-50"
            >
              <Images size={17} aria-hidden />
              Välj bilder
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
              id={`${composerId}-note`}
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
              Lägg till i fältloggen
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
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-gray-950/90 p-3" role="dialog" aria-modal="true" aria-label="Bildförhandsvisning">
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
    </div>
  )
}
