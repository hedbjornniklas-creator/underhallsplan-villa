'use client'

import { useRef, useState } from 'react'
import { MapPin, Trash2, Unlink } from 'lucide-react'
import type { ObMobileRoundProps } from './ObMobileRound'
import type { InspectionControlItem as Note, RoundImage } from './ObStepRunda'
import Sheet from './ObRoundSheet'

export default function ObRoundImageActions({ image, note, place, p, onClose, onUnlinked, onDelete }: {
  image: RoundImage
  note: Note
  place: string
  p: ObMobileRoundProps
  onClose: () => void
  onUnlinked: () => void
  onDelete: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const flight = useRef(false)
  const blocked = p.locked || p.mutationBlocked || busy || Boolean(image.local_queue_id)
  async function unlink() {
    if (blocked || flight.current) return
    flight.current = true
    setBusy(true)
    setError('')
    try {
      await p.onUnlinkImage(image, note)
      onUnlinked()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunde inte koppla loss bilden.')
    } finally {
      flight.current = false
      setBusy(false)
    }
  }
  return (
    <Sheet title="Ta bort bild" closeDisabled={busy}
      onClose={() => { if (!flight.current) onClose() }}
      footer={
        <div className="obm-image-removal-actions">
          <button type="button" className="obm-primary" disabled={blocked} onClick={() => void unlink()}>
            <Unlink size={18} />
            {busy ? 'Kopplar loss…' : 'Ta bort från noteringen'}
          </button>
          <button type="button" className="obm-delete-icon" disabled={blocked} onClick={onDelete}>
            <Trash2 size={18} />
            Radera från besiktningen
          </button>
        </div>
      }
    >
      <p className="obm-place-label"><MapPin size={16} />{place}</p>
      <img className="obm-photo-preview" src={p.imageSrc(image)} alt={image.label || 'Bild till noteringen'} />
      {error && <p role="alert" className="obm-error">{error}</p>}
      {p.mutationBlocked && <p role="status" className="obm-muted">Sparande eller bilduppladdning pågår.</p>}
    </Sheet>
  )
}
