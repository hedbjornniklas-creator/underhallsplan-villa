'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import DebouncedTextarea from './DebouncedTextarea'
import Sheet from './ObRoundSheet'
import type { ObMobileRoundProps } from './ObMobileRound'
import type { RoundImage } from './ObStepRunda'
import { matchesWords } from '@/lib/ob/roundSearch'
import { useToast } from '@/components/ui/AppToastProvider'

export default function ObRoundLegacyNotes({ p, exteriorItemId, query = '' }: {
  p: ObMobileRoundProps; exteriorItemId?: string; query?: string
}) {
  const [preview, setPreview] = useState<RoundImage | null>(null)
  const toast = useToast()
  const rows = (p.legacyExteriorNotes ?? []).filter(row =>
    (!exteriorItemId || row.exterior_item_id === exteriorItemId) &&
    matchesWords([row.part_label, row.note, row.risk_text, row.ftu_text,
      p.exteriorItems.find(item => item.id === row.exterior_item_id)?.label].join(' '), query))
  if (!rows.length) return null
  return <section className="obm-legacy-notes">
    <div className="obm-section-title"><h2>Tidigare utsidesnoteringar</h2><span>{rows.length}</span></div>
    {rows.map(row => <details key={row.id} className="obm-category">
      <summary><span>{row.part_label || 'Fri notering'}<small>Utsida · {p.exteriorItems.find(item => item.id === row.exterior_item_id)?.label || 'Tidigare byggnadsdel'}</small></span><ChevronDown size={19} /></summary>
      <div className="obm-legacy-fields">
        {(['note', 'risk_text', 'ftu_text'] as const).map(field => <label key={field}>
          {field === 'note' ? 'Notering' : field === 'risk_text' ? 'Risk' : 'Fortsatt teknisk utredning'}
          <DebouncedTextarea rows={3} value={row[field] ?? ''}
            draftKey={`ob:${p.scopeId ?? p.inspectionId}:utsida:observation:${row.id}:${field}`}
            readOnly={p.locked || !p.onUpdateLegacyNote}
            onSave={async value => {
              try { await p.onUpdateLegacyNote!(row.id!, { [field]: value }) }
              catch (error) { toast.error(error, 'Noteringen kunde inte sparas. Texten finns kvar lokalt.'); throw error }
            }} />
        </label>)}
        <div className="obm-legacy-images">
          {p.images.filter(image => image.exterior_observation_id === row.id && !image.control_item_id).map(image =>
            <button type="button" key={image.id} className="obm-image-thumb" aria-label="Förstora noteringens bild" onClick={() => setPreview(image)}>
              <img src={p.imageSrc(image)} alt={image.label || 'Noteringens bild'} />
            </button>)}
        </div>
      </div>
    </details>)}
    {preview && <Sheet title="Bild" onClose={() => setPreview(null)}>
      <div className="obm-image-viewer"><img src={p.imageSrc(preview)} alt={preview.label || 'Noteringens bild'} /></div>
    </Sheet>}
  </section>
}
