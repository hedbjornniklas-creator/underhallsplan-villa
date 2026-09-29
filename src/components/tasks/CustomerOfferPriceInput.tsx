'use client'

import { useState } from 'react'
import { parseKronor } from '@/lib/action-cases/customerOffers'

export default function CustomerOfferPriceInput({ value, onChange, label, disabled, max = 100_000_000_000 }: {
  value: number | null
  onChange: (value: number | null) => void
  label: string
  disabled?: boolean
  max?: number
}) {
  const formatted = value === null ? '' :
    (value % 100 === 0 ? String(value / 100) : (value / 100).toFixed(2)).replace('.', ',')
  const [raw, setRaw] = useState<string | null>(null)
  return <label className="block text-sm font-medium">
    {label}
    <input
      className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-50"
      aria-label={label} type="text" inputMode="decimal" disabled={disabled} value={raw ?? formatted}
      onBlur={() => setRaw(null)}
      onChange={(event) => {
        const next = event.target.value.replace(/\s/g, '')
        if (!/^(\d+([,.]\d{0,2})?)?$/.test(next)) return
        try {
          const amount = parseKronor(next.replace(/[,.]$/, ''))
          if (amount !== null && amount > max) return
          setRaw(next)
          onChange(amount)
        } catch { /* Keep the previous value outside the supported range. */ }
      }}
    />
  </label>
}
