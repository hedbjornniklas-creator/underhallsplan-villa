'use client'

import { useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { ExternalLink, FileText, Image as ImageIcon, Loader2, Save, Trash2, Upload } from 'lucide-react'
import type { EbAttachmentType, EbProjectAttachment } from '@/lib/eb/server'

type EbProjectAttachmentsPanelProps = {
  projectId: string
  initialAttachments: EbProjectAttachment[]
}

type AttachmentsResponse = {
  attachments?: EbProjectAttachment[]
  error?: string
}

type AttachmentEditState = {
  title: string
  includeInReport: boolean
  littera: string
  documentDate: string
  documentNumber: string
  documentNote: string
}

function buildAttachmentEditState(attachment: EbProjectAttachment): AttachmentEditState {
  return {
    title: attachment.title ?? '',
    includeInReport: attachment.includeInReport,
    littera: attachment.littera ?? '',
    documentDate: attachment.documentDate ?? '',
    documentNumber: attachment.documentNumber ?? '',
    documentNote: attachment.documentNote ?? '',
  }
}

function buildAttachmentEditMap(attachments: EbProjectAttachment[]) {
  return Object.fromEntries(
    attachments.map((attachment) => [attachment.id, buildAttachmentEditState(attachment)])
  )
}

function formatDate(value: string | null) {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString('sv-SE')
}

function formatFileSize(value: number | null) {
  if (!value || value <= 0) return ''
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} kB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function attachmentTitle(attachment: EbProjectAttachment) {
  return attachment.title || attachment.fileName || 'Bilaga'
}

function metadataInputClassName() {
  return 'mt-1 w-full rounded-md border border-emerald-200 bg-white px-2 py-1.5 text-sm text-gray-950 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100'
}

function UploadButton({
  type,
  busy,
  disabled = false,
  onFile,
}: {
  type: EbAttachmentType
  busy: boolean
  disabled?: boolean
  onFile: (type: EbAttachmentType, file: File) => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const isImage = type === 'image'
  const isDisabled = disabled || busy

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null
    event.target.value = ''
    if (!file) return
    onFile(type, file)
  }

  return (
    <label className={`inline-flex items-center justify-center gap-2 rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50 ${isDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
      {busy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
      {isImage ? 'Ladda upp bild' : 'Ladda upp handling'}
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        accept={isImage ? 'image/jpeg,image/png,image/webp,image/heic,image/heif' : '.pdf,.doc,.docx,.xls,.xlsx,.txt'}
        disabled={isDisabled}
        onChange={handleChange}
      />
    </label>
  )
}

function AttachmentDropZone({
  type,
  active,
  disabled,
  busy,
  onActiveChange,
  onFiles,
}: {
  type: EbAttachmentType
  active: boolean
  disabled: boolean
  busy: boolean
  onActiveChange: (type: EbAttachmentType | null) => void
  onFiles: (type: EbAttachmentType, files: File[]) => void
}) {
  const isImage = type === 'image'

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (!disabled) onActiveChange(type)
  }

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (disabled) return
    event.dataTransfer.dropEffect = 'copy'
    onActiveChange(type)
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    onActiveChange(null)
    if (disabled) return

    const files = Array.from(event.dataTransfer.files ?? [])
    if (files.length === 0) return
    onFiles(type, files)
  }

  return (
    <div
      role="button"
      tabIndex={-1}
      aria-disabled={disabled}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={() => onActiveChange(null)}
      onDrop={handleDrop}
      className={`mb-3 flex min-h-24 items-center justify-center rounded-md border border-dashed px-3 py-4 text-center text-sm transition ${
        active
          ? 'border-emerald-500 bg-emerald-50 text-emerald-900'
          : 'border-emerald-200 bg-white/70 text-gray-600'
      } ${disabled ? 'opacity-60' : ''}`}
    >
      <div className="flex flex-col items-center gap-2">
        {busy ? (
          <Loader2 size={20} className="animate-spin text-emerald-700" />
        ) : isImage ? (
          <ImageIcon size={20} className="text-emerald-700" />
        ) : (
          <FileText size={20} className="text-emerald-700" />
        )}
        <span className="font-semibold">{isImage ? 'Släpp bilder här' : 'Släpp handlingar här'}</span>
      </div>
    </div>
  )
}

export default function EbProjectAttachmentsPanel({
  projectId,
  initialAttachments,
}: EbProjectAttachmentsPanelProps) {
  const [attachments, setAttachments] = useState(initialAttachments)
  const [attachmentEdits, setAttachmentEdits] = useState<Record<string, AttachmentEditState>>(
    () => buildAttachmentEditMap(initialAttachments)
  )
  const [uploadingType, setUploadingType] = useState<EbAttachmentType | null>(null)
  const [draggingType, setDraggingType] = useState<EbAttachmentType | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const documents = attachments.filter((attachment) => attachment.attachmentType === 'document')
  const images = attachments.filter((attachment) => attachment.attachmentType === 'image')

  const replaceAttachments = (nextAttachments: EbProjectAttachment[]) => {
    setAttachments(nextAttachments)
    setAttachmentEdits(buildAttachmentEditMap(nextAttachments))
  }

  const updateAttachmentEdit = <K extends keyof AttachmentEditState>(
    attachmentId: string,
    field: K,
    value: AttachmentEditState[K]
  ) => {
    const attachment = attachments.find((item) => item.id === attachmentId)
    if (!attachment) return

    setAttachmentEdits((current) => ({
      ...current,
      [attachmentId]: {
        ...(current[attachmentId] ?? buildAttachmentEditState(attachment)),
        [field]: value,
      },
    }))
  }

  const handleFilesUpload = async (attachmentType: EbAttachmentType, files: File[]) => {
    if (uploadingType) return
    const uploadFiles = files.filter(Boolean)
    if (uploadFiles.length === 0) return

    try {
      setUploadingType(attachmentType)
      setError(null)

      for (const file of uploadFiles) {
        const formData = new FormData()
        formData.set('attachmentType', attachmentType)
        formData.set('file', file)

        const response = await fetch(`/api/eb/projects/${projectId}/attachments`, {
          method: 'POST',
          body: formData,
        })
        const payload = (await response.json().catch(() => ({}))) as AttachmentsResponse

        if (!response.ok || !payload.attachments) {
          throw new Error(payload.error ?? 'Kunde inte ladda upp bilaga.')
        }

        replaceAttachments(payload.attachments)
      }
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Kunde inte ladda upp bilaga.')
    } finally {
      setUploadingType(null)
    }
  }

  const handleUpload = (attachmentType: EbAttachmentType, file: File) => {
    void handleFilesUpload(attachmentType, [file])
  }

  const handleSaveMetadata = async (attachment: EbProjectAttachment) => {
    if (savingId) return
    const edit = attachmentEdits[attachment.id] ?? buildAttachmentEditState(attachment)

    try {
      setSavingId(attachment.id)
      setError(null)
      const response = await fetch(`/api/eb/projects/${projectId}/attachments/${attachment.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(edit),
      })
      const payload = (await response.json().catch(() => ({}))) as AttachmentsResponse

      if (!response.ok || !payload.attachments) {
        throw new Error(payload.error ?? 'Kunde inte spara bilageuppgifter.')
      }

      replaceAttachments(payload.attachments)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Kunde inte spara bilageuppgifter.')
    } finally {
      setSavingId(null)
    }
  }

  const handleDelete = async (attachment: EbProjectAttachment) => {
    if (deletingId) return
    const confirmed = window.confirm(`Ta bort ${attachmentTitle(attachment)}?`)
    if (!confirmed) return

    try {
      setDeletingId(attachment.id)
      setError(null)
      const response = await fetch(`/api/eb/projects/${projectId}/attachments/${attachment.id}`, {
        method: 'DELETE',
      })
      const payload = (await response.json().catch(() => ({}))) as AttachmentsResponse

      if (!response.ok || !payload.attachments) {
        throw new Error(payload.error ?? 'Kunde inte ta bort bilaga.')
      }

      replaceAttachments(payload.attachments)
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Kunde inte ta bort bilaga.')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <section className="mt-4 overflow-hidden rounded-lg border border-emerald-100 bg-white/78 shadow-sm backdrop-blur-sm">
      <div className="flex flex-col gap-3 border-b border-emerald-100 px-4 py-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-950">Handlingar och bilder</h2>
          <p className="text-xs text-gray-600">{attachments.length} st bilagor</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <UploadButton
            type="document"
            busy={uploadingType === 'document'}
            disabled={Boolean(uploadingType && uploadingType !== 'document')}
            onFile={handleUpload}
          />
          <UploadButton
            type="image"
            busy={uploadingType === 'image'}
            disabled={Boolean(uploadingType && uploadingType !== 'image')}
            onFile={handleUpload}
          />
        </div>
      </div>

      {error ? (
        <div className="border-b border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}

      <div className="grid gap-6 px-4 py-4 lg:grid-cols-2">
        <div>
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-950">
            <FileText size={17} className="text-emerald-700" />
            Handlingar
          </div>
          <AttachmentDropZone
            type="document"
            active={draggingType === 'document'}
            disabled={Boolean(uploadingType)}
            busy={uploadingType === 'document'}
            onActiveChange={setDraggingType}
            onFiles={(type, files) => void handleFilesUpload(type, files)}
          />
          {documents.length === 0 ? (
            <div className="rounded-md border border-dashed border-emerald-200 bg-white/70 px-3 py-6 text-center text-sm text-gray-600">
              Inga handlingar uppladdade.
            </div>
          ) : (
            <div className="divide-y divide-emerald-100 rounded-md border border-emerald-100 bg-white">
              {documents.map((attachment) => {
                const edit = attachmentEdits[attachment.id] ?? buildAttachmentEditState(attachment)
                return (
                  <div key={attachment.id} className="px-3 py-3">
                    <div className="flex items-start gap-3">
                      <FileText size={18} className="mt-2 shrink-0 text-emerald-700" />
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                          <label className="min-w-0 flex-1">
                            <span className="block text-[11px] font-semibold text-gray-600">Titel</span>
                            <input
                              value={edit.title}
                              onChange={(event) => updateAttachmentEdit(attachment.id, 'title', event.target.value)}
                              className={metadataInputClassName()}
                            />
                          </label>
                          <label className="flex items-center gap-2 pt-5 text-xs font-semibold text-gray-700">
                            <input
                              type="checkbox"
                              checked={edit.includeInReport}
                              onChange={(event) => updateAttachmentEdit(attachment.id, 'includeInReport', event.target.checked)}
                              className="h-4 w-4 rounded border-emerald-300 text-emerald-700"
                            />
                            Med i utlåtande
                          </label>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-3">
                          <label>
                            <span className="block text-[11px] font-semibold text-gray-600">Littera</span>
                            <input
                              value={edit.littera}
                              onChange={(event) => updateAttachmentEdit(attachment.id, 'littera', event.target.value.toUpperCase())}
                              className={metadataInputClassName()}
                            />
                          </label>
                          <label>
                            <span className="block text-[11px] font-semibold text-gray-600">Datum</span>
                            <input
                              type="date"
                              value={edit.documentDate}
                              onChange={(event) => updateAttachmentEdit(attachment.id, 'documentDate', event.target.value)}
                              className={metadataInputClassName()}
                            />
                          </label>
                          <label>
                            <span className="block text-[11px] font-semibold text-gray-600">Nr/revision</span>
                            <input
                              value={edit.documentNumber}
                              onChange={(event) => updateAttachmentEdit(attachment.id, 'documentNumber', event.target.value)}
                              className={metadataInputClassName()}
                            />
                          </label>
                        </div>
                        <label>
                          <span className="block text-[11px] font-semibold text-gray-600">Komplettering/anteckning</span>
                          <input
                            value={edit.documentNote}
                            onChange={(event) => updateAttachmentEdit(attachment.id, 'documentNote', event.target.value)}
                            className={metadataInputClassName()}
                          />
                        </label>
                        <p className="truncate text-xs text-gray-600">
                          {[attachment.fileName, formatFileSize(attachment.fileSizeBytes), formatDate(attachment.createdAt)]
                            .filter(Boolean)
                            .join(' - ')}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col gap-2">
                        {attachment.signedUrl ? (
                          <a
                            href={attachment.signedUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-emerald-200 bg-white text-emerald-800 transition hover:bg-emerald-50"
                            aria-label="Öppna"
                            title="Öppna"
                          >
                            <ExternalLink size={15} />
                          </a>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => void handleSaveMetadata(attachment)}
                          disabled={savingId === attachment.id}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-emerald-200 bg-white text-emerald-800 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                          aria-label="Spara"
                          title="Spara"
                        >
                          {savingId === attachment.id ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(attachment)}
                          disabled={deletingId === attachment.id}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-rose-200 bg-white text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                          aria-label="Ta bort"
                          title="Ta bort"
                        >
                          {deletingId === attachment.id ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div>
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-950">
            <ImageIcon size={17} className="text-emerald-700" />
            Bilder
          </div>
          <AttachmentDropZone
            type="image"
            active={draggingType === 'image'}
            disabled={Boolean(uploadingType)}
            busy={uploadingType === 'image'}
            onActiveChange={setDraggingType}
            onFiles={(type, files) => void handleFilesUpload(type, files)}
          />
          {images.length === 0 ? (
            <div className="rounded-md border border-dashed border-emerald-200 bg-white/70 px-3 py-6 text-center text-sm text-gray-600">
              Inga bilder uppladdade.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {images.map((attachment) => (
                <div key={attachment.id} className="overflow-hidden rounded-md border border-emerald-100 bg-white">
                  {attachment.signedUrl ? (
                    <a href={attachment.signedUrl} target="_blank" rel="noreferrer" className="block">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={attachment.signedUrl}
                        alt={attachmentTitle(attachment)}
                        className="aspect-[4/3] w-full object-cover"
                      />
                    </a>
                  ) : (
                    <div className="flex aspect-[4/3] items-center justify-center bg-emerald-50 text-emerald-700">
                      <ImageIcon size={24} />
                    </div>
                  )}
                  <div className="flex items-center gap-2 px-2 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-gray-950">{attachmentTitle(attachment)}</p>
                      <p className="truncate text-[11px] text-gray-600">{formatFileSize(attachment.fileSizeBytes)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleDelete(attachment)}
                      disabled={deletingId === attachment.id}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-rose-200 bg-white text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                      aria-label="Ta bort"
                      title="Ta bort"
                    >
                      {deletingId === attachment.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
