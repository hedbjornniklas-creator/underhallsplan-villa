'use client'
import React, { useRef, useState } from 'react'
import { ChevronDown, PenLine, Search, X } from 'lucide-react'
import {
  matchesWords,
  noteMatchRank,
  unfinishedFields,
} from '@/lib/ob/roundSearch'
import type { ImageNoteDraft } from '@/lib/ob/roundMutations'
import type {
  ControlPointLite as Point,
  ControlPointOutcome as Outcome,
} from '@/components/ob/ObStepRunda'

export type ImageNoteCatalog = {
  points: Point[]
  outcomes: Outcome[]
  loading: boolean
  error: string
  reload: () => void
}
export default function ImageNoteForm({
  draft,
  onChange,
  catalog,
  disabled,
}: {
  draft: ImageNoteDraft
  onChange: (draft: ImageNoteDraft) => void
  catalog: ImageNoteCatalog
  disabled: boolean
}) {
  const [query, setQuery] = useState(''),
    [limit, setLimit] = useState(8),
    text = useRef<HTMLTextAreaElement>(null)
  const pointMap = new Map(catalog.points.map((point) => [point.id, point]))
  const selected = catalog.outcomes.find(
    (outcome) => outcome.id === draft.outcomeId,
  )
  const matching = query.trim()
    ? catalog.outcomes
        .filter((outcome) => {
          const point = pointMap.get(outcome.control_point_id)
          return (
            point &&
            matchesWords(
              [
                outcome.label,
                outcome.note_template,
                outcome.risk_template,
                outcome.ftu_template,
                point.title,
                point.key,
                JSON.stringify(point.tags),
              ].join(' '),
              query,
            )
          )
        })
        .sort(
          (a, b) =>
            noteMatchRank(b, query) - noteMatchRank(a, query) ||
            a.sort_order - b.sort_order,
        )
    : []
  function choose(outcome: Outcome) {
    onChange({
      outcomeId: outcome.id,
      note: outcome.note_template ?? '',
      risk_text: outcome.risk_template ?? '',
      ftu_text: outcome.ftu_template ?? '',
    })
    setQuery('')
    text.current?.focus()
  }
  return (
    <div className="obm-new-image-note">
      <label className="obm-search">
        <Search size={20} />
        <input
          type="search"
          aria-label="Sök noteringsförslag"
          placeholder="Sök noteringsförslag…"
          value={query}
          disabled={disabled}
          onChange={(e) => {
            setQuery(e.target.value)
            setLimit(8)
          }}
        />
        {query && (
          <button
            className="obm-icon"
            title="Rensa sökning"
            aria-label="Rensa sökning"
            disabled={disabled}
            onClick={() => setQuery('')}
          >
            <X size={18} />
          </button>
        )}
      </label>
      {catalog.loading && (
        <p role="status" className="obm-category-label">
          Läser noteringsförslag…
        </p>
      )}
      {catalog.error && (
        <>
          <p role="alert" className="obm-error">
            {catalog.error}
          </p>
          <button
            className="obm-text-action"
            disabled={disabled || catalog.loading}
            onClick={catalog.reload}
          >
            Försök läsa förslagen igen
          </button>
        </>
      )}
      {query.trim() && !catalog.loading && !catalog.error && (
        <div className="obm-image-note-results">
          <p role="status">{matching.length} förslag</p>
          {matching.slice(0, limit).map((outcome) => (
            <button
              key={outcome.id}
              data-new-outcome-id={outcome.id}
              className="obm-image-note-suggestion"
              disabled={disabled}
              onClick={() => choose(outcome)}
            >
              <small>{pointMap.get(outcome.control_point_id)?.title}</small>
              <strong>{outcome.label}</strong>
              <span>{outcome.note_template}</span>
            </button>
          ))}
          {matching.length > limit && (
            <button
              className="obm-text-action"
              disabled={disabled}
              onClick={() => setLimit((value) => value + 8)}
            >
              Visa fler förslag
            </button>
          )}
        </div>
      )}
      {selected && (
        <div className="obm-image-note-selected">
          <span>{selected.label}</span>
          <button
            className="obm-icon"
            title="Använd som fri notering"
            aria-label="Använd som fri notering"
            disabled={disabled}
            onClick={() => onChange({ ...draft, outcomeId: null })}
          >
            <PenLine size={18} />
          </button>
        </div>
      )}
      <label className="obm-field">
        Notering
        <textarea
          ref={text}
          aria-label="Ny notering"
          placeholder="Skriv vad du ser…"
          rows={4}
          disabled={disabled}
          value={draft.note}
          onChange={(e) => onChange({ ...draft, note: e.target.value })}
        />
      </label>
      {unfinishedFields(draft).length > 0 && (
        <p role="status" className="obm-unfinished">
          Mallfält kvar: {unfinishedFields(draft).join(', ')}
        </p>
      )}
      <details
        className="obm-details"
        key={draft.outcomeId || 'free'}
        open={Boolean(draft.risk_text || draft.ftu_text) || undefined}
      >
        <summary>
          Risk och fortsatt teknisk utredning
          <ChevronDown size={18} />
        </summary>
        <label className="obm-field">
          Risk
          <textarea
            aria-label="Ny risktext"
            rows={3}
            disabled={disabled}
            value={draft.risk_text}
            onChange={(e) => onChange({ ...draft, risk_text: e.target.value })}
          />
        </label>
        <label className="obm-field">
          Fortsatt teknisk utredning
          <textarea
            aria-label="Ny utredningstext"
            rows={3}
            disabled={disabled}
            value={draft.ftu_text}
            onChange={(e) => onChange({ ...draft, ftu_text: e.target.value })}
          />
        </label>
      </details>
    </div>
  )
}
