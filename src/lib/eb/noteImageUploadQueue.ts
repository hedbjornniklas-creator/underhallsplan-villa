export type EbNoteImageUploadStatus = 'queued' | 'uploading' | 'failed'
export type EbNoteImageUploadSource = 'file' | 'project_attachment'

export type EbNoteImageUploadItem = {
  id: string
  projectId: string
  inspectionId: string
  noteId: string
  sourceType: EbNoteImageUploadSource
  blob: Blob | null
  originalName: string | null
  contentType: string | null
  fileSize: number | null
  sourceAttachmentId: string | null
  sourceLabel: string | null
  sourcePreviewUrl: string | null
  createdAt: string
  updatedAt: string
  status: EbNoteImageUploadStatus
  attempts: number
  error: string | null
}

const DB_NAME = 'eb-note-image-upload-queue'
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

export const listEbNoteImageUploadItems = async (inspectionId: string) => {
  const rows = await withStore<EbNoteImageUploadItem[]>('readonly', (store) => store.getAll())
  return rows
    .filter((row) => row.inspectionId === inspectionId)
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
}

export const getEbNoteImageUploadItem = async (id: string) =>
  await withStore<EbNoteImageUploadItem | undefined>('readonly', (store) => store.get(id))

export const putEbNoteImageUploadItem = async (item: EbNoteImageUploadItem) => {
  await withStore<IDBValidKey>('readwrite', (store) => store.put(item))
}

export const deleteEbNoteImageUploadItem = async (id: string) => {
  await withStore<undefined>('readwrite', (store) => store.delete(id))
}
