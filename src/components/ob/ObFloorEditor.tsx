'use client'

import { useState } from 'react'
import { Plus, Save, Trash2, X } from 'lucide-react'
import { validFloorLevels, type ObFloorLevel, type ObFloorModel } from '@/lib/ob/floorModel'
import { useObFloorModel } from './ObFloorProvider'
import { useObBuilding } from './ObBuildingContext'
import { requestBuildingCommand, type ObBuildingOverview } from '@/lib/ob/buildingStructure'

export function ObFloorEditor({ inspectionId, disabled }: { inspectionId: string; disabled: boolean }) {
  const { model, update } = useObFloorModel()
  const building = useObBuilding()
  const [draft, setDraft] = useState<ObFloorLevel[] | null>(null)
  const [revision, setRevision] = useState<number | null>(null)
  const [number, setNumber] = useState('1')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!model) return null
  const rows = draft ?? model.levels
  const change = (next: ObFloorLevel[]) => {
    if (!draft) setRevision(model.revision)
    setDraft(next)
    setError(null)
  }
  const add = () => {
    const level = Number(number)
    const next = [...rows, { level, name: '' }]
    if (!number.trim() || !validFloorLevels(next)) {
      setError('Ange ett ledigt heltal mellan -99 och 199.'); return
    }
    change(next)
    setNumber(String(level + 1))
  }
  const save = async () => {
    if (!draft || busy || disabled) return
    setBusy(true); setError(null)
    try {
      if (building?.part) {
        const result = await requestBuildingCommand<ObBuildingOverview>(inspectionId, 'floors', {
          partId: building.part.id, revision, levels: draft, requestId: crypto.randomUUID(),
        })
        const saved = result.parts.find(part => part.id === building.part?.id)?.floor_model
        if (!saved) throw Error('Planen kunde inte verifieras.')
        update(saved); setDraft(null); setRevision(null)
        await building.reload()
        return
      }
      const response = await fetch(`/api/ob/inspections/${inspectionId}/floors`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision, levels: draft }),
      })
      const result = await response.json() as { data?: ObFloorModel; error?: string }
      if (!response.ok || !result.data) throw new Error(result.error || 'Planen kunde inte sparas.')
      update(result.data); setDraft(null); setRevision(null)
    } catch (e) { setError(e instanceof Error ? e.message : 'Planen kunde inte sparas.') }
    finally { setBusy(false) }
  }
  const iconButton = 'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-gray-300 bg-white disabled:opacity-50'
  return <section aria-label="Plan" className="mt-5 border-t border-gray-200 pt-4">
    <h3 className="mb-3 text-base font-semibold text-gray-900">Plan</h3>
    <fieldset disabled={disabled || busy} className="min-w-0 space-y-2">
      {[...rows].sort((a, b) => a.level - b.level).map(row => <div key={row.level} className="flex min-w-0 items-center gap-2">
        <span className="w-16 shrink-0 text-sm text-gray-800">Plan {row.level}</span>
        <input aria-label={`Namn p\u00e5 plan ${row.level}`} value={row.name} maxLength={80}
          placeholder="Namn" className="h-11 min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-3 text-base text-gray-900"
          onChange={event => change(rows.map(item => item.level === row.level ? { ...item, name: event.target.value } : item))} />
        <button type="button" aria-label={`Ta bort plan ${row.level}`} title={`Ta bort plan ${row.level}`}
          className={`${iconButton} obm-delete-icon text-red-700`} disabled={row.level === 0}
          onClick={() => change(rows.filter(item => item.level !== row.level))}><Trash2 size={18} /></button>
      </div>)}
      <div className="flex items-center gap-2 pt-2">
        <input aria-label="Nytt plannummer" type="number" step={1} min={-99} max={199} value={number}
          onChange={event => setNumber(event.target.value)} className="h-11 w-24 rounded-md border border-gray-300 bg-white px-3 text-base text-gray-900" />
        <button type="button" onClick={add} aria-label={'L\u00e4gg till plan'} title={'L\u00e4gg till plan'}
          className={`${iconButton} text-blue-700`}><Plus size={20} /></button>
      </div>
      {draft && <div className="flex flex-wrap gap-2 pt-2">
        <button type="button" onClick={() => void save()} className="obm-primary inline-flex min-h-11 items-center gap-2 rounded-md bg-blue-700 px-4 text-white disabled:opacity-50"><Save size={18} />{busy ? 'Sparar...' : 'Spara plan'}</button>
        <button type="button" onClick={() => { setDraft(null); setRevision(null); setError(null) }} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-gray-300 bg-white px-3 text-gray-700"><X size={18} />Avbryt</button>
      </div>}
    </fieldset>
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
  </section>
}
