'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Image as ImageIcon, MoveDown, MoveUp, Save, Trash2, Upload } from 'lucide-react'
import DebouncedTextarea from '@/components/ob/DebouncedTextarea'
import type { TuInvestigationDetails, TuReportDraft, TuReportSectionKey } from '@/lib/tu/server'

const TU_IMAGE_DRAG_DATA_TYPE = 'application/x-tu-image-id'
const IMAGE_FILE_ACCEPT = 'image/*'

type TuImageSectionKey = 'bank' | 'appendix'

type TuInvestigationImage = {
  id: string
  inspectionId: string
  orgId: string
  sectionKey: TuImageSectionKey
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
  image?: TuInvestigationImage
  images?: TuInvestigationImage[]
  error?: string
}

function cloneDraftWithSection(draft: TuReportDraft, key: TuReportSectionKey, text: string): TuReportDraft {
  return {
    sections: draft.sections.map((section) => (section.key === key ? { ...section, text } : section)),
  }
}

function formatSavedAt(value: string | null) {
  if (!value) return 'Inte sparad'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString('sv-SE', {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

function isImageFile(file: File) {
  return file.type.toLowerCase().startsWith('image/')
}

function hasDraggedTuImage(event: React.DragEvent) {
  return Array.from(event.dataTransfer.types).includes(TU_IMAGE_DRAG_DATA_TYPE)
}

function hasExternalImageFiles(event: React.DragEvent) {
  return Array.from(event.dataTransfer.types).includes('Files')
}

function getDroppedImageFiles(event: React.DragEvent) {
  return Array.from(event.dataTransfer.files).filter(isImageFile)
}

function sortTuImages(images: TuInvestigationImage[]) {
  return [...images].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
    return (a.createdAt ?? '').localeCompare(b.createdAt ?? '')
  })
}

function upsertImages(current: TuInvestigationImage[], updates: TuInvestigationImage[]) {
  const byId = new Map(current.map((image) => [image.id, image]))
  for (const image of updates) byId.set(image.id, image)
  return sortTuImages(Array.from(byId.values()))
}

export default function TuInvestigationEditorClient({
  initialInvestigation,
}: {
  initialInvestigation: TuInvestigationDetails
}) {
  const [investigation, setInvestigation] = useState(initialInvestigation)
  const [draft, setDraft] = useState<TuReportDraft>(initialInvestigation.reportDraft)
  const [title, setTitle] = useState(initialInvestigation.title)
  const [scopeDescription, setScopeDescription] = useState(initialInvestigation.scopeDescription ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [images, setImages] = useState<TuInvestigationImage[]>([])
  const [imagesLoading, setImagesLoading] = useState(true)
  const [imageBusy, setImageBusy] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)
  const [bankDropActive, setBankDropActive] = useState(false)
  const [appendixDropActive, setAppendixDropActive] = useState(false)
  const draftRef = useRef(initialInvestigation.reportDraft)
  const bankFileInputRef = useRef<HTMLInputElement>(null)
  const appendixFileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  useEffect(() => {
    let cancelled = false

    async function loadImages() {
      setImagesLoading(true)
      setImageError(null)
      try {
        const response = await fetch(`/api/tu/investigations/${initialInvestigation.inspectionId}/images`)
        const payload = (await response.json().catch(() => ({}))) as ImageApiResponse
        if (!response.ok) throw new Error(payload.error ?? 'Kunde inte hämta TU-bilder.')
        if (!cancelled) setImages(sortTuImages(payload.images ?? []))
      } catch (loadError) {
        if (!cancelled) {
          setImageError(loadError instanceof Error ? loadError.message : 'Kunde inte hämta TU-bilder.')
        }
      } finally {
        if (!cancelled) setImagesLoading(false)
      }
    }

    void loadImages()

    return () => {
      cancelled = true
    }
  }, [initialInvestigation.inspectionId])

  const savePatch = async (body: Record<string, unknown>) => {
    setSaveState('saving')
    setError(null)
    const response = await fetch(`/api/tu/investigations/${investigation.inspectionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      setSaveState('idle')
      throw new Error(payload.error ?? 'Kunde inte spara TU-utredningen.')
    }
    if (payload.investigation) {
      setInvestigation(payload.investigation)
      if (payload.investigation.reportDraft) {
        setDraft(payload.investigation.reportDraft)
        draftRef.current = payload.investigation.reportDraft
      }
    }
    setSaveState('saved')
  }

  const saveTitleAndScope = async () => {
    try {
      await savePatch({ title, scopeDescription })
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Kunde inte spara.')
    }
  }

  const saveSection = async (key: TuReportSectionKey, value: string) => {
    const nextDraft = cloneDraftWithSection(draftRef.current, key, value)
    draftRef.current = nextDraft
    setDraft(nextDraft)
    try {
      await savePatch({ reportDraft: nextDraft })
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Kunde inte spara avsnittet.')
      throw saveError
    }
  }

  const locked = Boolean(investigation.reportLockedAt)
  const bankImages = images.filter((image) => image.sectionKey !== 'appendix')
  const appendixImages = images.filter((image) => image.sectionKey === 'appendix')

  const uploadImages = async (files: File[], sectionKey: TuImageSectionKey) => {
    if (locked || files.length === 0) return
    const imageFiles = files.filter(isImageFile)
    if (imageFiles.length === 0) {
      setImageError('Endast bildfiler kan laddas upp.')
      return
    }

    setImageBusy(true)
    setImageError(null)
    try {
      const formData = new FormData()
      formData.set('sectionKey', sectionKey)
      for (const file of imageFiles) formData.append('files', file)

      const response = await fetch(`/api/tu/investigations/${investigation.inspectionId}/images`, {
        method: 'POST',
        body: formData,
      })
      const payload = (await response.json().catch(() => ({}))) as ImageApiResponse
      if (!response.ok) throw new Error(payload.error ?? 'Kunde inte ladda upp bilder.')
      setImages((current) => upsertImages(current, payload.images ?? []))
    } catch (uploadError) {
      setImageError(uploadError instanceof Error ? uploadError.message : 'Kunde inte ladda upp bilder.')
    } finally {
      setImageBusy(false)
    }
  }

  const patchImage = async (imageId: string, patch: Record<string, unknown>) => {
    if (locked) return null
    setImageBusy(true)
    setImageError(null)
    try {
      const response = await fetch(`/api/tu/investigations/${investigation.inspectionId}/images`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId, ...patch }),
      })
      const payload = (await response.json().catch(() => ({}))) as ImageApiResponse
      if (!response.ok) throw new Error(payload.error ?? 'Kunde inte spara bild.')
      if (payload.image) {
        setImages((current) => upsertImages(current, [payload.image as TuInvestigationImage]))
      }
      return payload.image ?? null
    } catch (patchError) {
      setImageError(patchError instanceof Error ? patchError.message : 'Kunde inte spara bild.')
      return null
    } finally {
      setImageBusy(false)
    }
  }

  const deleteImage = async (imageId: string) => {
    if (locked) return
    if (!confirm('Ta bort bilden?')) return
    setImageBusy(true)
    setImageError(null)
    try {
      const response = await fetch(`/api/tu/investigations/${investigation.inspectionId}/images`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId }),
      })
      const payload = (await response.json().catch(() => ({}))) as ImageApiResponse
      if (!response.ok) throw new Error(payload.error ?? 'Kunde inte ta bort bild.')
      setImages((current) => current.filter((image) => image.id !== imageId))
    } catch (deleteError) {
      setImageError(deleteError instanceof Error ? deleteError.message : 'Kunde inte ta bort bild.')
    } finally {
      setImageBusy(false)
    }
  }

  const nextSortOrderForSection = (sectionKey: TuImageSectionKey, excludeImageId: string) => {
    const sectionImages = images.filter((image) => {
      if (image.id === excludeImageId) return false
      return sectionKey === 'appendix' ? image.sectionKey === 'appendix' : image.sectionKey !== 'appendix'
    })
    return Math.max(0, ...sectionImages.map((image) => image.sortOrder)) + 10
  }

  const moveImageToSection = async (imageId: string, sectionKey: TuImageSectionKey) => {
    await patchImage(imageId, {
      sectionKey,
      sortOrder: nextSortOrderForSection(sectionKey, imageId),
    })
  }

  const handleDropToSection = async (event: React.DragEvent, sectionKey: TuImageSectionKey) => {
    event.preventDefault()
    setBankDropActive(false)
    setAppendixDropActive(false)
    if (locked) return

    const droppedFiles = getDroppedImageFiles(event)
    if (droppedFiles.length > 0) {
      await uploadImages(droppedFiles, sectionKey)
      return
    }

    const imageId = event.dataTransfer.getData(TU_IMAGE_DRAG_DATA_TYPE)
    if (imageId) {
      await moveImageToSection(imageId, sectionKey)
    }
  }

  const handleDragOverDropZone = (event: React.DragEvent) => {
    if (locked) return
    if (!hasExternalImageFiles(event) && !hasDraggedTuImage(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = hasExternalImageFiles(event) ? 'copy' : 'move'
  }

  const handleMoveAppendixImage = async (imageId: string, direction: -1 | 1) => {
    const currentIndex = appendixImages.findIndex((image) => image.id === imageId)
    const targetIndex = currentIndex + direction
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= appendixImages.length) return

    const reordered = [...appendixImages]
    const current = reordered[currentIndex]
    const target = reordered[targetIndex]
    reordered[currentIndex] = target
    reordered[targetIndex] = current

    const updates = reordered.map((image, index) => ({
      id: image.id,
      sortOrder: (index + 1) * 10,
    }))

    setImages((currentImages) =>
      sortTuImages(
        currentImages.map((image) => {
          const update = updates.find((item) => item.id === image.id)
          return update ? { ...image, sortOrder: update.sortOrder } : image
        })
      )
    )

    for (const update of updates) {
      await patchImage(update.id, { sortOrder: update.sortOrder })
    }
  }

  return (
    <main className="min-h-screen bg-violet-50/40">
      <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-5 md:px-6">
        <header className="space-y-4 border-b border-violet-100 pb-4">
          <Link
            href="/tu"
            className="inline-flex items-center gap-2 text-sm font-medium text-violet-800 hover:text-violet-950"
          >
            <ArrowLeft size={16} aria-hidden />
            Till TU
          </Link>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-700">TU-utlåtande</p>
              <h1 className="text-2xl font-semibold tracking-tight text-gray-950">{title}</h1>
              <p className="mt-1 text-sm text-gray-600">
                {investigation.property?.address || 'Ingen adress'} {investigation.property?.city || ''}
              </p>
            </div>
            <div className="rounded-md border border-violet-200 bg-white px-3 py-2 text-xs text-gray-600 shadow-sm">
              {saveState === 'saving' ? 'Sparar...' : `Sparad: ${formatSavedAt(investigation.updatedAt)}`}
            </div>
          </div>
        </header>

        {error ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {error}
          </div>
        ) : null}
        {locked ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Utlåtandet är låst och kan inte ändras.
          </div>
        ) : null}

        <section className="rounded-lg border border-violet-200 bg-white p-4 shadow-sm">
          <div className="grid gap-4 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
            <label className="space-y-1">
              <span className="block text-xs font-medium text-gray-600">Rubrik</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onBlur={() => void saveTitleAndScope()}
                disabled={locked}
                className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-950 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100 disabled:bg-gray-100 disabled:text-gray-500"
              />
            </label>
            <label className="space-y-1">
              <span className="block text-xs font-medium text-gray-600">Utredningens omfattning</span>
              <textarea
                value={scopeDescription}
                onChange={(event) => setScopeDescription(event.target.value)}
                onBlur={() => void saveTitleAndScope()}
                disabled={locked}
                rows={3}
                className="w-full resize-y rounded-md border border-gray-300 bg-white px-3 py-2 text-sm leading-6 text-gray-950 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100 disabled:bg-gray-100 disabled:text-gray-500"
              />
            </label>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <article className="rounded-lg border border-violet-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-gray-950">Bildbank</h2>
                <p className="mt-1 text-sm text-gray-600">Ladda upp bilder och dra dem till bildbilagan.</p>
              </div>
              <button
                type="button"
                onClick={() => bankFileInputRef.current?.click()}
                disabled={locked || imageBusy}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-violet-700 px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                <Upload size={16} aria-hidden />
                Ladda upp
              </button>
              <input
                ref={bankFileInputRef}
                type="file"
                accept={IMAGE_FILE_ACCEPT}
                multiple
                className="hidden"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? [])
                  event.target.value = ''
                  void uploadImages(files, 'bank')
                }}
              />
            </div>

            <div
              onDragEnter={() => !locked && setBankDropActive(true)}
              onDragLeave={() => setBankDropActive(false)}
              onDragOver={handleDragOverDropZone}
              onDrop={(event) => void handleDropToSection(event, 'bank')}
              className={`mb-4 flex min-h-28 flex-col items-center justify-center rounded-lg border border-dashed px-4 py-5 text-center transition ${
                bankDropActive
                  ? 'border-violet-500 bg-violet-50 text-violet-900'
                  : 'border-violet-200 bg-violet-50/50 text-gray-600'
              } ${locked ? 'opacity-60' : ''}`}
            >
              <ImageIcon size={24} className="mb-2 text-violet-500" aria-hidden />
              <p className="text-sm font-medium">Släpp bilder här</p>
              <p className="mt-1 text-xs text-gray-500">Eller dra tillbaka bilder från bilagan.</p>
            </div>

            {imagesLoading ? (
              <div className="rounded-md border border-violet-100 bg-violet-50 px-3 py-2 text-sm text-violet-800">
                Hämtar bilder...
              </div>
            ) : bankImages.length === 0 ? (
              <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-4 text-sm text-gray-600">
                Bildbanken är tom.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {bankImages.map((image) => (
                  <div
                    key={image.id}
                    draggable={!locked}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = 'move'
                      event.dataTransfer.setData(TU_IMAGE_DRAG_DATA_TYPE, image.id)
                    }}
                    className="overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={image.publicUrl} alt={image.caption ?? 'TU-bild'} className="aspect-square w-full object-cover" />
                    <div className="space-y-2 p-2">
                      <button
                        type="button"
                        onClick={() => void moveImageToSection(image.id, 'appendix')}
                        disabled={locked || imageBusy}
                        className="w-full rounded-md border border-violet-200 px-2 py-1.5 text-xs font-semibold text-violet-800 transition hover:bg-violet-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
                      >
                        Lägg i bilaga
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </article>

          <article className="rounded-lg border border-violet-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-gray-950">Bildbilaga</h2>
                <p className="mt-1 text-sm text-gray-600">Placera bilder och skriv en kort bildtext.</p>
              </div>
              <button
                type="button"
                onClick={() => appendixFileInputRef.current?.click()}
                disabled={locked || imageBusy}
                className="inline-flex h-10 items-center gap-2 rounded-md border border-violet-200 bg-white px-3 text-sm font-semibold text-violet-800 shadow-sm transition hover:bg-violet-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
              >
                <Upload size={16} aria-hidden />
                Direkt till bilaga
              </button>
              <input
                ref={appendixFileInputRef}
                type="file"
                accept={IMAGE_FILE_ACCEPT}
                multiple
                className="hidden"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? [])
                  event.target.value = ''
                  void uploadImages(files, 'appendix')
                }}
              />
            </div>

            <div
              onDragEnter={() => !locked && setAppendixDropActive(true)}
              onDragLeave={() => setAppendixDropActive(false)}
              onDragOver={handleDragOverDropZone}
              onDrop={(event) => void handleDropToSection(event, 'appendix')}
              className={`mb-4 flex min-h-28 flex-col items-center justify-center rounded-lg border border-dashed px-4 py-5 text-center transition ${
                appendixDropActive
                  ? 'border-violet-500 bg-violet-50 text-violet-900'
                  : 'border-violet-200 bg-violet-50/50 text-gray-600'
              } ${locked ? 'opacity-60' : ''}`}
            >
              <ImageIcon size={24} className="mb-2 text-violet-500" aria-hidden />
              <p className="text-sm font-medium">Släpp bilder i bilagan</p>
              <p className="mt-1 text-xs text-gray-500">Bilderna visas i den ordning de ligger här.</p>
            </div>

            {appendixImages.length === 0 ? (
              <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-4 text-sm text-gray-600">
                Bildbilagan är tom.
              </div>
            ) : (
              <div className="space-y-3">
                {appendixImages.map((image, index) => (
                  <div
                    key={image.id}
                    draggable={!locked}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = 'move'
                      event.dataTransfer.setData(TU_IMAGE_DRAG_DATA_TYPE, image.id)
                    }}
                    className="grid gap-3 rounded-md border border-gray-200 bg-white p-2 shadow-sm sm:grid-cols-[112px_minmax(0,1fr)_auto]"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={image.publicUrl} alt={image.caption ?? 'Bilagebild'} className="aspect-square w-full rounded-md object-cover sm:w-28" />
                    <label className="min-w-0 space-y-1">
                      <span className="block text-xs font-medium text-gray-600">Bildtext</span>
                      <textarea
                        value={image.caption ?? ''}
                        rows={3}
                        disabled={locked}
                        onChange={(event) => {
                          const caption = event.target.value
                          setImages((current) =>
                            current.map((currentImage) =>
                              currentImage.id === image.id ? { ...currentImage, caption } : currentImage
                            )
                          )
                        }}
                        onBlur={(event) => void patchImage(image.id, { caption: event.target.value })}
                        className="w-full resize-y rounded-md border border-gray-300 bg-white px-3 py-2 text-sm leading-5 text-gray-950 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100 disabled:bg-gray-100 disabled:text-gray-500"
                        placeholder="Kort beskrivande text"
                      />
                    </label>
                    <div className="flex items-center gap-2 sm:flex-col sm:items-stretch">
                      <button
                        type="button"
                        onClick={() => void handleMoveAppendixImage(image.id, -1)}
                        disabled={locked || imageBusy || index === 0}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-200 text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-300"
                        aria-label="Flytta upp"
                        title="Flytta upp"
                      >
                        <MoveUp size={16} aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleMoveAppendixImage(image.id, 1)}
                        disabled={locked || imageBusy || index === appendixImages.length - 1}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-200 text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-300"
                        aria-label="Flytta ned"
                        title="Flytta ned"
                      >
                        <MoveDown size={16} aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => void moveImageToSection(image.id, 'bank')}
                        disabled={locked || imageBusy}
                        className="rounded-md border border-violet-200 px-2 py-1.5 text-xs font-semibold text-violet-800 transition hover:bg-violet-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
                      >
                        Bildbank
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteImage(image.id)}
                        disabled={locked || imageBusy}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-rose-200 text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-300"
                        aria-label="Ta bort bild"
                        title="Ta bort bild"
                      >
                        <Trash2 size={16} aria-hidden />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </article>
        </section>

        {imageError ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {imageError}
          </div>
        ) : null}

        <section className="space-y-4">
          {draft.sections.map((section, index) => (
            <article key={section.key} className="rounded-lg border border-violet-100 bg-white p-4 shadow-sm">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-gray-950">
                  {index + 1}. {section.title}
                </h2>
                <Save size={16} className="text-violet-500" aria-hidden />
              </div>
              <DebouncedTextarea
                value={section.text}
                draftKey={`tu:${investigation.inspectionId}:${section.key}`}
                disabled={locked}
                rows={7}
                className="w-full resize-y rounded-md border border-gray-300 bg-white px-3 py-2 text-sm leading-6 text-gray-950 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100 disabled:bg-gray-100 disabled:text-gray-500"
                onValueChange={(value) => {
                  const nextDraft = cloneDraftWithSection(draftRef.current, section.key, value)
                  draftRef.current = nextDraft
                  setDraft(nextDraft)
                }}
                onSave={(value) => saveSection(section.key, value)}
              />
            </article>
          ))}
        </section>
      </div>
    </main>
  )
}
