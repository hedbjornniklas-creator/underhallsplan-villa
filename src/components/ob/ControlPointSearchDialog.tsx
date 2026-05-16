'use client'

import { ChangeEvent, TouchEvent, useEffect, useRef, useState } from 'react'

export type ControlPointSearchMode = 'control_points' | 'chips' | 'ai'

export type ControlPointSearchResult = {
  id: string
  key: string
  title?: string | null
  label?: string | null
  description?: string | null
  search_hint?: string | null
  match_score?: number | null
  scope?: string | null
  exterior_item_key?: string | null
  outcomes?: Array<{
    id?: string | null
    outcome_key?: string | null
    label?: string | null
    severity?: string | number | null
    note_template?: string | null
    risk_template?: string | null
    ftu_template?: string | null
    sort_order?: number | null
  }>
}

type ControlPointSearchDialogProps<T extends ControlPointSearchResult> = {
  open: boolean
  title: string
  contextLabel: string
  searchMode: ControlPointSearchMode
  searchTerm: string
  searchResults: T[]
  searching: boolean
  disabled?: boolean
  controlPointPlaceholder: string
  chipPlaceholder: string
  aiPlaceholder?: string
  showAiMode?: boolean
  aiSearchHasRun?: boolean
  onRunAiSearch?: () => void | Promise<void>
  scopeLabelForResult: (result: T) => string
  onSearchModeChange: (mode: ControlPointSearchMode) => void
  onSearchChange: (event: ChangeEvent<HTMLInputElement>) => void
  onSelect: (result: T) => void
  onClose: () => void
}

type AiResultCarouselProps<T extends ControlPointSearchResult> = {
  results: T[]
  disabled: boolean
  scopeLabelForResult: (result: T) => string
  onSelect: (result: T) => void
}

const formatMatchScore = (score: number | null | undefined) => {
  if (typeof score !== 'number' || !Number.isFinite(score)) return null
  return `${Math.round(score * 100)}%`
}

const previewText = (value: string | null | undefined, maxLength = 180) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

function AiResultCarousel<T extends ControlPointSearchResult>({
  results,
  disabled,
  scopeLabelForResult,
  onSelect,
}: AiResultCarouselProps<T>) {
  const touchStartXRef = useRef<number | null>(null)
  const [activeResultIndex, setActiveResultIndex] = useState(0)
  const activeResult = results[Math.min(activeResultIndex, results.length - 1)]

  if (!activeResult) return null

  const goToPreviousResult = () => {
    setActiveResultIndex(prev => Math.max(prev - 1, 0))
  }

  const goToNextResult = () => {
    setActiveResultIndex(prev => Math.min(prev + 1, results.length - 1))
  }

  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    touchStartXRef.current = event.touches[0]?.clientX ?? null
  }

  const handleTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    const startX = touchStartXRef.current
    touchStartXRef.current = null
    if (startX === null) return

    const endX = event.changedTouches[0]?.clientX ?? startX
    const deltaX = endX - startX
    if (Math.abs(deltaX) < 45) return
    if (deltaX < 0) {
      goToNextResult()
    } else {
      goToPreviousResult()
    }
  }

  const matchScore = formatMatchScore(activeResult.match_score)
  const outcomes = activeResult.outcomes ?? []

  return (
    <div className="space-y-3">
      <div
        className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-600">
            Förslag {activeResultIndex + 1} av {results.length}
          </span>
          <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-600">
            {scopeLabelForResult(activeResult)}
          </span>
          {matchScore && (
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
              {matchScore}
            </span>
          )}
        </div>

        <div className="mt-3">
          <h4 className="text-lg font-semibold leading-6 text-gray-950">
            {activeResult.title || activeResult.label || activeResult.key}
          </h4>
          {activeResult.description && (
            <p className="mt-2 text-sm leading-6 text-gray-700">
              {activeResult.description}
            </p>
          )}
          {activeResult.search_hint && (
            <p className="mt-2 text-xs font-medium text-gray-500">
              {activeResult.search_hint}
            </p>
          )}
        </div>

        <div className="mt-4 space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Noteringar
          </div>
          {outcomes.length > 0 ? (
            <div className="space-y-2">
              {outcomes.slice(0, 8).map((outcome, index) => (
                <div
                  key={outcome.id ?? outcome.outcome_key ?? outcome.label ?? index}
                  className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">
                      {outcome.label || outcome.outcome_key || 'Notering'}
                    </span>
                    {outcome.severity !== null && outcome.severity !== undefined && (
                      <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[10px] text-gray-600">
                        {outcome.severity}
                      </span>
                    )}
                  </div>
                  {previewText(outcome.note_template) && (
                    <p className="mt-1 text-xs leading-5 text-gray-600">
                      <span className="font-medium text-gray-700">Notering: </span>
                      {previewText(outcome.note_template)}
                    </p>
                  )}
                  {previewText(outcome.risk_template, 140) && (
                    <p className="mt-1 text-xs leading-5 text-gray-600">
                      <span className="font-medium text-gray-700">Risk: </span>
                      {previewText(outcome.risk_template, 140)}
                    </p>
                  )}
                  {previewText(outcome.ftu_template, 140) && (
                    <p className="mt-1 text-xs leading-5 text-gray-600">
                      <span className="font-medium text-gray-700">FTU: </span>
                      {previewText(outcome.ftu_template, 140)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
              Inga noteringar kopplade till kontrollpunkten.
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => onSelect(activeResult)}
          className="mt-4 w-full rounded-xl bg-indigo-600 px-3 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-50 disabled:text-indigo-700 disabled:ring-1 disabled:ring-indigo-200"
          disabled={disabled}
        >
          Lägg till kontrollpunkt
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={goToPreviousResult}
          disabled={activeResultIndex === 0}
          className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Föregående
        </button>
        <button
          type="button"
          onClick={goToNextResult}
          disabled={activeResultIndex >= results.length - 1}
          className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Nästa
        </button>
      </div>
    </div>
  )
}

export default function ControlPointSearchDialog<T extends ControlPointSearchResult>({
  open,
  title,
  contextLabel,
  searchMode,
  searchTerm,
  searchResults,
  searching,
  disabled = false,
  controlPointPlaceholder,
  chipPlaceholder,
  aiPlaceholder,
  showAiMode = false,
  aiSearchHasRun = false,
  onRunAiSearch,
  scopeLabelForResult,
  onSearchModeChange,
  onSearchChange,
  onSelect,
  onClose,
}: ControlPointSearchDialogProps<T>) {
  const inputRef = useRef<HTMLInputElement | null>(null)

  const handleRunAiSearch = () => {
    if (!onRunAiSearch) return
    void Promise.resolve(onRunAiSearch()).finally(() => {
      inputRef.current?.blur()
    })
  }

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 50)

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.clearTimeout(focusTimer)
      window.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [open, onClose])

  if (!open) return null

  const emptyStateEnabled = searchMode !== 'ai' || aiSearchHasRun
  const currentPlaceholder =
    searchMode === 'chips'
      ? chipPlaceholder
      : searchMode === 'ai'
        ? aiPlaceholder ?? controlPointPlaceholder
        : controlPointPlaceholder
  const aiResultKey = searchResults.map(result => result.id).join('|')

  return (
    <div className="fixed inset-0 z-[120] bg-white md:bg-black/35">
      <div
        className="flex h-dvh w-full flex-col bg-white md:absolute md:left-1/2 md:top-1/2 md:h-[min(760px,88vh)] md:max-h-[88vh] md:w-[min(720px,calc(100vw-32px))] md:-translate-x-1/2 md:-translate-y-1/2 md:overflow-hidden md:rounded-2xl md:shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="shrink-0 border-b border-gray-200 bg-white px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-gray-900">{title}</h3>
              <p className="mt-0.5 truncate text-xs text-gray-600">{contextLabel}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-full border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50"
            >
              Stäng
            </button>
          </div>

          <div className="mt-3 flex flex-col gap-2">
            <div className="inline-flex w-fit rounded-md border border-gray-300 bg-white p-0.5">
              <button
                type="button"
                onClick={() => onSearchModeChange('control_points')}
                className={
                  'rounded px-3 py-1.5 text-xs font-medium ' +
                  (searchMode === 'control_points'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-700 hover:bg-slate-100')
                }
              >
                Kontrollpunkter
              </button>
              <button
                type="button"
                onClick={() => onSearchModeChange('chips')}
                className={
                  'rounded px-3 py-1.5 text-xs font-medium ' +
                  (searchMode === 'chips'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-700 hover:bg-slate-100')
                }
              >
                Noteringar
              </button>
              {showAiMode && (
                <button
                  type="button"
                  onClick={() => onSearchModeChange('ai')}
                  className={
                    'rounded px-3 py-1.5 text-xs font-medium ' +
                    (searchMode === 'ai'
                      ? 'bg-violet-600 text-white'
                      : 'text-violet-700 hover:bg-violet-50')
                  }
                >
                  AI-sök
                </button>
              )}
            </div>
            <input
              ref={inputRef}
              className="w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-base text-gray-900 placeholder:text-gray-500 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              placeholder={currentPlaceholder}
              value={searchTerm}
              onChange={onSearchChange}
              readOnly={disabled}
            />
            {searchMode === 'ai' && onRunAiSearch && (
              <button
                type="button"
                onClick={handleRunAiSearch}
                disabled={disabled || searching || searchTerm.trim().length < 2}
                className="rounded-xl bg-violet-600 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-violet-50 disabled:text-violet-700 disabled:ring-1 disabled:ring-violet-200"
              >
                Sök med AI
              </button>
            )}
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto bg-gray-50 px-3 py-3">
          {searching && (
            <div className="rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm text-gray-600">
              Söker...
            </div>
          )}

          {!searching && searchTerm.trim().length < 2 && (
            <div className="rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm text-gray-600">
              Skriv minst 2 tecken för att söka.
            </div>
          )}

          {!searching && emptyStateEnabled && searchTerm.trim().length >= 2 && searchResults.length === 0 && (
            <div className="rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm text-gray-600">
              {searchMode === 'chips'
                ? 'Inga noteringar'
                : searchMode === 'ai'
                  ? 'Inga AI-träffar'
                  : 'Inga kontrollpunkter'} hittades för &quot;{searchTerm.trim()}&quot;.
            </div>
          )}

          {!searching && searchMode === 'ai' && searchResults.length > 0 && (
            <AiResultCarousel
              key={aiResultKey}
              results={searchResults}
              disabled={disabled}
              scopeLabelForResult={scopeLabelForResult}
              onSelect={onSelect}
            />
          )}

          {!searching && searchMode !== 'ai' && searchResults.length > 0 && (
            <div className="space-y-2">
              {searchResults.map(result => (
                <button
                  key={result.id}
                  type="button"
                  onClick={() => onSelect(result)}
                  className="flex w-full flex-col items-start rounded-xl border border-gray-200 bg-white px-3 py-3 text-left shadow-sm hover:border-gray-300 hover:bg-gray-50"
                  disabled={disabled}
                >
                  <span className="text-sm font-semibold text-gray-900">
                    {result.title || result.label || result.key}
                  </span>
                  <span className="mt-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] text-gray-600">
                    {scopeLabelForResult(result)}
                  </span>
                  {result.description && (
                    <span className="mt-2 text-xs leading-5 text-gray-600">
                      {result.description}
                    </span>
                  )}
                  {result.search_hint && (
                    <span className="mt-1 text-xs text-gray-600">
                      {result.search_hint}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
