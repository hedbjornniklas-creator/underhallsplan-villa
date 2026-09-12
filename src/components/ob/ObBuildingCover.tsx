'use client'

import { useRef, useState } from 'react'
import { Camera, Image as ImageIcon, RefreshCw } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { useObBuilding } from './ObBuildingContext'
import { buildingCoverPath, requestBuildingCommand } from '@/lib/ob/buildingStructure'

export default function ObBuildingCover({ legacyPath, locked }: { legacyPath: string | null; locked: boolean }) {
  const context = useObBuilding()
  const camera = useRef<HTMLInputElement>(null)
  const library = useRef<HTMLInputElement>(null)
  const pending = useRef<{ file: File; path: string; partId: string; revision: number; requestId: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!context?.part) return null
  const path = buildingCoverPath(context.part, context.overview.structure?.primary_part_id ?? null, legacyPath)
  const src = path ? /^https?:\/\//.test(path) ? path : supabase.storage.from('inspection-images').getPublicUrl(path).data.publicUrl : null
  const buttonClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-4 text-sm text-blue-700 hover:bg-blue-50 disabled:opacity-50'
  const save = async (file?: File) => {
    if (busy || locked || !context.part) return
    if (file) {
      if (!file.type.startsWith('image/')) { setError('Välj en bildfil.'); return }
      const ext = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
      pending.current = { file, partId: context.part.id, revision: context.part.revision, requestId: crypto.randomUUID(),
        path: `${context.inspectionId}/building-covers/${context.part.id}/${crypto.randomUUID()}.${ext}` }
    }
    const selected = pending.current
    if (!selected) return
    setBusy(true); setError(null)
    try {
      const { error: uploadError } = await supabase.storage.from('inspection-images').upload(selected.path, selected.file, { upsert: true, cacheControl: '3600' })
      if (uploadError) throw uploadError
      await requestBuildingCommand(context.inspectionId, 'edit', { partId: selected.partId, revision: selected.revision, coverPath: selected.path, requestId: selected.requestId })
      pending.current = null
      await context.reload()
    } catch (e) { setError(e instanceof Error ? e.message : 'Byggnadsbilden kunde inte sparas.') }
    finally { setBusy(false) }
  }
  return <section aria-label="Byggnadsbild" className="border-y border-gray-200 py-4">
    <h3 className="mb-3 text-base font-semibold">Byggnadsbild · {context.part.name}</h3>
    {src && <img src={src} alt={context.part.name} className="mb-3 max-h-72 w-full rounded-md bg-gray-50 object-contain" />}
    <div className="flex flex-wrap gap-2">
      <button type="button" className={buttonClass} disabled={busy || locked} onClick={() => camera.current?.click()}><Camera size={20} />Ta bild</button>
      <button type="button" className={buttonClass} disabled={busy || locked} onClick={() => library.current?.click()}><ImageIcon size={20} />Välj bild</button>
      {error && pending.current && <button type="button" className={buttonClass} disabled={busy || locked} onClick={() => void save()}><RefreshCw size={18} />Försök igen</button>}
    </div>
    <input ref={camera} type="file" accept="image/*" capture="environment" hidden disabled={busy || locked} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void save(f) }} />
    <input ref={library} type="file" accept="image/*" hidden disabled={busy || locked} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void save(f) }} />
    {busy && <p role="status" className="mt-2 text-sm">Sparar byggnadsbild...</p>}
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
  </section>
}
