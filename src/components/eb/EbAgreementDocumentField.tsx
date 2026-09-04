'use client'

import { useEffect, useId, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { ExternalLink, Eye, FileText, Link2, Loader2, RefreshCw, Upload, X } from 'lucide-react'
import { useEbToast } from '@/components/eb/EbToastProvider'
import type { EbProjectAttachment, EbProjectListItem } from '@/lib/eb/server'

type AttachmentsResponse = {
  attachments?: EbProjectAttachment[]
  project?: EbProjectListItem
  error?: string
}

type EbAgreementDocumentFieldProps = {
  projectId: string | null
  attachments: EbProjectAttachment[]
  attachmentIds: string[]
  label: string
  description?: string
  titleStateScope: string
  titleEditingDisabled?: boolean
  onAttachmentIdsChange: (attachmentIds: string[]) => void
  onAttachmentSelected?: (attachment: EbProjectAttachment) => void
  onAttachmentsChange: (attachments: EbProjectAttachment[]) => void
  onProjectUpdated?: (project: EbProjectListItem) => boolean | void
  onTitleSavingChange?: (operationKey: string, saving: boolean) => void
  onTitleDraftChange?: (draftKey: string, dirty: boolean) => void
}

function attachmentTitle(attachment: EbProjectAttachment) {
  return attachment.title || attachment.fileName || 'Handling'
}

function isPdf(attachment: EbProjectAttachment) {
  return (
    attachment.contentType?.toLocaleLowerCase('sv-SE') === 'application/pdf' ||
    attachment.fileName?.toLocaleLowerCase('sv-SE').endsWith('.pdf') === true
  )
}

function formatFileSize(value: number | null) {
  if (!value || value <= 0) return null
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} kB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function fileMeta(attachment: EbProjectAttachment) {
  return [attachment.fileName, attachment.documentDate, formatFileSize(attachment.fileSizeBytes)]
    .filter(Boolean)
    .join(' · ')
}

function uniqueAttachmentIds(attachmentIds: string[]) {
  return [...new Set(attachmentIds.filter(Boolean))]
}

function titleStateKey(scope: string, attachmentId: string) {
  return `${scope}\u0000${attachmentId}`
}

export default function EbAgreementDocumentField({
  projectId,
  attachments,
  attachmentIds,
  label,
  description,
  titleStateScope,
  titleEditingDisabled = false,
  onAttachmentIdsChange,
  onAttachmentSelected,
  onAttachmentsChange,
  onProjectUpdated,
  onTitleSavingChange,
  onTitleDraftChange,
}: EbAgreementDocumentFieldProps) {
  const { showError } = useEbToast()
  const inputId = useId()
  const pickerTitleId = useId()
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const pickerTriggerRef = useRef<HTMLButtonElement>(null)
  const pickerCloseRef = useRef<HTMLButtonElement>(null)
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [previewAttachmentId, setPreviewAttachmentId] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState('')
  const [titleDrafts, setTitleDrafts] = useState<Record<string, string>>({})
  const [savingTitleId, setSavingTitleId] = useState<string | null>(null)

  const documents = attachments.filter((attachment) => attachment.attachmentType === 'document')
  const selectedAttachments = attachmentIds
    .map((attachmentId) => documents.find((attachment) => attachment.id === attachmentId))
    .filter((attachment): attachment is EbProjectAttachment => Boolean(attachment))
  const previewAttachment = previewAttachmentId
    ? selectedAttachments.find((attachment) => attachment.id === previewAttachmentId) ?? null
    : null
  useEffect(() => {
    const selectedById = new Map(selectedAttachments.map((attachment) => [attachment.id, attachment]))
    const draftIdsToClear = Object.entries(titleDrafts).flatMap(([attachmentId, title]) => {
      const attachment = selectedById.get(attachmentId)
      return !attachment || title === attachmentTitle(attachment) ? [attachmentId] : []
    })
    if (draftIdsToClear.length === 0) return

    setTitleDrafts((current) => {
      const next = { ...current }
      for (const attachmentId of draftIdsToClear) delete next[attachmentId]
      return next
    })
    for (const attachmentId of draftIdsToClear) {
      onTitleDraftChange?.(titleStateKey(titleStateScope, attachmentId), false)
    }
  }, [onTitleDraftChange, selectedAttachments, titleDrafts, titleStateScope])

  useEffect(() => {
    if (!pickerOpen) return

    pickerCloseRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setPickerOpen(false)
      window.setTimeout(() => pickerTriggerRef.current?.focus(), 0)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [pickerOpen])

  useEffect(() => {
    if (!previewAttachmentId) return
    if (selectedAttachments.some((attachment) => attachment.id === previewAttachmentId)) return
    setPreviewAttachmentId(null)
  }, [previewAttachmentId, selectedAttachments])

  const updateSelection = (nextIds: string[]) => {
    onAttachmentIdsChange(uniqueAttachmentIds(nextIds))
  }

  const selectAttachment = (attachment: EbProjectAttachment) => {
    updateSelection([...attachmentIds, attachment.id])
    onAttachmentSelected?.(attachment)
    setPreviewAttachmentId(attachment.id)
    setStatusMessage(`${attachmentTitle(attachment)} är kopplad till ${label.toLocaleLowerCase('sv-SE')}.`)
  }

  const removeAttachment = (attachment: EbProjectAttachment) => {
    updateSelection(attachmentIds.filter((attachmentId) => attachmentId !== attachment.id))
    if (previewAttachmentId === attachment.id) setPreviewAttachmentId(null)
    setStatusMessage(`${attachmentTitle(attachment)} är inte längre kopplad till ${label.toLocaleLowerCase('sv-SE')}.`)
  }

  const uploadFile = async (file: File | null) => {
    if (!file || !projectId || uploading) return
    if (!isPdf({ contentType: file.type, fileName: file.name } as EbProjectAttachment)) {
      const error = new Error('Ladda upp avtalet som PDF här. Andra befintliga handlingar kan väljas från handlingbanken.')
      showError(error, 'Kunde inte lägga till avtalsfilen.')
      return
    }

    try {
      setUploading(true)
      setStatusMessage('Laddar upp PDF…')
      const formData = new FormData()
      formData.set('attachmentType', 'document')
      formData.set('file', file)

      const response = await fetch(`/api/eb/projects/${projectId}/attachments`, {
        method: 'POST',
        body: formData,
      })
      const payload = (await response.json().catch(() => ({}))) as AttachmentsResponse
      if (!response.ok || !payload.attachments) {
        throw new Error(payload.error ?? 'Kunde inte ladda upp avtalsfilen.')
      }

      onAttachmentsChange(payload.attachments)
      if (payload.project) onProjectUpdated?.(payload.project)
      const uploadedAttachment = payload.attachments.find(
        (attachment) => attachment.attachmentType === 'document' && attachment.fileName === file.name
      )
      if (!uploadedAttachment) {
        throw new Error('Filen laddades upp men kunde inte kopplas till avtalet. Välj den från handlingbanken.')
      }

      updateSelection([...attachmentIds, uploadedAttachment.id])
      onAttachmentSelected?.(uploadedAttachment)
      setPreviewAttachmentId(uploadedAttachment.id)
      setStatusMessage(`${attachmentTitle(uploadedAttachment)} är uppladdad och kopplad.`)
    } catch (error) {
      setStatusMessage('Uppladdningen misslyckades.')
      showError(error, 'Kunde inte lägga till avtalsfilen.')
    } finally {
      setUploading(false)
      if (uploadInputRef.current) uploadInputRef.current.value = ''
    }
  }

  const handleUploadChange = (event: ChangeEvent<HTMLInputElement>) => {
    void uploadFile(event.target.files?.[0] ?? null)
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    void uploadFile(event.dataTransfer.files?.[0] ?? null)
  }

  const refreshPreview = async () => {
    if (!projectId || !previewAttachment) return
    try {
      setStatusMessage('Uppdaterar förhandsgranskningen…')
      const response = await fetch(`/api/eb/projects/${projectId}/attachments`, { cache: 'no-store' })
      const payload = (await response.json().catch(() => ({}))) as AttachmentsResponse
      if (!response.ok || !payload.attachments) {
        throw new Error(payload.error ?? 'Kunde inte uppdatera avtalsfilen.')
      }
      onAttachmentsChange(payload.attachments)
      if (payload.project) onProjectUpdated?.(payload.project)
      setStatusMessage('Förhandsgranskningen är uppdaterad.')
    } catch (error) {
      setStatusMessage('Kunde inte uppdatera förhandsgranskningen.')
      showError(error, 'Kunde inte uppdatera förhandsgranskningen.')
    }
  }

  const saveAttachmentTitle = async (attachment: EbProjectAttachment) => {
    if (!projectId || savingTitleId || titleEditingDisabled) return
    const title = (titleDrafts[attachment.id] ?? attachment.title ?? attachment.fileName ?? '').trim()
    const operationKey = titleStateKey(titleStateScope, attachment.id)
    if (!title) {
      const error = new Error('Ange ett namn som ska visas för PDF:en.')
      showError(error, 'Kunde inte spara PDF-namnet.')
      return
    }

    try {
      setSavingTitleId(attachment.id)
      onTitleSavingChange?.(operationKey, true)
      const response = await fetch(`/api/eb/projects/${projectId}/attachments/${attachment.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      })
      const payload = (await response.json().catch(() => ({}))) as AttachmentsResponse
      if (!response.ok || !payload.attachments) {
        throw new Error(payload.error ?? 'Kunde inte spara PDF-namnet.')
      }

      const projectUpdateAccepted = payload.project ? onProjectUpdated?.(payload.project) !== false : true
      if (projectUpdateAccepted) onAttachmentsChange(payload.attachments)
      setTitleDrafts((current) => {
        const next = { ...current }
        delete next[attachment.id]
        return next
      })
      onTitleDraftChange?.(operationKey, false)
      setStatusMessage(`${title} är nu PDF:ens namn i utlåtandet.`)
    } catch (error) {
      showError(error, 'Kunde inte spara PDF-namnet.')
    } finally {
      setSavingTitleId(null)
      onTitleSavingChange?.(operationKey, false)
    }
  }

  const uploadControls = projectId ? (
    <div
      onDragEnter={(event) => {
        event.preventDefault()
        if (!uploading) setDragging(true)
      }}
      onDragOver={(event) => {
        event.preventDefault()
        if (!uploading) {
          event.dataTransfer.dropEffect = 'copy'
          setDragging(true)
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={`rounded-md border border-dashed p-3 transition ${
        dragging ? 'border-emerald-500 bg-emerald-50' : 'border-emerald-200 bg-emerald-50/35'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <label
          htmlFor={inputId}
          className={`inline-flex cursor-pointer items-center gap-2 rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50 ${
            uploading ? 'pointer-events-none opacity-60' : ''
          }`}
        >
          {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
          {uploading ? 'Laddar upp…' : 'Ladda upp PDF'}
        </label>
        <input
          ref={uploadInputRef}
          id={inputId}
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          disabled={uploading}
          onChange={handleUploadChange}
        />
        <button
          ref={pickerTriggerRef}
          type="button"
          onClick={() => setPickerOpen(true)}
          disabled={uploading}
          className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Link2 size={16} />
          Välj bland handlingar
        </button>
      </div>
      <p className="mt-2 text-xs text-gray-600">Släpp en PDF här eller välj en handling som redan finns i entreprenaden.</p>
    </div>
  ) : (
    <p className="rounded-md border border-dashed border-emerald-200 bg-emerald-50/35 px-3 py-2 text-xs text-gray-600">
      Spara entreprenaden först för att kunna koppla avtalsfiler.
    </p>
  )

  return (
    <section className="mt-4 rounded-lg border border-emerald-100 bg-white p-3">
      <div className={previewAttachment && isPdf(previewAttachment) ? 'grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(380px,1.2fr)]' : ''}>
        <div>
          <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
            <div>
              <h4 className="text-sm font-semibold text-gray-950">{label}</h4>
              {description ? <p className="mt-1 text-xs text-gray-600">{description}</p> : null}
            </div>
            <span className="text-xs text-gray-500">{selectedAttachments.length} kopplad{selectedAttachments.length === 1 ? '' : 'e'}</span>
          </div>

          <div className="mt-3 space-y-2">
            {selectedAttachments.length === 0 ? (
              <p className="rounded-md border border-dashed border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
                Ingen handling är kopplad.
              </p>
            ) : (
              selectedAttachments.map((attachment) => (
                <div key={attachment.id} className="rounded-md border border-emerald-100 bg-emerald-50/35 px-3 py-2">
                  <div className="flex items-start gap-2">
                    <FileText size={17} className="mt-0.5 shrink-0 text-emerald-700" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-gray-900">{attachmentTitle(attachment)}</p>
                      {fileMeta(attachment) ? <p className="truncate text-xs text-gray-600">{fileMeta(attachment)}</p> : null}
                      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
                        <label className="min-w-0 flex-1">
                          <span className="block text-[11px] font-semibold text-gray-600">Namn i utlåtandet</span>
                          <input
                            value={titleDrafts[attachment.id] ?? attachment.title ?? attachment.fileName ?? ''}
                            onChange={(event) => {
                              const nextTitle = event.target.value
                              setTitleDrafts((current) => ({ ...current, [attachment.id]: nextTitle }))
                              onTitleDraftChange?.(
                                titleStateKey(titleStateScope, attachment.id),
                                nextTitle !== attachmentTitle(attachment)
                              )
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault()
                                void saveAttachmentTitle(attachment)
                              }
                            }}
                            disabled={savingTitleId === attachment.id || titleEditingDisabled}
                            className="mt-1 h-8 w-full rounded-md border border-emerald-200 bg-white px-2 text-xs text-gray-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                          />
                          <span className="mt-1 block text-[11px] text-gray-500">Visas i Avtal och utlåtandet. Originalfilens namn ändras inte.</span>
                        </label>
                        <button
                          type="button"
                          onClick={() => void saveAttachmentTitle(attachment)}
                          disabled={savingTitleId === attachment.id || titleEditingDisabled}
                          className="inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-md border border-emerald-200 bg-white px-2 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {savingTitleId === attachment.id ? <Loader2 size={13} className="animate-spin" /> : null}
                          Spara namn
                        </button>
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {isPdf(attachment) ? (
                        <button
                          type="button"
                          onClick={() => setPreviewAttachmentId(attachment.id)}
                          className="inline-flex h-8 items-center gap-1 rounded-md border border-emerald-200 bg-white px-2 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-50"
                        >
                          <Eye size={14} />
                          Visa
                        </button>
                      ) : null}
                      {attachment.signedUrl ? (
                        <a
                          href={attachment.signedUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-emerald-200 bg-white text-emerald-800 transition hover:bg-emerald-50"
                          aria-label={`Öppna ${attachmentTitle(attachment)} i ny flik`}
                          title="Öppna i ny flik"
                        >
                          <ExternalLink size={14} />
                        </a>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => removeAttachment(attachment)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-700 transition hover:bg-gray-50"
                        aria-label={`Ta bort kopplingen till ${attachmentTitle(attachment)}`}
                        title="Ta bort koppling"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="mt-3">{uploadControls}</div>
          <p aria-live="polite" className="mt-2 min-h-4 text-xs text-gray-600">{statusMessage}</p>
        </div>

        {previewAttachment && isPdf(previewAttachment) ? (
          <div className="overflow-hidden rounded-md border border-emerald-100 bg-gray-50">
            <div className="flex items-center justify-between gap-2 border-b border-emerald-100 bg-white px-3 py-2">
              <p className="truncate text-xs font-semibold text-gray-900">Förhandsgranskning: {attachmentTitle(previewAttachment)}</p>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => void refreshPreview()}
                  className="inline-flex h-7 w-7 items-center justify-center rounded border border-emerald-200 text-emerald-800 transition hover:bg-emerald-50"
                  aria-label="Uppdatera förhandsgranskning"
                  title="Uppdatera förhandsgranskning"
                >
                  <RefreshCw size={14} />
                </button>
                {previewAttachment.signedUrl ? (
                  <a
                    href={previewAttachment.signedUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-7 w-7 items-center justify-center rounded border border-emerald-200 text-emerald-800 transition hover:bg-emerald-50"
                    aria-label={`Öppna ${attachmentTitle(previewAttachment)} i ny flik`}
                    title="Öppna i ny flik"
                  >
                    <ExternalLink size={14} />
                  </a>
                ) : null}
                <button
                  type="button"
                  onClick={() => setPreviewAttachmentId(null)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded border border-gray-200 text-gray-700 transition hover:bg-gray-100"
                  aria-label="Stäng förhandsgranskning"
                  title="Stäng förhandsgranskning"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
            {previewAttachment.signedUrl ? (
              <iframe
                title={`Förhandsgranskning av ${attachmentTitle(previewAttachment)}`}
                src={previewAttachment.signedUrl}
                referrerPolicy="no-referrer"
                className="h-[34rem] w-full bg-white"
              />
            ) : (
              <p className="p-4 text-sm text-gray-600">PDF-filen kunde inte förhandsgranskas. Öppna den i en ny flik i stället.</p>
            )}
          </div>
        ) : null}
      </div>

      {pickerOpen ? (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/55 p-3" role="dialog" aria-modal="true" aria-labelledby={pickerTitleId}>
          <div className="max-h-[80vh] w-full max-w-2xl overflow-hidden rounded-lg border border-emerald-100 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-emerald-100 px-4 py-3">
              <div>
                <h5 id={pickerTitleId} className="text-base font-semibold text-gray-950">Välj handling</h5>
                <p className="mt-1 text-xs text-gray-600">Välj en befintlig handling utan att skapa en kopia.</p>
              </div>
              <button
                ref={pickerCloseRef}
                type="button"
                onClick={() => {
                  setPickerOpen(false)
                  window.setTimeout(() => pickerTriggerRef.current?.focus(), 0)
                }}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 text-gray-700 transition hover:bg-gray-50"
                aria-label="Stäng"
              >
                <X size={16} />
              </button>
            </div>
            <div className="max-h-[60vh] overflow-auto p-3">
              {documents.length === 0 ? (
                <p className="rounded-md border border-dashed border-gray-200 bg-gray-50 px-3 py-5 text-center text-sm text-gray-600">
                  Det finns inga uppladdade handlingar ännu.
                </p>
              ) : (
                <div className="space-y-2">
                  {documents.map((attachment) => {
                    const selected = attachmentIds.includes(attachment.id)
                    return (
                      <div key={attachment.id} className="flex items-center gap-3 rounded-md border border-gray-200 px-3 py-2">
                        <FileText size={18} className="shrink-0 text-emerald-700" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-gray-900">{attachmentTitle(attachment)}</p>
                          {fileMeta(attachment) ? <p className="truncate text-xs text-gray-600">{fileMeta(attachment)}</p> : null}
                        </div>
                        <button
                          type="button"
                          onClick={() => selected ? removeAttachment(attachment) : selectAttachment(attachment)}
                          className={`shrink-0 rounded-md border px-3 py-1.5 text-xs font-semibold transition ${
                            selected
                              ? 'border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100'
                              : 'border-emerald-200 bg-white text-emerald-800 hover:bg-emerald-50'
                          }`}
                        >
                          {selected ? 'Ta bort' : 'Välj'}
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
