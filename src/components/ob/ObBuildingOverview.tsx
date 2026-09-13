'use client'

import { useRef, useState } from 'react'
import { Building2, PenLine, Plus, Save, Trash2 } from 'lucide-react'
import { useObBuilding } from './ObBuildingContext'
import Sheet from './ObRoundSheet'
import { requestBuildingCommand, type ObBuildingPart } from '@/lib/ob/buildingStructure'
import { hasObTextDraftsForInspection } from '@/lib/ob/localTextDrafts'
import { listRoundImageUploadItems } from '@/lib/ob/roundImageUploadQueue'
import './mobile-round.css'

type Dialog = { mode: 'activate' | 'add' | 'edit' | 'remove'; part?: ObBuildingPart }
export default function ObBuildingOverview({ locked }: { locked: boolean }) {
  const context = useObBuilding()
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [name, setName] = useState('')
  const [category, setCategory] = useState('guesthouse')
  const [buildingId, setBuildingId] = useState('')
  const [scope, setScope] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestId = useRef('')
  if (!context || (!context.overview.available && !context.overview.structure)) return null
  const { overview } = context
  const open = (next: Dialog) => {
    setDialog(next); setError(null); setConfirmed(false)
    setName(next.part?.name ?? (next.mode === 'activate' ? 'Huvudbyggnad' : ''))
    setCategory(next.part?.category_key ?? 'guesthouse'); setScope(next.part?.scope_note ?? '')
    setBuildingId(next.part?.building_id ?? '')
    requestId.current = crypto.randomUUID()
  }
  const save = async () => {
    if (!dialog || busy || locked) return
    setBusy(true); setError(null)
    try {
      if (hasObTextDraftsForInspection(context.inspectionId) || (await listRoundImageUploadItems(context.inspectionId)).length) {
        throw Error('Spara texten och vänta tills alla bilder har laddats upp innan byggnadsindelningen ändras.')
      }
      const payload = dialog.mode === 'add' || dialog.mode === 'activate'
        ? { name: name.trim(), buildingId: buildingId || null, categoryKey: category, confirmed, activationToken: overview.activationToken }
        : { partId: dialog.part!.id, revision: dialog.part!.revision, name: name.trim(), categoryKey: category, scopeNote: scope.trim() || null }
      await requestBuildingCommand(context.inspectionId, dialog.mode, { ...payload, requestId: requestId.current })
      await context.reload()
      setDialog(null)
    } catch (e) { setError(e instanceof Error ? e.message : 'Byggnaden kunde inte sparas.') }
    finally { setBusy(false) }
  }
  const button = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-3 text-sm text-blue-700 disabled:opacity-50'
  return <section aria-label="Byggnader" className="border-y border-gray-200 bg-white py-4">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-semibold text-gray-900">Byggnader <span className="ml-2 text-sm font-normal text-gray-500">{overview.parts.length || 1}</span></h2>
      <button type="button" disabled={locked || !overview.available} className={button}
        onClick={() => open({ mode: overview.structure ? 'add' : 'activate' })}>
        <Plus size={18} />{overview.structure ? 'Lägg till byggnad' : 'Välj huvudbyggnad'}
      </button>
    </header>
    <ul className="mt-3 divide-y divide-gray-200">
      {!overview.structure && <li className="flex items-center gap-3 py-3"><Building2 size={20} /><span>Huvudbyggnad</span></li>}
      {overview.parts.map(part => <li key={part.id} className="flex min-w-0 items-center gap-3 py-3">
        <Building2 size={20} className="shrink-0 text-teal-700" />
        <div className="min-w-0 flex-1"><div className="break-words font-medium">{part.name}</div>
          {overview.categories.find(c => c.key === part.category_key)?.label !== part.name &&
            <div className="text-sm text-gray-500">{overview.categories.find(c => c.key === part.category_key)?.label ?? part.category_key}</div>}</div>
        <button type="button" title="Ändra byggnad" aria-label={`Ändra ${part.name}`} disabled={locked} className={button} onClick={() => open({ mode: 'edit', part })}><PenLine size={18} /></button>
        {part.id !== overview.structure?.primary_part_id && <button type="button" title="Ta bort byggnad" aria-label={`Ta bort ${part.name}`} disabled={locked}
          className={`${button} !text-red-700`} onClick={() => open({ mode: 'remove', part })}><Trash2 size={18} /></button>}
      </li>)}
    </ul>
    {dialog && <Sheet title={dialog.mode === 'activate' ? 'Huvudbyggnad' : dialog.mode === 'add' ? 'Lägg till byggnad' : dialog.mode === 'remove' ? 'Ta bort byggnad' : 'Ändra byggnad'}
      onClose={() => { if (!busy) setDialog(null) }} footer={<button type="button" className={dialog.mode === 'remove' ? 'obm-danger' : 'obm-primary'} disabled={busy || locked || !name.trim() || dialog.mode === 'activate' && !confirmed} onClick={() => void save()}>
        {dialog.mode === 'remove' ? <Trash2 size={18} /> : <Save size={18} />}{busy ? 'Sparar...' : dialog.mode === 'remove' ? 'Ta bort byggnad' : 'Spara'}
      </button>}>
      {dialog.mode === 'remove' ? <p>Ta bort {dialog.part?.name} från denna besiktning? Byggnaden måste vara tom. Fastighetens byggnadsregister behålls.</p> :
      <fieldset disabled={busy || locked} className="min-w-0 space-y-4">
        {(dialog.mode === 'add' || dialog.mode === 'activate') && <label className="block text-sm">Byggnad på fastigheten
          <select value={buildingId} className="obm-input mt-2 w-full" onChange={e => { setBuildingId(e.target.value); const row = overview.buildings.find(b => b.id === e.target.value); if (row) setName(row.name) }}>
            <option value="">Registrera ny byggnad</option>
            {overview.buildings.filter(b => !overview.parts.some(p => p.building_id === b.id)).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select></label>}
        <label className="block text-sm">Byggnadens namn<input className="obm-input mt-2 w-full" value={name} maxLength={100} onChange={e => setName(e.target.value)} /></label>
        {dialog.mode !== 'activate' && <label className="block text-sm">Byggnadstyp<select className="obm-input mt-2 w-full" value={category} onChange={e => setCategory(e.target.value)}>
          {overview.categories.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select></label>}
        {dialog.mode === 'edit' && <label className="block text-sm">Omfattning och begränsningar<textarea className="obm-input mt-2 w-full" rows={3} value={scope} maxLength={10000} onChange={e => setScope(e.target.value)} /></label>}
        {dialog.mode === 'activate' && <>
          <p className="text-sm">Befintliga rum, noteringar och placerade bilder kopplas till denna huvudbyggnad. Texter, bilder och planbenämningar behålls.</p>
          <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
            <span>Säkerhetskopian är verifierad, redigeringen är pausad på alla enheter och alla bilder och texter är sparade.</span></label>
        </>}
      </fieldset>}
      {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
    </Sheet>}
  </section>
}
