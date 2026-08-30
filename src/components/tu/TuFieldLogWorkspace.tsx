'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Camera,
  Check,
  ChevronRight,
  CircleAlert,
  Image as ImageIcon,
  Loader2,
  MapPin,
  Mic,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react'
import TuFieldEntryComposer from '@/components/tu/TuFieldEntryComposer'
import type { TuFieldQueueController } from '@/hooks/useTuFieldQueue'
import type { TuObservation } from '@/lib/tu/evidence'
import type { TuFieldQueueItem } from '@/lib/tu/fieldQueue'

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
  const [composerVisible, setComposerVisible] = useState(true)
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null)

  const composerRef = useRef<HTMLDivElement>(null)

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
    const composer = composerRef.current
    if (!composer || typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver(([entry]) => {
      setComposerVisible(entry.isIntersecting)
    })
    observer.observe(composer)
    return () => observer.disconnect()
  }, [])

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

  const focusComposer = () => {
    composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    window.setTimeout(() => document.getElementById('tu-field-entry-composer-note')?.focus({ preventScroll: true }), 350)
  }

  const renderQueueStatus = () => {
    if (queue.counts.total === 0 && !queue.queueError && queue.online) return null
    const hasFailure = queue.counts.failed > 0 || Boolean(queue.queueError)
    const offline = !queue.online
    return (
      <div
        className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs ${
          hasFailure || offline
            ? 'border-amber-200 bg-amber-50 text-amber-950'
            : 'border-violet-200 bg-violet-50 text-violet-950'
        }`}
        aria-live="polite"
      >
        <div className="flex items-center gap-2">
          {hasFailure || offline ? <CircleAlert size={15} aria-hidden /> : <Loader2 size={15} className="animate-spin" aria-hidden />}
          <span>
            {offline ? <strong>Offline. </strong> : null}
            {queue.counts.total > 0 ? <strong>{queue.counts.total} lokalt sparad{queue.counts.total === 1 ? '' : 'e'} post{queue.counts.total === 1 ? '' : 'er'}. </strong> : null}
            {queue.counts.uploading ? `${queue.counts.uploading} laddas upp. ` : ''}
            {queue.counts.transcribing ? `${queue.counts.transcribing} transkriberas. ` : ''}
            {queue.counts.saving ? `${queue.counts.saving} sparas. ` : ''}
            {queue.counts.waiting ? `${queue.counts.waiting} väntar. ` : ''}
            {queue.counts.failed ? `${queue.counts.failed} behöver nytt försök.` : ''}
            {queue.queueError ? ` ${queue.queueError}` : ''}
            {offline && queue.counts.total > 0 ? ' Synkningen fortsätter automatiskt när anslutningen är tillbaka.' : ''}
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
      <div>
        <p className="text-xs font-semibold uppercase text-violet-700">Steg 1</p>
        <h2 className="mt-1 text-xl font-semibold text-gray-950">Dokumentera på plats</h2>
        <p className="mt-1 max-w-2xl text-sm text-gray-600">
          Lägg in fakta i den ordning de kommer. Sorteringen görs när dokumentationen är klar.
        </p>
      </div>

      {renderQueueStatus()}

      <TuFieldEntryComposer
        locked={locked}
        queue={queue}
        containerRef={composerRef}
        composerId="tu-field-entry-composer"
      />

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
                    Osorterad bild
                  </span>
                  <span className="text-xs text-gray-500">{formatTimestamp(timelineItem.timestamp)}</span>
                </div>
                <button
                  type="button"
                  onClick={() => onPreviewImage(timelineItem.image.id)}
                  className="block max-w-sm overflow-hidden rounded-md bg-gray-100"
                  aria-label="Visa osorterad bild i full storlek"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={timelineItem.image.publicUrl}
                    alt={timelineItem.image.caption ?? 'Osorterad fältbild'}
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

      <div className="flex justify-end border-t border-gray-200 pt-4">
        <button
          type="button"
          onClick={onOpenEvidence}
          className="inline-flex h-10 items-center gap-2 rounded-md border border-violet-200 bg-white px-4 text-sm font-semibold text-violet-800 shadow-sm transition hover:bg-violet-50"
        >
          Sortera och granska
          <ChevronRight size={15} aria-hidden />
        </button>
      </div>

      {!composerVisible && !locked ? (
        <button
          type="button"
          onClick={focusComposer}
          className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-30 inline-flex h-12 items-center gap-2 rounded-md bg-violet-700 px-4 text-sm font-semibold text-white shadow-lg transition hover:bg-violet-800 md:hidden"
        >
          <Plus size={18} aria-hidden />
          Ny fältpost
        </button>
      ) : null}

      {localPreviewUrl ? (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-gray-950/90 p-3"
          role="dialog"
          aria-modal="true"
          aria-label="Bildförhandsvisning"
        >
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
