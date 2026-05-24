export type RoundImageUploadStatus = 'queued' | 'uploading' | 'failed'

export type RoundImageUploadItem = {
  id: string
  serverImageId: string
  inspectionId: string
  blob: Blob
  originalName: string | null
  contentType: string
  storagePath: string
  capturedAt: string
  createdAt: string
  updatedAt: string
  status: RoundImageUploadStatus
  attempts: number
  error: string | null
  sortOrder: number
  sourceArea: 'interior' | 'exterior'
  origin: {
    origin_interior_room_id: string | null
    origin_exterior_observation_id: string | null
    origin_exterior_item_id: string | null
    origin_floor_label: string | null
    origin_room_label: string | null
    origin_room_type_key: string | null
    origin_exterior_item_key: string | null
  }
  link: {
    control_item_id: string | null
    interior_room_id: string | null
    exterior_observation_id: string | null
    processing_status: 'unprocessed' | 'linked' | 'ignored'
    ignored_at: string | null
  }
}

const DB_NAME = 'ob-round-image-upload-queue'
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
    const store = transaction.objectStore(STORE_NAME)
    return await requestToPromise(run(store))
  } finally {
    db.close()
  }
}

export const listRoundImageUploadItems = async (inspectionId: string) => {
  const rows = await withStore<RoundImageUploadItem[]>('readonly', store => store.getAll())
  return rows
    .filter(row => row.inspectionId === inspectionId)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
}

export const putRoundImageUploadItem = async (item: RoundImageUploadItem) => {
  await withStore<IDBValidKey>('readwrite', store => store.put(item))
}

export const getRoundImageUploadItem = async (id: string) =>
  await withStore<RoundImageUploadItem | undefined>('readonly', store => store.get(id))

export const deleteRoundImageUploadItem = async (id: string) => {
  await withStore<undefined>('readwrite', store => store.delete(id))
}

export const updateRoundImageUploadItem = async (
  id: string,
  patch: Partial<RoundImageUploadItem>
) => {
  const current = await withStore<RoundImageUploadItem | undefined>('readonly', store => store.get(id))
  if (!current) return null
  const updated = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  }
  await putRoundImageUploadItem(updated)
  return updated
}
