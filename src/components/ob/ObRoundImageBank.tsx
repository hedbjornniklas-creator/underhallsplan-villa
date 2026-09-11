'use client'

import { useRef, useState } from 'react'
import { Link as LinkIcon, MapPin, Search } from 'lucide-react'
import { matchesWords } from '@/lib/ob/roundSearch'
import type { ObMobileRoundProps } from './ObMobileRound'
import type { InspectionControlItem as Note, RoundImage } from './ObStepRunda'
import Sheet from './ObRoundSheet'

export default function ObRoundImageBank({ note, place, imagePlace, p, onClose }: {
  note: Note
  place: string
  imagePlace: (image: RoundImage) => string
  p: ObMobileRoundProps
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const flight = useRef(false)
  const images = p.images.filter(image => !image.control_item_id && image.processing_status !== 'ignored')
  const available = images.filter(image => !image.local_queue_id)
  const selected = available.filter(image => selectedIds.has(image.id))
  const blocked = p.locked || p.mutationBlocked || busy
  function groupOf(image: RoundImage) {
    const hasPlace = Boolean(image.interior_room_id || image.exterior_observation_id)
    const roomId = image.interior_room_id || (!hasPlace ? image.origin_interior_room_id : null)
    const observationId = image.exterior_observation_id || (!hasPlace ? image.origin_exterior_observation_id : null)
    const itemId = p.observations.find(row => row.id === observationId)?.exterior_item_id ||
      (!hasPlace ? image.origin_exterior_item_id : null)
    const samePlace = roomId ? roomId === note.interior_room_id : Boolean(itemId && p.observations.some(
      row => row.id === note.exterior_observation_id && row.exterior_item_id === itemId,
    ))
    return samePlace ? 0 : roomId || observationId || itemId ? 1 : 2
  }
  const matching = images.filter(image => matchesWords(`${imagePlace(image)} ${image.label || ''}`, query))
  async function link() {
    if (blocked || flight.current || !selected.length) return
    flight.current = true
    setBusy(true)
    setError('')
    try {
      if (!(await p.onLinkImages(selected, note))) throw Error('Bilderna kunde inte kopplas klart. Försök igen.')
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bilderna kunde inte kopplas. Försök igen.')
    } finally {
      flight.current = false
      setBusy(false)
    }
  }
  return (
    <Sheet
      title="Bildbank"
      closeDisabled={busy}
      onClose={() => { if (!flight.current) onClose() }}
      footer={
        <button className="obm-primary" disabled={blocked || !selected.length} onClick={() => void link()}>
          <LinkIcon size={18} />
          {busy ? 'Kopplar…' : selected.length ? `Koppla ${selected.length} ${selected.length === 1 ? 'bild' : 'bilder'}` : 'Koppla bilder'}
        </button>
      }
    >
      <p className="obm-place-label"><MapPin size={16} />{place}</p>
      <label className="obm-search">
        <Search size={20} />
        <input aria-label="Sök i bildbanken" placeholder="Sök rum eller bild…" value={query}
          disabled={busy} onChange={event => setQuery(event.target.value)} />
      </label>
      {error && <p className="obm-error" role="alert">{error}</p>}
      {p.mutationBlocked && <p className="obm-muted" role="status">Sparande eller bilduppladdning pågår.</p>}
      {['Samma plats', 'Övriga platser', 'Utan plats'].map((label, group) => {
        const rows = matching.filter(image => groupOf(image) === group)
        return rows.length > 0 && (
          <section className="obm-image-bank-group" key={label}>
            <div className="obm-section-title"><h3>{label}</h3><span>{rows.length}</span></div>
            <div className="obm-image-bank-grid">
              {rows.map(image => (
                <label className="obm-image-bank-item" key={image.id} data-bank-image-id={image.id}>
                  <img src={p.imageSrc(image)} alt={image.label || 'Besiktningsbild'} loading="lazy" decoding="async" />
                  <span>
                    <input type="checkbox" checked={selectedIds.has(image.id)}
                      aria-label={`Välj ${image.label || 'bild'}: ${imagePlace(image)}`}
                      disabled={blocked || Boolean(image.local_queue_id)}
                      onChange={event => {
                        const checked = event.target.checked
                        setSelectedIds(previous => {
                          const next = new Set(previous)
                          if (checked) next.add(image.id)
                          else next.delete(image.id)
                          return next
                        })
                      }} />
                    <span>{imagePlace(image)}{image.local_queue_id && <small>Väntar på uppladdning</small>}</span>
                  </span>
                </label>
              ))}
            </div>
          </section>
        )
      })}
      {!matching.length && <p className="obm-empty">{images.length ? 'Inga bilder matchar sökningen.' : 'Inga ohanterade bilder.'}</p>}
    </Sheet>
  )
}
