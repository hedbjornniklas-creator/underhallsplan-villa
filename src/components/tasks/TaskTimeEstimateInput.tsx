'use client'

import { useId } from 'react'
import { X } from 'lucide-react'
import { MAX_TASK_ESTIMATE_MINUTES, TASK_ESTIMATE_PRESETS } from '@/lib/tasks/timeEstimate'

export default function TaskTimeEstimateInput({ value, onChange, disabled = false, hideLegend = false }: {
  value: string; onChange: (value: string) => void; disabled?: boolean; hideLegend?: boolean
}) {
  const id = useId()
  const invalid = Boolean(value && (Number(value) < 1 || Number(value) > MAX_TASK_ESTIMATE_MINUTES))
  return <fieldset disabled={disabled} className="min-w-0 space-y-2" aria-describedby={invalid ? `${id}-error` : undefined}>
    <legend className={hideLegend ? 'sr-only' : 'mb-2 text-sm font-semibold text-slate-800'}>Uppskattad tidsåtgång</legend>
    <div className="flex flex-wrap gap-1.5">
      {TASK_ESTIMATE_PRESETS.map(minutes => <label key={minutes} className={`inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-sm ${Number(value) === minutes ? 'border-[#206961] bg-[#EDF1F1]' : 'border-slate-200 bg-white'}`}>
        <input type="radio" name={id} checked={Number(value) === minutes} onChange={() => onChange(String(minutes))} />{minutes} min
      </label>)}
    </div>
    <div className="flex items-end gap-2">
      <label className="block min-w-0 text-sm text-slate-700">Minuter (valfritt)
        <input value={value} onChange={event => { if (/^\d*$/.test(event.target.value)) onChange(event.target.value) }}
          type="text" inputMode="numeric" aria-invalid={invalid} aria-describedby={invalid ? `${id}-error` : undefined}
          className="mt-1 block min-h-10 w-40 max-w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#206961]" />
      </label>
      <button type="button" aria-label="Rensa tidsuppskattning" title="Rensa tidsuppskattning" disabled={!value}
        onClick={() => onChange('')} className="gizmo-button gizmo-icon-button mb-px"><X size={17} /></button>
    </div>
    {invalid && <p role="alert" id={`${id}-error`} className="text-sm text-[#A52E42]">Ange 1–10080 hela minuter eller lämna tomt.</p>}
  </fieldset>
}
