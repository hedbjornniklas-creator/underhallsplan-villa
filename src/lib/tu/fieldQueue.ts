export type TuFieldQueueStatus = 'queued' | 'processing' | 'failed'
export type TuFieldQueueImageStatus = 'queued' | 'uploading' | 'uploaded' | 'failed'
export type TuFieldQueueAudioStatus = 'queued' | 'transcribing' | 'transcribed' | 'failed'

export type TuFieldQueuedImage = {
  id: string
  blob: Blob
  originalName: string
  contentType: string
  fileSize: number
  filePath: string | null
  serverImageId: string | null
  publicUrl: string | null
  status: TuFieldQueueImageStatus
  error: string | null
}

export type TuFieldQueuedAudio = {
  blob: Blob
  contentType: string
  durationSeconds: number
  transcriptText: string | null
  storageBucket: string | null
  storagePath: string | null
  status: TuFieldQueueAudioStatus
  error: string | null
}

export type TuFieldQueueItem = {
  id: string
  inspectionId: string
  kind: 'entry' | 'loose-images'
  noteText: string
  location: string | null
  observedAt: string
  createdAt: string
  updatedAt: string
  status: TuFieldQueueStatus
  activeStep: 'uploading' | 'transcribing' | 'saving' | null
  attempts: number
  error: string | null
  images: TuFieldQueuedImage[]
  audio: TuFieldQueuedAudio | null
}

const DB_NAME = 'tu-field-capture-queue'
const STORE_NAME = 'items'
const DB_VERSION = 1

const hasIndexedDb = () => typeof indexedDB !== 'undefined'

const requestToPromise = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

const openDb = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    if (!hasIndexedDb()) {
      reject(new Error('IndexedDB saknas i den här webbläsaren.'))
      return
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

const withStore = async <T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
) => {
  const db = await openDb()
  try {
    const transaction = db.transaction(STORE_NAME, mode)
    return await requestToPromise(run(transaction.objectStore(STORE_NAME)))
  } finally {
    db.close()
  }
}

export const listTuFieldQueueItems = async (inspectionId: string) => {
  const rows = await withStore<TuFieldQueueItem[]>('readonly', (store) => store.getAll())
  return rows
    .filter((row) => row.inspectionId === inspectionId)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
}

export const getTuFieldQueueItem = async (id: string) =>
  await withStore<TuFieldQueueItem | undefined>('readonly', (store) => store.get(id))

export const putTuFieldQueueItem = async (item: TuFieldQueueItem) => {
  await withStore<IDBValidKey>('readwrite', (store) => store.put(item))
}

export const updateTuFieldQueueItem = async (
  id: string,
  patch: Partial<TuFieldQueueItem>
) => {
  const current = await getTuFieldQueueItem(id)
  if (!current) return null
  const updated: TuFieldQueueItem = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  }
  await putTuFieldQueueItem(updated)
  return updated
}

export const deleteTuFieldQueueItem = async (id: string) => {
  await withStore<undefined>('readwrite', (store) => store.delete(id))
}
