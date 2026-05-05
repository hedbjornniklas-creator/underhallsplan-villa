'use client'

import { ChangeEvent, useEffect, useRef } from 'react'

export type ControlPointSearchMode = 'control_points' | 'chips'

export type ControlPointSearchResult = {
  id: string
  key: string
  title?: string | null
  label?: string | null
  description?: string | null
  search_hint?: string | null
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
  scopeLabelForResult: (result: T) => string
  onSearchModeChange: (mode: ControlPointSearchMode) => void
  onSearchChange: (event: ChangeEvent<HTMLInputElement>) => void
  onSelect: (result: T) => void
  onClose: () => void
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
  scopeLabelForResult,
  onSearchModeChange,
  onSearchChange,
  onSelect,
  onClose,
}: ControlPointSearchDialogProps<T>) {
  const inputRef = useRef<HTMLInputElement | null>(null)

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

  return (
    <div className="fixed inset-0 z-50 bg-white md:bg-black/35">
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
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-700 hover:bg-gray-100')
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
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-700 hover:bg-gray-100')
                }
              >
                Chips
              </button>
            </div>
            <input
              ref={inputRef}
              className="w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-base text-gray-900 placeholder:text-gray-500 focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
              placeholder={searchMode === 'chips' ? chipPlaceholder : controlPointPlaceholder}
              value={searchTerm}
              onChange={onSearchChange}
              readOnly={disabled}
            />
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

          {!searching && searchTerm.trim().length >= 2 && searchResults.length === 0 && (
            <div className="rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm text-gray-600">
              {searchMode === 'chips' ? 'Inga chips' : 'Inga kontrollpunkter'} hittades för &quot;{searchTerm.trim()}&quot;.
            </div>
          )}

          {!searching && searchResults.length > 0 && (
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
