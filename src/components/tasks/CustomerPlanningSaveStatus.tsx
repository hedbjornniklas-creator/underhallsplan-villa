'use client'

import { Check, Loader2, RefreshCw } from 'lucide-react'

export default function CustomerPlanningSaveStatus({ pending, error, refreshing = false, onRetry }: {
  pending: boolean; error: boolean; refreshing?: boolean; onRetry: () => void
}) {
  return <div role="status" aria-live="polite" aria-atomic="true" data-testid="planning-save-status" className="flex h-8 w-60 max-w-full shrink-0 items-center gap-2 text-xs text-[#596368]">
    {error ? <><span>Kunde inte spara</span><button type="button" className="inline-flex h-8 items-center gap-1 underline" aria-label="Försök spara Val och tillval igen" onClick={onRetry}><RefreshCw size={14} />Försök igen</button></>
      : pending || refreshing ? <><Loader2 size={14} className="shrink-0 animate-spin" /><span>{refreshing ? 'Hämtar…' : 'Sparar…'}</span></>
      : <><Check size={14} className="shrink-0" /><span>Sparat</span></>}
  </div>
}
