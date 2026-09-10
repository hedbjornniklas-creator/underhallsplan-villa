'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Check, Image as ImageIcon, Loader2, Plus, Sparkles, X } from 'lucide-react'
import type { TuAnalysisResponse } from '@/lib/tu/analysis'
import {
  buildTuAppendixSuggestions,
  effectiveTuReportImageCaption,
  isGenericTuImageCaption,
  type TuAppendixSourceImage,
  type TuAppendixSuggestion,
} from '@/lib/tu/imageAppendix'

type ProposalRow = TuAppendixSuggestion & {
  selected: boolean
  source: 'ai' | 'manual'
}

export type TuAppendixProposalApplyResult = {
  succeededImageIds: string[]
  failedCount: number
}

type Props = {
  inspectionId: string
  images: Array<TuAppendixSourceImage & { publicUrl: string }>
  locked: boolean
  onClose: () => void
  onPreviewImage: (imageId: string) => void
  onApply: (rows: Array<{ imageId: string; reportCaption: string }>) => Promise<TuAppendixProposalApplyResult>
}

async function responseError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => ({})) as { error?: unknown }
  return typeof payload.error === 'string' && payload.error.trim() ? payload.error : fallback
}

function clean(value: string | null | undefined) {
  return value?.trim() ?? ''
}

export default function TuImageAppendixProposalDrawer({
  inspectionId,
  images,
  locked,
  onClose,
  onPreviewImage,
  onApply,
}: Props) {
  const [rows, setRows] = useState<ProposalRow[]>([])
  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState(false)
  const [showMoreImages, setShowMoreImages] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)
  const initialImagesRef = useRef(images)
  const imageById = useMemo(() => new Map(images.map((image) => [image.id, image])), [images])
  const selectedRows = rows.filter((row) => row.selected)
  const rowImageIds = new Set(rows.map((row) => row.imageId))
  const availableImages = images.filter((image) => image.sectionKey === 'bank' && !rowImageIds.has(image.id))

  useEffect(() => {
    let cancelled = false

    async function loadSuggestions() {
      setLoading(true)
      setLoadError(null)
      try {
        const response = await fetch(`/api/tu/investigations/${inspectionId}/analysis`, { cache: 'no-store' })
        if (!response.ok) {
          throw new Error(await responseError(response, 'Kunde inte hämta bildförslaget.'))
        }
        const payload = await response.json() as TuAnalysisResponse
        const suggestions = buildTuAppendixSuggestions({
          items: payload.workflow?.items ?? [],
          images: initialImagesRef.current,
        })
        if (!cancelled) {
          setRows(suggestions.map((suggestion) => ({ ...suggestion, selected: true, source: 'ai' })))
        }
      } catch {
        if (!cancelled) {
          setLoadError('Bildförslaget kunde inte hämtas. Du kan fortfarande välja bilder manuellt.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadSuggestions()
    return () => {
      cancelled = true
    }
  }, [inspectionId])

  const updateRow = (imageId: string, patch: Partial<ProposalRow>) => {
    setRows((current) => current.map((row) => row.imageId === imageId ? { ...row, ...patch } : row))
    setValidationError(null)
  }

  const moveRow = (imageId: string, direction: -1 | 1) => {
    setRows((current) => {
      const index = current.findIndex((row) => row.imageId === imageId)
      const targetIndex = index + direction
      if (index < 0 || targetIndex < 0 || targetIndex >= current.length) return current
      const next = [...current]
      const [moved] = next.splice(index, 1)
      next.splice(targetIndex, 0, moved)
      return next
    })
  }

  const addImage = (imageId: string) => {
    const image = imageById.get(imageId)
    if (!image) return
    const effectiveCaption = effectiveTuReportImageCaption(image)
    setRows((current) => [
      ...current,
      {
        imageId,
        caption: isGenericTuImageCaption(effectiveCaption) ? '' : effectiveCaption,
        groupLabel: 'Manuellt vald',
        reason: 'Bilden har lagts till manuellt för granskning.',
        sourceItemId: '',
        sortOrder: (current.length + 1) * 10,
        selected: true,
        source: 'manual',
      },
    ])
    setValidationError(null)
  }

  const handleApply = async () => {
    if (selectedRows.length === 0) {
      setValidationError('Välj minst en bild som ska läggas till i bilagan.')
      return
    }
    if (selectedRows.some((row) => isGenericTuImageCaption(row.caption))) {
      setValidationError('Skriv en beskrivande bildtext för varje vald bild.')
      return
    }

    setApplying(true)
    setValidationError(null)
    try {
      const result = await onApply(selectedRows.map((row) => ({
        imageId: row.imageId,
        reportCaption: clean(row.caption),
      })))
      if (result.failedCount > 0) {
        const succeeded = new Set(result.succeededImageIds)
        setRows((current) => current.filter((row) => !succeeded.has(row.imageId)))
        setValidationError(
          result.succeededImageIds.length > 0
            ? 'Några bilder lades till, men övriga kunde inte sparas. Försök igen.'
            : 'Bilderna kunde inte läggas till. Försök igen.'
        )
        return
      }
      onClose()
    } catch {
      setValidationError('Bildbilagan kunde inte sparas. Försök igen.')
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[80] bg-black/35" role="dialog" aria-modal="true" aria-labelledby="tu-appendix-proposal-title">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        onClick={() => !applying && onClose()}
        aria-label="Stäng bildförslaget"
      />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-4xl flex-col bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-gray-200 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-start gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-violet-50 text-violet-700">
              <Sparkles size={20} aria-hidden />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase text-violet-700">AI-förslag</p>
              <h2 id="tu-appendix-proposal-title" className="mt-0.5 text-xl font-semibold text-gray-950">
                Granska bildbilagan
              </h2>
              <p className="mt-1 max-w-2xl text-sm text-gray-600">
                Kontrollera urval, ordning och bildtexter. Inget förs till utlåtandet förrän du godkänner.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={applying}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-gray-200 text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-300"
            aria-label="Stäng"
            title="Stäng"
          >
            <X size={18} aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto bg-gray-50 px-4 py-5 sm:px-6">
          {loading ? (
            <div className="flex min-h-56 items-center justify-center gap-3 rounded-md border border-violet-100 bg-white text-sm font-medium text-violet-800">
              <Loader2 size={18} className="animate-spin" aria-hidden />
              Hämtar analysens bildförslag...
            </div>
          ) : (
            <div className="space-y-5">
              {loadError ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  {loadError}
                </div>
              ) : null}

              <section className="rounded-md border border-gray-200 bg-white">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-3">
                  <div>
                    <h3 className="font-semibold text-gray-950">Föreslaget urval</h3>
                    <p className="mt-0.5 text-xs text-gray-600">
                      Ordningen nedan blir ordningen i utskriften.
                    </p>
                  </div>
                  <span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-800">
                    {selectedRows.length} vald{selectedRows.length === 1 ? '' : 'a'}
                  </span>
                </div>

                {rows.length === 0 ? (
                  <div className="px-4 py-8 text-center">
                    <ImageIcon size={24} className="mx-auto text-gray-400" aria-hidden />
                    <p className="mt-2 text-sm font-medium text-gray-900">Analysen gav inget tydligt bildurval.</p>
                    <p className="mt-1 text-sm text-gray-600">Lägg till relevanta bilder manuellt nedan.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-200">
                    {rows.map((row, index) => {
                      const image = imageById.get(row.imageId)
                      if (!image) return null
                      const captionMissing = row.selected && isGenericTuImageCaption(row.caption)
                      return (
                        <article key={row.imageId} className={`grid gap-4 p-4 sm:grid-cols-[112px_minmax(0,1fr)_auto] ${row.selected ? '' : 'bg-gray-50 opacity-65'}`}>
                          <button
                            type="button"
                            onClick={() => onPreviewImage(row.imageId)}
                            className="overflow-hidden rounded-md border border-gray-200 bg-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-300"
                            aria-label="Visa bild i fullformat"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={image.publicUrl} alt={clean(row.caption) || 'Föreslagen bilagebild'} className="aspect-square h-full w-full object-cover" />
                          </button>
                          <div className="min-w-0 space-y-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded bg-violet-50 px-2 py-1 text-xs font-semibold text-violet-800">{row.groupLabel}</span>
                              <span className="text-xs text-gray-500">{row.source === 'ai' ? 'Föreslagen av AI' : 'Manuellt vald'}</span>
                            </div>
                            <p className="text-xs text-gray-600">{row.reason}</p>
                            <div>
                              <label htmlFor={`tu-appendix-caption-${row.imageId}`} className="text-xs font-semibold text-gray-800">Bildtext</label>
                              <textarea
                                id={`tu-appendix-caption-${row.imageId}`}
                                rows={2}
                                value={row.caption}
                                disabled={!row.selected || applying}
                                onChange={(event) => updateRow(row.imageId, { caption: event.target.value })}
                                className={`mt-1 w-full resize-y rounded-md border bg-white px-3 py-2 text-sm text-gray-950 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100 disabled:bg-gray-100 ${captionMissing ? 'border-amber-400' : 'border-gray-300'}`}
                                placeholder="Plats, byggnadsdel och vad bilden visar"
                              />
                              {captionMissing ? <p className="mt-1 text-xs font-medium text-amber-700">Bildtext behöver anges.</p> : null}
                            </div>
                          </div>
                          <div className="flex items-start gap-2 sm:flex-col">
                            <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-gray-200 bg-white px-2.5 text-xs font-semibold text-gray-800 hover:bg-gray-50">
                              <input
                                type="checkbox"
                                checked={row.selected}
                                disabled={applying}
                                onChange={(event) => updateRow(row.imageId, { selected: event.target.checked })}
                                className="h-4 w-4 accent-violet-700"
                              />
                              Ta med
                            </label>
                            <div className="flex gap-1">
                              <button
                                type="button"
                                onClick={() => moveRow(row.imageId, -1)}
                                disabled={applying || index === 0}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-300"
                                aria-label="Flytta bilden uppåt"
                                title="Flytta upp"
                              >
                                <ArrowUp size={16} aria-hidden />
                              </button>
                              <button
                                type="button"
                                onClick={() => moveRow(row.imageId, 1)}
                                disabled={applying || index === rows.length - 1}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-300"
                                aria-label="Flytta bilden nedåt"
                                title="Flytta ned"
                              >
                                <ArrowDown size={16} aria-hidden />
                              </button>
                            </div>
                          </div>
                        </article>
                      )
                    })}
                  </div>
                )}
              </section>

              <section className="rounded-md border border-gray-200 bg-white">
                <button
                  type="button"
                  onClick={() => setShowMoreImages((current) => !current)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                  aria-expanded={showMoreImages}
                >
                  <span>
                    <span className="block font-semibold text-gray-950">Lägg till fler bilder</span>
                    <span className="mt-0.5 block text-xs text-gray-600">{availableImages.length} bilder finns kvar i bildbanken.</span>
                  </span>
                  <Plus size={18} className={`text-violet-700 transition ${showMoreImages ? 'rotate-45' : ''}`} aria-hidden />
                </button>
                {showMoreImages ? (
                  availableImages.length === 0 ? (
                    <p className="border-t border-gray-200 px-4 py-4 text-sm text-gray-600">Inga fler bilder finns att lägga till.</p>
                  ) : (
                    <div className="grid grid-cols-3 gap-2 border-t border-gray-200 p-3 sm:grid-cols-5 md:grid-cols-6">
                      {availableImages.map((image) => (
                        <button
                          key={image.id}
                          type="button"
                          onClick={() => addImage(image.id)}
                          disabled={applying}
                          className="group relative overflow-hidden rounded-md border border-gray-200 bg-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-300"
                          aria-label="Lägg till bilden i förslaget"
                          title="Lägg till i förslaget"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={image.publicUrl} alt={effectiveTuReportImageCaption(image) || 'Bildbanksbild'} className="aspect-square w-full object-cover" />
                          <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition group-hover:bg-black/35 group-hover:opacity-100">
                            <Plus size={22} aria-hidden />
                          </span>
                        </button>
                      ))}
                    </div>
                  )
                ) : null}
              </section>

              {validationError ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
                  {validationError}
                </div>
              ) : null}
            </div>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 bg-white px-4 py-4 sm:px-6">
          <p className="text-xs text-gray-600">Befintliga bilder i bilagan påverkas inte.</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={applying}
              className="inline-flex h-10 items-center rounded-md border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400"
            >
              Avbryt
            </button>
            <button
              type="button"
              onClick={() => void handleApply()}
              disabled={loading || applying || locked || selectedRows.length === 0}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-violet-700 px-4 text-sm font-semibold text-white shadow-sm hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-gray-300"
              aria-busy={applying}
            >
              {applying ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Check size={16} aria-hidden />}
              {applying ? 'Lägger till...' : `Lägg till ${selectedRows.length} i bilagan`}
            </button>
          </div>
        </footer>
      </aside>
    </div>
  )
}
