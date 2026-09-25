'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, RotateCcw, Trash2 } from 'lucide-react'
import type { TrashedRoundImage } from '@/lib/ob/imageTrash'
import type { ObMobileRoundProps } from './ObMobileRound'
import { useToast } from '@/components/ui/AppToastProvider'
import Sheet from './ObRoundSheet'

export default function ObRoundImageTrash({ p, imagePlace }: {
  p: ObMobileRoundProps
  imagePlace: (image: TrashedRoundImage['image']) => string
}) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<TrashedRoundImage[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [revision, setRevision] = useState(0)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [preview, setPreview] = useState<TrashedRoundImage | null>(null)
  const sequence = useRef(0)
  const flight = useRef(false)
  const loader = useRef(p.onLoadImageTrash)
  const retries = useRef(new Map<string, string>())
  useEffect(() => { loader.current = p.onLoadImageTrash }, [p.onLoadImageTrash])
  const fetchPage = useCallback(async (before?: string) => {
    const current = ++sequence.current
    setLoading(true)
    setFailed(false)
    try {
      const result = await loader.current(before)
      if (current !== sequence.current) return
      setItems(rows => before ? [...rows, ...result.items.filter(item => !rows.some(row => row.eventId === item.eventId))] : result.items)
      setCursor(result.nextCursor)
      setLoaded(true)
    } catch {
      if (current === sequence.current) setFailed(true)
    } finally {
      if (current === sequence.current) setLoading(false)
    }
  }, [])
  const version = p.images.map(image => image.id).join(',')
  useEffect(() => {
    const counter = sequence
    if (open) void fetchPage()
    return () => { counter.current++ }
  }, [open, version, revision, fetchPage])

  const blocked = p.locked || p.mutationBlocked || busyId !== null
  async function restore(item: TrashedRoundImage) {
    if (blocked || flight.current) return
    flight.current = true
    setBusyId(item.eventId)
    let requestId = retries.current.get(item.eventId)
    if (!requestId) {
      requestId = crypto.randomUUID()
      retries.current.set(item.eventId, requestId)
    }
    try {
      const result = await p.onRestoreImage(item.eventId, requestId)
      setPreview(null)
      setItems(rows => rows.filter(row => row.eventId !== item.eventId))
      setRevision(value => value + 1)
      toast.success(result.image ? 'Bilden återställd.' : 'Bilden har redan hanterats. Papperskorgen uppdateras.')
    } catch (error) {
      toast.error(error, 'Bilden kunde inte återställas. Försök igen.')
    } finally {
      flight.current = false
      setBusyId(null)
    }
  }
  function restoreButton(item: TrashedRoundImage) {
    return <button type="button" className="obm-trash-restore" disabled={blocked || item.daysRemaining <= 0}
      onClick={() => void restore(item)}>
      <RotateCcw size={18} />{busyId === item.eventId ? 'Återställer…' : 'Återställ'}
    </button>
  }
  return <>
    <details className="obm-image-trash" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
      <summary><Trash2 size={19} /><span>Papperskorg</span><ChevronDown size={18} /></summary>
      <div className="obm-trash-content">
        <p className="obm-muted">Raderade bilder · 30 dagars återställning</p>
        {p.locked && <p role="status">Besiktningen är låst. Bilder kan inte återställas.</p>}
        {p.mutationBlocked && <p role="status">Vänta tills sparande och bilduppladdningar är klara.</p>}
        {loading && <p role="status">Läser papperskorgen…</p>}
        {failed && <div role="status"><p>Papperskorgen kunde inte läsas.</p>
          <button type="button" onClick={() => void fetchPage()}>Försök igen</button></div>}
        {!loading && !failed && loaded && items.length === 0 && <p className="obm-empty">Papperskorgen är tom.</p>}
        {items.map(item => <div key={item.eventId} className="obm-trash-row">
          <button type="button" className="obm-image-thumb" aria-label={`Förstora raderad bild: ${imagePlace(item.image)}`}
            onClick={() => setPreview(item)}>
            <img src={p.imageSrc(item.image)} alt={item.image.label || 'Raderad besiktningsbild'} />
          </button>
          <div><strong>{imagePlace(item.image)}</strong>
            <p>Raderad {new Date(item.deletedAt).toLocaleDateString('sv-SE')}</p>
            <p>{item.daysRemaining} {item.daysRemaining === 1 ? 'dag' : 'dagar'} kvar</p>
          </div>
          {restoreButton(item)}
        </div>)}
        {cursor && !failed && <button type="button" disabled={loading} onClick={() => void fetchPage(cursor)}>Visa fler</button>}
      </div>
    </details>
    {preview && <Sheet title="Raderad bild" closeDisabled={busyId !== null}
      onClose={() => { if (!flight.current) setPreview(null) }} footer={restoreButton(preview)}>
      <p className="obm-place-label">{imagePlace(preview.image)} · {preview.daysRemaining} dagar kvar</p>
      <div className="obm-image-viewer"><img src={p.imageSrc(preview.image)} alt={preview.image.label || 'Raderad besiktningsbild'} /></div>
    </Sheet>}
  </>
}
