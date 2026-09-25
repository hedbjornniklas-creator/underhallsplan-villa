'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Inbox } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import Sheet from './ObRoundSheet'

type BankImage = { id: string; file_path: string; label: string | null }

export default function ObCoverImageBank({ inspectionId, partId, disabled, buttonClass, onSelect }: {
  inspectionId: string
  partId?: string
  disabled: boolean
  buttonClass?: string
  onSelect: (file: File) => Promise<boolean>
}) {
  const [open, setOpen] = useState(false)
  const [images, setImages] = useState<BankImage[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const flight = useRef(false)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true); setError(''); setImages([]); setSelected(null)
    void (async () => {
      try {
        const rows: BankImage[] = []
        for (let offset = 0; ; offset += 500) {
          let query = supabase.from('inspection_images').select('id,file_path,label')
            .eq('inspection_id', inspectionId).order('id')
          if (partId) query = query.or(`building_part_id.eq.${partId},building_part_id.is.null`)
          const { data, error: loadError } = await query.range(offset, offset + 499)
          if (loadError) throw loadError
          if (cancelled) return
          rows.push(...(data ?? []))
          if (!data || data.length < 500) break
        }
        setImages(rows)
      } catch {
        if (!cancelled) setError('Bildbanken kunde inte hämtas. Försök igen.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [open, inspectionId, partId, retry])

  async function choose() {
    const image = images.find(row => row.id === selected)
    if (!image || disabled || loading || flight.current) return
    flight.current = true; setBusy(true); setError('')
    try {
      const { data, error: downloadError } = await supabase.storage.from('inspection-images').download(image.file_path)
      if (downloadError || !data) throw downloadError ?? Error('Missing image')
      if (!data.type.startsWith('image/')) throw Error('Invalid image')
      const file = new File([data], image.file_path.split('/').pop() || 'cover.jpg', { type: data.type })
      if (await onSelect(file)) setOpen(false)
      else setError('Omslagsbilden kunde inte sparas. Försök igen.')
    } catch {
      setError('Bilden kunde inte användas som omslagsbild. Försök igen.')
    } finally {
      flight.current = false; setBusy(false)
    }
  }

  return <>
    <button type="button" className={buttonClass} disabled={disabled || busy} onClick={() => setOpen(true)}>
      <Inbox size={20} />Bildbank
    </button>
    {open && <Sheet title="Välj omslagsbild" closeDisabled={busy} onClose={() => setOpen(false)}
      footer={<button type="button" className="obm-primary" disabled={disabled || busy || loading || !selected} onClick={() => void choose()}>
        <Check size={18} />{busy ? 'Sparar...' : 'Använd som omslagsbild'}
      </button>}>
      {loading && <p role="status">Hämtar bilder...</p>}
      {error && <div role="alert"><p>{error}</p>{!images.length && <button type="button" disabled={loading || busy} onClick={() => setRetry(value => value + 1)}>Försök igen</button>}</div>}
      {!loading && !error && !images.length && <p>Inga bilder i bildbanken.</p>}
      <div className="obm-image-bank-grid">
        {images.map((image, index) => <label key={image.id} className="obm-image-bank-item">
          <img src={supabase.storage.from('inspection-images').getPublicUrl(image.file_path).data.publicUrl}
            alt={image.label || `Bild ${index + 1}`} loading="lazy" decoding="async" />
          <span><input type="radio" name="cover-bank-image" checked={selected === image.id} disabled={disabled || busy}
            onChange={() => setSelected(image.id)} /><span>{image.label || `Bild ${index + 1}`}</span></span>
        </label>)}
      </div>
    </Sheet>}
  </>
}
