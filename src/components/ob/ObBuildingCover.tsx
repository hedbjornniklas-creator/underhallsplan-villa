'use client'

import { useRef, useState } from 'react'
import { Camera, Image as ImageIcon, RefreshCw } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { useObBuilding } from './ObBuildingContext'
import { buildingCoverPath, requestBuildingCommand } from '@/lib/ob/buildingStructure'
import { enqueueObGrunddataWrite, recordObGrunddataWriteResult } from '@/lib/ob/grunddataWrites'
import type { Tables } from '@/types/supabase'
import { resolveInspectionCoverUrl } from '@/lib/ob/inspectionCoverUrl'
import ObCoverImageBank from './ObCoverImageBank'

export default function ObBuildingCover({ inspectionId, legacyPath, locked, embedded = false, onInspectionUpdated }: {
  inspectionId: string
  legacyPath: string | null
  locked: boolean
  embedded?: boolean
  onInspectionUpdated?: (inspection: Tables<'inspections'>) => void
}) {
  const context = useObBuilding()
  const camera = useRef<HTMLInputElement>(null)
  const library = useRef<HTMLInputElement>(null)
  const pending = useRef<{ file: File; path: string; partId: string | null; revision: number | null; requestId: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const part = context?.part ?? null
  const unavailable = Boolean(context?.overview.structure && !part)
  const path = buildingCoverPath(part, context?.overview.structure?.primary_part_id ?? null, legacyPath)
  const name = part?.name ?? 'Huvudbyggnad'
  const src = resolveInspectionCoverUrl(path, value => supabase.storage.from('inspection-images').getPublicUrl(value).data.publicUrl)
  const buttonClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-4 text-sm text-blue-700 hover:bg-blue-50 disabled:opacity-50'
  const save = async (file?: File) => {
    if (busy || locked || unavailable) return false
    if (file) {
      if (!file.type.startsWith('image/')) { setError('Välj en bildfil.'); return false }
      const ext = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
      pending.current = { file, partId: part?.id ?? null, revision: part?.revision ?? null, requestId: crypto.randomUUID(),
        path: part ? `${inspectionId}/building-covers/${part.id}/${crypto.randomUUID()}.${ext}`
          : `${inspectionId}/cover/${crypto.randomUUID()}.${ext}` }
    }
    const selected = pending.current
    if (!selected) return false
    setBusy(true); setError(null)
    try {
      const { error: uploadError } = await supabase.storage.from('inspection-images').upload(selected.path, selected.file, { upsert: true, cacheControl: '3600' })
      if (uploadError) throw uploadError
      if (selected.partId) {
        await requestBuildingCommand(inspectionId, 'edit', { partId: selected.partId, revision: selected.revision, coverPath: selected.path, requestId: selected.requestId })
        await context?.reload()
      } else {
        const saved = await enqueueObGrunddataWrite(inspectionId, async () => {
          const { data, error: saveError } = await Promise.resolve(supabase.from('inspections')
            .update({ cover_path: selected.path }).eq('id', inspectionId).is('locked_at', null).select('*').single())
            .catch(error => ({ data: null, error }))
          recordObGrunddataWriteResult(inspectionId, ['inspection:cover_path'], Boolean(saveError || !data))
          if (saveError || !data) throw saveError ?? Error('Omslagsbilden kunde inte sparas. Besiktningen kan vara låst.')
          return data as Tables<'inspections'>
        })
        onInspectionUpdated?.(saved)
      }
      pending.current = null
      return true
    } catch (e) { setError(e instanceof Error ? e.message : 'Byggnadsbilden kunde inte sparas.'); return false }
    finally { setBusy(false) }
  }
  return <section aria-label="Byggnadsbild" className={embedded ? undefined : 'border-y border-gray-200 py-4'}>
    {!embedded && <h3 className="mb-3 text-base font-semibold">Byggnadsbild · {name}</h3>}
    {src && <img src={src} alt={name} className="mb-3 max-h-72 w-full rounded-md bg-gray-50 object-contain" />}
    <div className="flex flex-wrap gap-2">
      <button type="button" className={buttonClass} disabled={busy || locked || unavailable} onClick={() => camera.current?.click()}><Camera size={20} />Ta bild</button>
      <button type="button" className={buttonClass} disabled={busy || locked || unavailable} onClick={() => library.current?.click()}><ImageIcon size={20} />Välj bild</button>
      <ObCoverImageBank key={part?.id ?? inspectionId} inspectionId={inspectionId} partId={part?.id}
        disabled={busy || locked || unavailable} buttonClass={buttonClass} onSelect={save} />
      {error && pending.current && <button type="button" className={buttonClass} disabled={busy || locked || unavailable} onClick={() => void save()}><RefreshCw size={18} />Försök igen</button>}
    </div>
    <input ref={camera} type="file" accept="image/*" capture="environment" hidden disabled={busy || locked || unavailable} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void save(f) }} />
    <input ref={library} type="file" accept="image/*" hidden disabled={busy || locked || unavailable} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void save(f) }} />
    {unavailable && <p role="alert" className="mt-2 text-sm text-red-700">Byggnaden kunde inte verifieras. Uppdatera sidan.</p>}
    {busy && <p role="status" className="mt-2 text-sm">Sparar byggnadsbild...</p>}
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
  </section>
}
