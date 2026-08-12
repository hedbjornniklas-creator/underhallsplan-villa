'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import type { TuObservation } from '@/lib/tu/evidence'
import {
  deleteTuFieldQueueItem,
  getTuFieldQueueItem,
  listTuFieldQueueItems,
  putTuFieldQueueItem,
  type TuFieldQueueItem,
  type TuFieldQueuedAudio,
  type TuFieldQueuedImage,
} from '@/lib/tu/fieldQueue'

const MAX_CONCURRENT_ITEMS = 2

export type TuFieldServerImage = {
  id: string
  inspectionId: string
  orgId: string
  sectionKey: 'bank' | 'appendix' | 'cover'
  storageBucket: string
  filePath: string
  publicUrl: string
  caption: string | null
  sortOrder: number
  uploadedBy: string | null
  createdAt: string | null
  updatedAt: string | null
}

type ImageApiResponse = {
  image?: TuFieldServerImage
  images?: TuFieldServerImage[]
  upload?: {
    bucket: string
    filePath: string
    token: string
    publicUrl: string
  }
  error?: string
}

type TranscriptionApiResponse = {
  transcript?: string
  audio?: {
    storageBucket?: string
    storagePath?: string
    contentType?: string
    durationSeconds?: number | null
  }
  error?: string
}

type ObservationApiResponse = {
  observation?: TuObservation
  error?: string
}

export type TuFieldCapturedAudio = {
  blob: Blob
  contentType: string
  durationSeconds: number
}

type EnqueueFieldEntryInput = {
  noteText: string
  location?: string | null
  files?: File[]
  audio?: TuFieldCapturedAudio | null
}

type UseTuFieldQueueOptions = {
  inspectionId: string
  enabled: boolean
  locked: boolean
  onImageUploaded: (image: TuFieldServerImage) => void
  onObservationSaved?: (observation: TuObservation) => void
}

function createId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

async function apiError(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => ({}))) as { error?: unknown }
  return typeof payload.error === 'string' && payload.error.trim() ? payload.error : fallback
}

function queuedImage(file: File): TuFieldQueuedImage {
  return {
    id: createId(),
    blob: file,
    originalName: file.name || `faltbild-${Date.now()}.jpg`,
    contentType: file.type || 'image/jpeg',
    fileSize: file.size,
    filePath: null,
    serverImageId: null,
    publicUrl: null,
    status: 'queued',
    error: null,
  }
}

function queuedAudio(audio: TuFieldCapturedAudio): TuFieldQueuedAudio {
  return {
    blob: audio.blob,
    contentType: audio.contentType || audio.blob.type || 'audio/webm',
    durationSeconds: Math.max(0, Math.round(audio.durationSeconds)),
    transcriptText: null,
    storageBucket: null,
    storagePath: null,
    status: 'queued',
    error: null,
  }
}

function resetFailedParts(item: TuFieldQueueItem): TuFieldQueueItem {
  return {
    ...item,
    status: 'queued',
    activeStep: null,
    error: null,
    images: item.images.map((image) => ({
      ...image,
      status: image.serverImageId ? 'uploaded' : 'queued',
      error: null,
    })),
    audio: item.audio
      ? {
          ...item.audio,
          status: item.audio.transcriptText ? 'transcribed' : 'queued',
          error: null,
        }
      : null,
  }
}

export function useTuFieldQueue({
  inspectionId,
  enabled,
  locked,
  onImageUploaded,
  onObservationSaved,
}: UseTuFieldQueueOptions) {
  const [items, setItems] = useState<TuFieldQueueItem[]>([])
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({})
  const [queueError, setQueueError] = useState<string | null>(null)
  const [completedRevision, setCompletedRevision] = useState(0)
  const processorRunningRef = useRef(false)
  const mountedRef = useRef(true)
  const previewUrlsRef = useRef<Record<string, string>>({})

  const syncItems = useCallback(async () => {
    if (!enabled) return []
    const nextItems = await listTuFieldQueueItems(inspectionId)
    if (mountedRef.current) setItems(nextItems)
    return nextItems
  }, [enabled, inspectionId])

  const replaceItemInState = useCallback((item: TuFieldQueueItem) => {
    if (!mountedRef.current) return
    setItems((current) => {
      const exists = current.some((row) => row.id === item.id)
      const next = exists
        ? current.map((row) => (row.id === item.id ? item : row))
        : [...current, item]
      return next.sort(
        (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
      )
    })
  }, [])

  const removeItemFromState = useCallback((id: string) => {
    if (!mountedRef.current) return
    setItems((current) => current.filter((item) => item.id !== id))
  }, [])

  const persistItem = useCallback(
    async (item: TuFieldQueueItem) => {
      const next = { ...item, updatedAt: new Date().toISOString() }
      await putTuFieldQueueItem(next)
      replaceItemInState(next)
      return next
    },
    [replaceItemInState]
  )

  const uploadImage = useCallback(
    async (queueItem: TuFieldQueueItem, imageIndex: number) => {
      let workingItem = queueItem
      let image = workingItem.images[imageIndex]
      if (!image || image.serverImageId) return workingItem

      const nextImages = [...workingItem.images]
      nextImages[imageIndex] = { ...image, status: 'uploading', error: null }
      workingItem = await persistItem({
        ...workingItem,
        activeStep: 'uploading',
        images: nextImages,
      })
      image = workingItem.images[imageIndex]

      const signedResponse = await fetch(`/api/tu/investigations/${inspectionId}/images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'createSignedUpload',
          sectionKey: 'bank',
          fileName: image.originalName,
          contentType: image.contentType,
          fileSize: image.fileSize,
          filePath: image.filePath,
        }),
      })
      if (!signedResponse.ok) {
        throw new Error(await apiError(signedResponse, 'Kunde inte skapa uppladdningslänk.'))
      }
      const signedPayload = (await signedResponse.json().catch(() => ({}))) as ImageApiResponse
      const upload = signedPayload.upload
      if (!upload?.bucket || !upload.filePath || !upload.token) {
        throw new Error('Servern saknade uppladdningsuppgifter för bilden.')
      }

      const imagesWithPath = [...workingItem.images]
      imagesWithPath[imageIndex] = {
        ...imagesWithPath[imageIndex],
        filePath: upload.filePath,
      }
      workingItem = await persistItem({ ...workingItem, images: imagesWithPath })
      image = workingItem.images[imageIndex]

      const uploadFile = new File([image.blob], image.originalName, { type: image.contentType })
      const { error: storageError } = await supabase.storage
        .from(upload.bucket)
        .uploadToSignedUrl(upload.filePath, upload.token, uploadFile, {
          contentType: image.contentType || undefined,
        })
      if (storageError) throw new Error(storageError.message || 'Kunde inte ladda upp bilden.')

      const completeResponse = await fetch(`/api/tu/investigations/${inspectionId}/images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'completeSignedUpload',
          sectionKey: 'bank',
          filePath: upload.filePath,
        }),
      })
      if (!completeResponse.ok) {
        throw new Error(await apiError(completeResponse, 'Bilden laddades upp men kunde inte registreras.'))
      }
      const completePayload = (await completeResponse.json().catch(() => ({}))) as ImageApiResponse
      const serverImage = completePayload.image ?? completePayload.images?.[0]
      if (!serverImage?.id) throw new Error('Servern returnerade ingen sparad bild.')

      const uploadedImages = [...workingItem.images]
      uploadedImages[imageIndex] = {
        ...uploadedImages[imageIndex],
        filePath: serverImage.filePath,
        serverImageId: serverImage.id,
        publicUrl: serverImage.publicUrl,
        status: 'uploaded',
        error: null,
      }
      workingItem = await persistItem({ ...workingItem, images: uploadedImages })
      onImageUploaded(serverImage)
      return workingItem
    },
    [inspectionId, onImageUploaded, persistItem]
  )

  const transcribeAudio = useCallback(
    async (queueItem: TuFieldQueueItem) => {
      if (!queueItem.audio || queueItem.audio.transcriptText) return queueItem

      let workingItem = await persistItem({
        ...queueItem,
        activeStep: 'transcribing',
        audio: { ...queueItem.audio, status: 'transcribing', error: null },
      })
      const audio = workingItem.audio
      if (!audio) return workingItem

      const extension = audio.contentType.includes('mp4') ? 'm4a' : 'webm'
      const formData = new FormData()
      formData.append(
        'audio',
        new File([audio.blob], `rostanteckning.${extension}`, { type: audio.contentType })
      )
      formData.append('durationSeconds', String(audio.durationSeconds))
      formData.append('clientAudioId', workingItem.id)

      const response = await fetch(
        `/api/tu/investigations/${inspectionId}/observations/transcribe`,
        { method: 'POST', body: formData }
      )
      const payload = (await response.json().catch(() => ({}))) as TranscriptionApiResponse
      if (!response.ok) throw new Error(payload.error ?? 'Kunde inte transkribera röstanteckningen.')
      const transcriptText = payload.transcript?.trim()
      if (!transcriptText || !payload.audio?.storageBucket || !payload.audio.storagePath) {
        throw new Error('Transkriberingen saknade text eller ljudreferens.')
      }

      workingItem = await persistItem({
        ...workingItem,
        audio: {
          ...audio,
          transcriptText,
          storageBucket: payload.audio.storageBucket,
          storagePath: payload.audio.storagePath,
          contentType: payload.audio.contentType || audio.contentType,
          durationSeconds:
            typeof payload.audio.durationSeconds === 'number'
              ? payload.audio.durationSeconds
              : audio.durationSeconds,
          status: 'transcribed',
          error: null,
        },
      })
      return workingItem
    },
    [inspectionId, persistItem]
  )

  const saveObservation = useCallback(
    async (queueItem: TuFieldQueueItem) => {
      const audio = queueItem.audio
      const transcriptText = audio?.transcriptText?.trim() || null
      const noteText = queueItem.noteText.trim()
      const imageIds = queueItem.images
        .map((image) => image.serverImageId)
        .filter((id): id is string => Boolean(id))

      const response = await fetch(`/api/tu/investigations/${inspectionId}/observations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientObservationId: queueItem.id,
          sourceType: transcriptText && noteText ? 'mixed' : transcriptText ? 'voice' : 'typed',
          location: queueItem.location,
          buildingComponent: null,
          noteText,
          transcriptText,
          riskNote: null,
          suggestedFollowUp: null,
          certainty: 'confirmed',
          reviewStatus: 'draft',
          targetSectionId: null,
          includeInReport: false,
          audioStorageBucket: audio?.storageBucket ?? null,
          audioStoragePath: audio?.storagePath ?? null,
          audioContentType: audio?.contentType ?? null,
          audioDurationSeconds: audio?.durationSeconds ?? null,
          observedAt: queueItem.observedAt,
          imageIds,
        }),
      })
      const payload = (await response.json().catch(() => ({}))) as ObservationApiResponse
      if (!response.ok) throw new Error(payload.error ?? 'Kunde inte spara fältanteckningen.')
      if (!payload.observation) throw new Error('Servern returnerade ingen observation.')
      onObservationSaved?.(payload.observation)
    },
    [inspectionId, onObservationSaved]
  )

  const processItem = useCallback(
    async (itemId: string) => {
      const stored = await getTuFieldQueueItem(itemId)
      if (!stored || stored.inspectionId !== inspectionId || stored.status !== 'queued') return

      let workingItem = await persistItem({
        ...stored,
        status: 'processing',
        activeStep: stored.images.some((image) => !image.serverImageId) ? 'uploading' : null,
        attempts: stored.attempts + 1,
        error: null,
      })

      try {
        for (let index = 0; index < workingItem.images.length; index += 1) {
          if (!workingItem.images[index]?.serverImageId) {
            workingItem = await uploadImage(workingItem, index)
          }
        }

        if (workingItem.audio && !workingItem.audio.transcriptText) {
          workingItem = await transcribeAudio(workingItem)
        }

        if (workingItem.kind === 'entry') {
          workingItem = await persistItem({ ...workingItem, activeStep: 'saving' })
          await saveObservation(workingItem)
        }

        await deleteTuFieldQueueItem(workingItem.id)
        removeItemFromState(workingItem.id)
        if (mountedRef.current) setCompletedRevision((revision) => revision + 1)
      } catch (error) {
        const latest = (await getTuFieldQueueItem(itemId)) ?? workingItem
        const message = errorMessage(error, 'Bakgrundsjobbet misslyckades.')
        const failed: TuFieldQueueItem = {
          ...latest,
          status: 'failed',
          activeStep: null,
          error: message,
          images: latest.images.map((image) =>
            image.status === 'uploading' ? { ...image, status: 'failed', error: message } : image
          ),
          audio:
            latest.audio?.status === 'transcribing'
              ? { ...latest.audio, status: 'failed', error: message }
              : latest.audio,
          updatedAt: new Date().toISOString(),
        }
        await putTuFieldQueueItem(failed)
        replaceItemInState(failed)
      }
    },
    [inspectionId, persistItem, removeItemFromState, replaceItemInState, saveObservation, transcribeAudio, uploadImage]
  )

  const processQueue = useCallback(async () => {
    if (!enabled || locked || processorRunningRef.current) return
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return

    processorRunningRef.current = true
    setQueueError(null)
    try {
      const queuedItems = (await listTuFieldQueueItems(inspectionId)).filter(
        (item) => item.status === 'queued'
      )
      let cursor = 0
      const workerCount = Math.min(MAX_CONCURRENT_ITEMS, queuedItems.length)
      await Promise.all(
        Array.from({ length: workerCount }, async () => {
          while (cursor < queuedItems.length) {
            const item = queuedItems[cursor]
            cursor += 1
            if (item) await processItem(item.id)
          }
        })
      )
    } catch (error) {
      if (mountedRef.current) {
        setQueueError(errorMessage(error, 'Kunde inte bearbeta den lokala fältkön.'))
      }
    } finally {
      processorRunningRef.current = false
      await syncItems().catch(() => undefined)
    }
  }, [enabled, inspectionId, locked, processItem, syncItems])

  const enqueueFieldEntry = useCallback(
    async ({ noteText, location, files = [], audio = null }: EnqueueFieldEntryInput) => {
      if (!enabled || locked) throw new Error('Utlåtandet är låst och kan inte ändras.')
      if (!noteText.trim() && files.length === 0 && !audio) {
        throw new Error('Lägg till en anteckning, bild eller röstinspelning.')
      }
      const now = new Date().toISOString()
      const item: TuFieldQueueItem = {
        id: createId(),
        inspectionId,
        kind: 'entry',
        noteText: noteText.trim(),
        location: location?.trim() || null,
        observedAt: now,
        createdAt: now,
        updatedAt: now,
        status: 'queued',
        activeStep: null,
        attempts: 0,
        error: null,
        images: files.map(queuedImage),
        audio: audio ? queuedAudio(audio) : null,
      }
      await putTuFieldQueueItem(item)
      replaceItemInState(item)
      void processQueue()
      return item.id
    },
    [enabled, inspectionId, locked, processQueue, replaceItemInState]
  )

  const enqueueLooseImages = useCallback(
    async (files: File[]) => {
      if (!enabled || locked) throw new Error('Utlåtandet är låst och kan inte ändras.')
      if (files.length === 0) return null
      const now = new Date().toISOString()
      const item: TuFieldQueueItem = {
        id: createId(),
        inspectionId,
        kind: 'loose-images',
        noteText: '',
        location: null,
        observedAt: now,
        createdAt: now,
        updatedAt: now,
        status: 'queued',
        activeStep: null,
        attempts: 0,
        error: null,
        images: files.map(queuedImage),
        audio: null,
      }
      await putTuFieldQueueItem(item)
      replaceItemInState(item)
      void processQueue()
      return item.id
    },
    [enabled, inspectionId, locked, processQueue, replaceItemInState]
  )

  const retryItem = useCallback(
    async (itemId: string) => {
      const current = await getTuFieldQueueItem(itemId)
      if (!current) return
      const next = resetFailedParts(current)
      await putTuFieldQueueItem(next)
      replaceItemInState(next)
      void processQueue()
    },
    [processQueue, replaceItemInState]
  )

  const retryAll = useCallback(async () => {
    const current = await listTuFieldQueueItems(inspectionId)
    await Promise.all(
      current
        .filter((item) => item.status === 'failed')
        .map(async (item) => putTuFieldQueueItem(resetFailedParts(item)))
    )
    await syncItems()
    void processQueue()
  }, [inspectionId, processQueue, syncItems])

  useEffect(() => {
    mountedRef.current = true
    if (!enabled) return
    let cancelled = false

    async function hydrate() {
      try {
        const stored = await listTuFieldQueueItems(inspectionId)
        const interrupted = stored.filter((item) => item.status === 'processing')
        if (interrupted.length > 0) {
          await Promise.all(interrupted.map((item) => putTuFieldQueueItem(resetFailedParts(item))))
        }
        if (!cancelled) await syncItems()
      } catch (error) {
        if (!cancelled) {
          setQueueError(errorMessage(error, 'Kunde inte läsa den lokala fältkön.'))
        }
      }
    }

    void hydrate()
    return () => {
      cancelled = true
      mountedRef.current = false
    }
  }, [enabled, inspectionId, syncItems])

  useEffect(() => {
    const activeImageIds = new Set(items.flatMap((item) => item.images.map((image) => image.id)))
    setPreviewUrls((current) => {
      const next = { ...current }
      for (const item of items) {
        for (const image of item.images) {
          if (!next[image.id]) next[image.id] = URL.createObjectURL(image.blob)
        }
      }
      for (const [imageId, url] of Object.entries(next)) {
        if (!activeImageIds.has(imageId)) {
          URL.revokeObjectURL(url)
          delete next[imageId]
        }
      }
      previewUrlsRef.current = next
      return next
    })
  }, [items])

  useEffect(
    () => () => {
      for (const url of Object.values(previewUrlsRef.current)) URL.revokeObjectURL(url)
      previewUrlsRef.current = {}
    },
    []
  )

  const queueSignal = items.map((item) => `${item.id}:${item.status}`).join('|')
  useEffect(() => {
    if (!enabled || locked || !items.some((item) => item.status === 'queued')) return
    void processQueue()
  }, [enabled, items, locked, processQueue, queueSignal])

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return
    const handleOnline = () => void processQueue()
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [enabled, processQueue])

  useEffect(() => {
    if (!enabled || items.length === 0 || typeof window === 'undefined') return
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [enabled, items.length])

  const counts = useMemo(
    () => ({
      total: items.length,
      uploading: items.filter((item) => item.activeStep === 'uploading').length,
      transcribing: items.filter((item) => item.activeStep === 'transcribing').length,
      saving: items.filter((item) => item.activeStep === 'saving').length,
      failed: items.filter((item) => item.status === 'failed').length,
      waiting: items.filter((item) => item.status === 'queued').length,
    }),
    [items]
  )

  return {
    items,
    previewUrls,
    counts,
    queueError,
    completedRevision,
    enqueueFieldEntry,
    enqueueLooseImages,
    retryItem,
    retryAll,
    processQueue,
  }
}

export type TuFieldQueueController = ReturnType<typeof useTuFieldQueue>
