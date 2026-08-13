'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EbNoteImage, EbProjectAttachment } from '@/lib/eb/server'
import {
  deleteEbNoteImageUploadItem,
  getEbNoteImageUploadItem,
  listEbNoteImageUploadItems,
  putEbNoteImageUploadItem,
  type EbNoteImageUploadItem,
} from '@/lib/eb/noteImageUploadQueue'

const MAX_CONCURRENT_UPLOADS = 2

type ImageApiResponse = {
  image?: EbNoteImage
  error?: string
}

type PreparedImageFiles = {
  uploadFile: File
  thumbnailFile: File | null
}

type UseEbNoteImageUploadQueueOptions = {
  projectId: string
  inspectionId: string
  enabled: boolean
  locked: boolean
  prepareFiles: (file: File) => Promise<PreparedImageFiles>
  ensureNoteReady?: (noteId: string) => Promise<void>
  onUploaded: (image: EbNoteImage) => void
  onFailed?: (message: string) => void
}

function createId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16)
    const value = character === 'x' ? random : (random & 0x3) | 0x8
    return value.toString(16)
  })
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

async function apiError(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => ({}))) as { error?: unknown }
  return typeof payload.error === 'string' && payload.error.trim() ? payload.error : fallback
}

function resetInterruptedItem(item: EbNoteImageUploadItem): EbNoteImageUploadItem {
  return {
    ...item,
    status: 'queued',
    error: null,
    updatedAt: new Date().toISOString(),
  }
}

export function useEbNoteImageUploadQueue({
  projectId,
  inspectionId,
  enabled,
  locked,
  prepareFiles,
  ensureNoteReady,
  onUploaded,
  onFailed,
}: UseEbNoteImageUploadQueueOptions) {
  const [items, setItems] = useState<EbNoteImageUploadItem[]>([])
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({})
  const [queueError, setQueueError] = useState<string | null>(null)
  const processorRunningRef = useRef(false)
  const mountedRef = useRef(true)
  const previewUrlsRef = useRef<Record<string, string>>({})
  const prepareFilesRef = useRef(prepareFiles)
  const ensureNoteReadyRef = useRef(ensureNoteReady)
  const onUploadedRef = useRef(onUploaded)
  const onFailedRef = useRef(onFailed)

  useEffect(() => {
    prepareFilesRef.current = prepareFiles
  }, [prepareFiles])

  useEffect(() => {
    ensureNoteReadyRef.current = ensureNoteReady
  }, [ensureNoteReady])

  useEffect(() => {
    onUploadedRef.current = onUploaded
  }, [onUploaded])

  useEffect(() => {
    onFailedRef.current = onFailed
  }, [onFailed])

  const syncItems = useCallback(async () => {
    if (!enabled) return []
    const nextItems = await listEbNoteImageUploadItems(inspectionId)
    if (mountedRef.current) setItems(nextItems)
    return nextItems
  }, [enabled, inspectionId])

  const replaceItemInState = useCallback((item: EbNoteImageUploadItem) => {
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
    async (item: EbNoteImageUploadItem) => {
      const next = { ...item, updatedAt: new Date().toISOString() }
      await putEbNoteImageUploadItem(next)
      replaceItemInState(next)
      return next
    },
    [replaceItemInState]
  )

  const processItem = useCallback(
    async (itemId: string) => {
      const queuedItem = await getEbNoteImageUploadItem(itemId)
      if (!queuedItem || queuedItem.status !== 'queued') return

      const workingItem = await persistItem({
        ...queuedItem,
        status: 'uploading',
        attempts: queuedItem.attempts + 1,
        error: null,
      })

      try {
        await ensureNoteReadyRef.current?.(workingItem.noteId)
        const imagePath = `/api/eb/projects/${workingItem.projectId}/inspections/${workingItem.inspectionId}/notes/${workingItem.noteId}/images`
        let response: Response

        if (workingItem.sourceType === 'project_attachment') {
          if (!workingItem.sourceAttachmentId) {
            throw new Error('Bildbanksbilden saknar källreferens.')
          }
          response = await fetch(imagePath, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              attachmentId: workingItem.sourceAttachmentId,
              action: 'copyAttachment',
            }),
          })
        } else {
          if (!workingItem.blob) throw new Error('Den lokalt sparade bildfilen saknas.')
          const originalFile = new File(
            [workingItem.blob],
            workingItem.originalName || `besiktningsbild-${workingItem.id}.jpg`,
            { type: workingItem.contentType || workingItem.blob.type || 'image/jpeg' }
          )
          const { uploadFile, thumbnailFile } = await prepareFilesRef.current(originalFile)
          const formData = new FormData()
          formData.append('file', uploadFile)
          formData.append('clientImageId', workingItem.id)
          if (thumbnailFile) formData.append('thumbnail', thumbnailFile)
          response = await fetch(imagePath, { method: 'POST', body: formData })
        }

        if (!response.ok) {
          throw new Error(await apiError(response, 'Kunde inte ladda upp bild.'))
        }
        const payload = (await response.json().catch(() => ({}))) as ImageApiResponse
        if (!payload.image?.id) throw new Error('Servern returnerade ingen sparad bild.')

        await deleteEbNoteImageUploadItem(workingItem.id)
        removeItemFromState(workingItem.id)
        onUploadedRef.current(payload.image)
      } catch (error) {
        const message = errorMessage(error, 'Kunde inte ladda upp bild.')
        const latest = (await getEbNoteImageUploadItem(workingItem.id)) ?? workingItem
        const failed = await persistItem({ ...latest, status: 'failed', error: message })
        onFailedRef.current?.(failed.error ?? message)
      }
    },
    [persistItem, removeItemFromState]
  )

  const processQueue = useCallback(async () => {
    if (!enabled || locked || processorRunningRef.current) return
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return

    processorRunningRef.current = true
    setQueueError(null)
    try {
      while (true) {
        const queuedItems = (await listEbNoteImageUploadItems(inspectionId)).filter(
          (item) => item.status === 'queued'
        )
        if (queuedItems.length === 0) break

        let cursor = 0
        const workerCount = Math.min(MAX_CONCURRENT_UPLOADS, queuedItems.length)
        await Promise.all(
          Array.from({ length: workerCount }, async () => {
            while (cursor < queuedItems.length) {
              const item = queuedItems[cursor]
              cursor += 1
              if (item) await processItem(item.id)
            }
          })
        )
      }
    } catch (error) {
      if (mountedRef.current) {
        setQueueError(errorMessage(error, 'Kunde inte bearbeta den lokala bildkön.'))
      }
    } finally {
      processorRunningRef.current = false
      await syncItems().catch(() => undefined)
    }
  }, [enabled, inspectionId, locked, processItem, syncItems])

  const enqueueFiles = useCallback(
    async (noteId: string, files: File[]) => {
      if (!enabled || locked) throw new Error('Utlåtandet är låst och kan inte ändras.')
      if (files.length === 0) return []
      const createdAt = new Date().toISOString()
      const queuedItems = files.map<EbNoteImageUploadItem>((file, index) => ({
        id: createId(),
        projectId,
        inspectionId,
        noteId,
        sourceType: 'file',
        blob: file,
        originalName: file.name || `besiktningsbild-${Date.now()}-${index + 1}.jpg`,
        contentType: file.type || 'image/jpeg',
        fileSize: file.size,
        sourceAttachmentId: null,
        sourceLabel: file.name || null,
        sourcePreviewUrl: null,
        createdAt,
        updatedAt: createdAt,
        status: 'queued',
        attempts: 0,
        error: null,
      }))

      await Promise.all(queuedItems.map((item) => putEbNoteImageUploadItem(item)))
      queuedItems.forEach(replaceItemInState)
      void processQueue()
      return queuedItems.map((item) => item.id)
    },
    [enabled, inspectionId, locked, processQueue, projectId, replaceItemInState]
  )

  const enqueueProjectAttachment = useCallback(
    async (noteId: string, attachment: EbProjectAttachment) => {
      if (!enabled || locked) throw new Error('Utlåtandet är låst och kan inte ändras.')
      const currentItems = await listEbNoteImageUploadItems(inspectionId)
      const existing = currentItems.find(
        (item) =>
          item.noteId === noteId &&
          item.sourceType === 'project_attachment' &&
          item.sourceAttachmentId === attachment.id
      )
      if (existing) {
        if (existing.status === 'failed') {
          const next = resetInterruptedItem(existing)
          await putEbNoteImageUploadItem(next)
          replaceItemInState(next)
          void processQueue()
        }
        return existing.id
      }

      const now = new Date().toISOString()
      const item: EbNoteImageUploadItem = {
        id: createId(),
        projectId,
        inspectionId,
        noteId,
        sourceType: 'project_attachment',
        blob: null,
        originalName: attachment.fileName,
        contentType: attachment.contentType,
        fileSize: attachment.fileSizeBytes,
        sourceAttachmentId: attachment.id,
        sourceLabel: attachment.title ?? attachment.fileName,
        sourcePreviewUrl: attachment.signedThumbnailUrl ?? attachment.signedUrl,
        createdAt: now,
        updatedAt: now,
        status: 'queued',
        attempts: 0,
        error: null,
      }
      await putEbNoteImageUploadItem(item)
      replaceItemInState(item)
      void processQueue()
      return item.id
    },
    [enabled, inspectionId, locked, processQueue, projectId, replaceItemInState]
  )

  const retryItem = useCallback(
    async (itemId: string) => {
      const current = await getEbNoteImageUploadItem(itemId)
      if (!current) return
      const next = resetInterruptedItem(current)
      await putEbNoteImageUploadItem(next)
      replaceItemInState(next)
      void processQueue()
    },
    [processQueue, replaceItemInState]
  )

  const retryAll = useCallback(async () => {
    const current = await listEbNoteImageUploadItems(inspectionId)
    const failed = current.filter((item) => item.status === 'failed').map(resetInterruptedItem)
    await Promise.all(failed.map((item) => putEbNoteImageUploadItem(item)))
    failed.forEach(replaceItemInState)
    void processQueue()
  }, [inspectionId, processQueue, replaceItemInState])

  const discardItem = useCallback(
    async (itemId: string) => {
      const current = await getEbNoteImageUploadItem(itemId)
      if (current?.status === 'uploading') return
      await deleteEbNoteImageUploadItem(itemId)
      removeItemFromState(itemId)
    },
    [removeItemFromState]
  )

  useEffect(() => {
    mountedRef.current = true
    if (!enabled) return
    let cancelled = false

    async function hydrate() {
      try {
        const stored = await listEbNoteImageUploadItems(inspectionId)
        const interrupted = stored.filter((item) => item.status === 'uploading')
        if (interrupted.length > 0) {
          await Promise.all(
            interrupted.map((item) => putEbNoteImageUploadItem(resetInterruptedItem(item)))
          )
        }
        if (!cancelled) await syncItems()
      } catch (error) {
        if (!cancelled) {
          setQueueError(errorMessage(error, 'Kunde inte läsa den lokala bildkön.'))
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
    const activeFileIds = new Set(
      items.filter((item) => item.sourceType === 'file' && item.blob).map((item) => item.id)
    )
    setPreviewUrls((current) => {
      const next = { ...current }
      for (const item of items) {
        if (item.sourceType === 'file' && item.blob && !next[item.id]) {
          next[item.id] = URL.createObjectURL(item.blob)
        }
      }
      for (const [itemId, url] of Object.entries(next)) {
        if (!activeFileIds.has(itemId)) {
          URL.revokeObjectURL(url)
          delete next[itemId]
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
      uploading: items.filter((item) => item.status === 'uploading').length,
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
    enqueueFiles,
    enqueueProjectAttachment,
    retryItem,
    retryAll,
    discardItem,
    processQueue,
  }
}

export type EbNoteImageUploadQueueController = ReturnType<typeof useEbNoteImageUploadQueue>
