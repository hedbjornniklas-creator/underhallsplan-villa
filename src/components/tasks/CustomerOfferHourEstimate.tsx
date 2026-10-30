'use client'

import type { CustomerOfferDraft } from '@/lib/action-cases/customerOffers'
import { money } from '@/lib/action-cases/customerOffers'
import { estimatedHoursLabel, estimatedLabourRange, offerHourEstimateIssues, type OfferHourEstimate } from '@/lib/action-cases/offerHourEstimate'
import PriceInput from './CustomerOfferPriceInput'

export default function CustomerOfferHourEstimate({ draft, onChange }: {
  draft: CustomerOfferDraft; onChange: (value: OfferHourEstimate | null) => void
}) {
  const estimate = draft.offerHourEstimate, range = estimatedLabourRange(draft)
  return <section className="space-y-3 border-t border-[#D5DCDD] pt-4" aria-label="Uppskattad tidsåtgång">
    <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={Boolean(estimate)}
      onChange={event => onChange(event.target.checked ? { version: 1, minHours: null, maxHours: null } : null)} />Ange uppskattad tidsåtgång</label>
    {estimate && <>
      <div className="grid gap-4 sm:grid-cols-2">
        <PriceInput label="Från antal timmar" max={10_000_000} value={estimate.minHours === null ? null : Math.round(estimate.minHours * 100)}
          onChange={amount => onChange({ ...estimate, minHours: amount === null ? null : amount / 100 })} />
        <PriceInput label="Till antal timmar" max={10_000_000} value={estimate.maxHours === null ? null : Math.round(estimate.maxHours * 100)}
          onChange={amount => onChange({ ...estimate, maxHours: amount === null ? null : amount / 100 })} />
      </div>
      <dl className="gizmo-price-total-line bg-[#EDF1F1] p-3 text-sm" aria-live="polite"><dt>Uppskattat arbetspris inkl. moms</dt>
        <dd className="font-semibold">{range ? `${money(range.minOre)} – ${money(range.maxOre)}` : 'Kan inte beräknas ännu'}</dd></dl>
      {offerHourEstimateIssues(draft).map(issue => <p key={issue} role="alert" className="text-sm text-[#A52E42]">{issue}</p>)}
    </>}
  </section>
}

export function OfferHourEstimateDocument({ draft }: { draft: CustomerOfferDraft }) {
  const estimate = draft.offerHourEstimate, range = estimatedLabourRange(draft)
  if (!estimate || !draft.contractPricing || draft.contractPricing.mode === 'fixed') return null
  return <section className="mt-4 space-y-2 border-t border-[#D5DCDD] pt-4 text-sm" aria-label="Offertens tidsuppskattning">
    <p><strong>Uppskattad tidsåtgång:</strong> {estimatedHoursLabel(estimate)}</p>
    {range && <p><strong>Uppskattat arbetspris inkl. moms:</strong> {money(range.minOre)} – {money(range.maxOre)}</p>}
    <p>Tidsåtgång och arbetspris är uppskattningar, inte fast pris eller takpris. Faktiskt utförda timmar debiteras enligt timpriset. Material och övriga kostnader ingår inte i det beräknade arbetspriset utan debiteras enligt prisgrunderna ovan.</p>
  </section>
}
