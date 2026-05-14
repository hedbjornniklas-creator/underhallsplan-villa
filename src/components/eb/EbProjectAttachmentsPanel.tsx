'use client'

import { useRef, useState, type ChangeEvent } from 'react'
import { ExternalLink, FileText, Image as ImageIcon, Loader2, Trash2, Upload } from 'lucide-react'
import type { EbAttachmentType, EbProjectAttachment } from '@/lib/eb/server'

type EbProjectAttachmentsPanelProps = {
  projectId: string
  initialAttachments: EbProjectAttachment[]
}

type AttachmentsResponse = {
  attachments?: EbProjectAttachment[]
  error?: string
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

function UploadButton({
  type,
  busy,
  onFile,
}: {
  type: EbAttachmentType
  busy: boolean
  onFile: (type: EbAttachmentType, file: File) => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const isImage = type === 'image'

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null
    event.target.value = ''
    if (!file) return
    onFile(type, file)
  }

  return (
    <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50">
      {busy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
      {isImage ? 'Ladda upp bild' : 'Ladda upp handling'}
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        accept={isImage ? 'image/jpeg,image/png,image/webp,image/heic,image/heif' : '.pdf,.doc,.docx,.xls,.xlsx,.txt'}
        disabled={busy}
        onChange={handleChange}
      />
    </label>
  )
}

export default function EbProjectAttachmentsPanel({
  projectId,
  initialAttachments,
}: EbProjectAttachmentsPanelProps) {
  const [attachments, setAttachments] = useState(initialAttachments)
  const [uploadingType, setUploadingType] = useState<EbAttachmentType | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const documents = attachments.filter((attachment) => attachment.attachmentType === 'document')
  const images = attachments.filter((attachment) => attachment.attachmentType === 'image')

  const handleUpload = async (attachmentType: EbAttachmentType, file: File) => {
    if (uploadingType) return

    try {
      setUploadingType(attachmentType)
      setError(null)
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

      setAttachments(payload.attachments)
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Kunde inte ladda upp bilaga.')
    } finally {
      setUploadingType(null)
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

      setAttachments(payload.attachments)
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
          <UploadButton type="document" busy={uploadingType === 'document'} onFile={handleUpload} />
          <UploadButton type="image" busy={uploadingType === 'image'} onFile={handleUpload} />
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
          {documents.length === 0 ? (
            <div className="rounded-md border border-dashed border-emerald-200 bg-white/70 px-3 py-6 text-center text-sm text-gray-600">
              Inga handlingar uppladdade.
            </div>
          ) : (
            <div className="divide-y divide-emerald-100 rounded-md border border-emerald-100 bg-white">
              {documents.map((attachment) => (
                <div key={attachment.id} className="flex items-center gap-3 px-3 py-3">
                  <FileText size={18} className="shrink-0 text-emerald-700" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-gray-950">{attachmentTitle(attachment)}</p>
                    <p className="truncate text-xs text-gray-600">
                      {[formatFileSize(attachment.fileSizeBytes), formatDate(attachment.createdAt)]
                        .filter(Boolean)
                        .join(' - ')}
                    </p>
                  </div>
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
                    onClick={() => void handleDelete(attachment)}
                    disabled={deletingId === attachment.id}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-rose-200 bg-white text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                    aria-label="Ta bort"
                    title="Ta bort"
                  >
                    {deletingId === attachment.id ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-950">
            <ImageIcon size={17} className="text-emerald-700" />
            Bilder
          </div>
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
