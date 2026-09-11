'use client'

import { ChevronDown, Image as ImageIcon } from 'lucide-react'
import type { RoundImage } from './ObStepRunda'

export default function ObRoundPlaceImages({ images, title, imageSrc, onOpen }: {
  images: RoundImage[]
  title: string
  imageSrc: (image: RoundImage) => string
  onOpen: (image: RoundImage) => void
}) {
  const unlinked = images.filter(image => !image.control_item_id && image.processing_status !== 'ignored').length
  return <details className="obm-place-images">
    <summary>
      <ImageIcon size={20} />
      <span><h2>{title}</h2>{unlinked > 0 && <small>{unlinked} utan notering</small>}</span>
      <span className="obm-place-image-count">{images.length}</span>
      <ChevronDown size={19} />
    </summary>
    {images.length ? <div className="obm-place-image-grid">
      {images.map((image, index) => {
        const status = image.local_queue_id ? 'Väntar på uppladdning'
          : image.control_item_id ? 'Kopplad till notering'
            : image.processing_status === 'ignored' ? 'Undantagen' : 'Ej kopplad'
        return <button key={image.id} type="button" className="obm-place-image" data-image-id={image.id}
          aria-label={`Förstora bild ${index + 1}: ${status}`} title="Förstora bild" onClick={() => onOpen(image)}>
          <img src={imageSrc(image)} alt={image.label || 'Besiktningsbild'} loading="lazy" />
          <span className={!image.control_item_id && image.processing_status !== 'ignored' ? 'obm-image-unlinked' : ''}>{status}</span>
        </button>
      })}
    </div> : <p className="obm-empty">Inga bilder på denna plats ännu.</p>}
  </details>
}
