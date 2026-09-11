'use client'

import { useRef, useState } from 'react'
import { ChevronDown, Send } from 'lucide-react'
import type { ObNoteSuggestion } from '@/lib/ob/noteSuggestion'
import Sheet from './ObRoundSheet'

export default function ObRoundNoteSuggestion({ initial, blocked, onSend, onClose, onSent }: {
  initial: ObNoteSuggestion
  blocked: boolean
  onSend: (suggestion: ObNoteSuggestion) => Promise<void>
  onClose: () => void
  onSent: () => void
}) {
  const [draft, setDraft] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const flight = useRef(false)
  const disabled = busy || blocked
  async function send() {
    if (disabled || flight.current || !draft.note.trim()) return
    flight.current = true
    setBusy(true)
    setError('')
    try {
      await onSend({ ...draft, note: draft.note.trim(), risk_text: draft.risk_text.trim(), ftu_text: draft.ftu_text.trim(), category: draft.category.trim() })
      onSent()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Förslaget kunde inte skickas. Försök igen.')
    } finally {
      flight.current = false
      setBusy(false)
    }
  }
  return <Sheet title="Föreslå notering" onClose={onClose} closeDisabled={busy}
    footer={<button type="button" className="obm-primary" disabled={disabled || !draft.note.trim()} onClick={() => void send()}>
      <Send size={18} />{busy ? 'Skickar…' : 'Skicka förslag'}
    </button>}>
    <p className="obm-muted">Till admin: en separat textkopia, utan bilder eller fastighetsadress. Ta bort eventuella personuppgifter ur texten före utskick.</p>
    {error && <p role="alert" className="obm-error">{error}</p>}
    <label className="obm-field">Rum eller byggnadsdel (valfritt)
      <input value={draft.category} maxLength={200} readOnly={disabled} onChange={e => setDraft({ ...draft, category: e.target.value })} />
    </label>
    <label className="obm-field">Förslag
      <textarea rows={6} value={draft.note} maxLength={20000} readOnly={disabled} onChange={e => setDraft({ ...draft, note: e.target.value })} />
    </label>
    <details className="obm-details" open={Boolean(draft.risk_text || draft.ftu_text) || undefined}>
      <summary>Risk och fortsatt teknisk utredning<ChevronDown size={18} /></summary>
      <label className="obm-field">Risk
        <textarea rows={4} value={draft.risk_text} maxLength={20000} readOnly={disabled} onChange={e => setDraft({ ...draft, risk_text: e.target.value })} />
      </label>
      <label className="obm-field">Fortsatt teknisk utredning
        <textarea rows={4} value={draft.ftu_text} maxLength={20000} readOnly={disabled} onChange={e => setDraft({ ...draft, ftu_text: e.target.value })} />
      </label>
    </details>
  </Sheet>
}
