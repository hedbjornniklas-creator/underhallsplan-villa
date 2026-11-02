'use client'
import { Check, Loader2, RefreshCw } from 'lucide-react'
import type { CalculationEntry } from './useActionCalculationAutosave'

export default function CalculationSaveStatus({ entry, onRetry }: { entry?: CalculationEntry; onRetry: () => void }) {
  return <span className="inline-flex min-h-6 max-w-full flex-wrap items-center gap-1.5 text-xs text-[#596368]" role="status" aria-live="polite">
    {!entry || entry.status === 'saved' ? <><Check size={13} />Sparat</> : entry.status === 'invalid' ? 'Komplettera raden · Inte sparat' : entry.status === 'error' ? <>
      <span className="text-rose-700" title={entry.error}>Kunde inte spara</span><button type="button" className="inline-flex min-h-8 items-center gap-1 underline" onClick={onRetry} title={entry.error}><RefreshCw size={13} />Försök igen</button>
    </> : <><Loader2 size={13} className="animate-spin" />Sparar…</>}
  </span>
}
