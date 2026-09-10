'use client'

import { ChevronDown, ClipboardList, Info } from 'lucide-react'
import type { TuControlPlanState } from '@/lib/tu/controlPlan'

export default function TuPostDamageFieldChecklist({
  preparation,
}: {
  preparation: TuControlPlanState | null
}) {
  const areas = preparation?.items.filter((item) => item.reviewStatus === 'accepted') ?? []

  if (preparation?.case.status !== 'plan_approved' || areas.length === 0) return null

  return (
    <details className="group overflow-hidden rounded-lg border border-violet-200 bg-white shadow-sm">
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3 text-left marker:content-none [&::-webkit-details-marker]:hidden">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-violet-50 text-violet-700">
          <ClipboardList size={18} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-gray-950">Kontrollinriktning</span>
          <span className="mt-0.5 block text-xs text-gray-500">
            Frivilligt minnesstöd · {areas.length} {areas.length === 1 ? 'område' : 'områden'}
          </span>
        </span>
        <span className="text-xs font-semibold text-violet-800 group-open:hidden">Visa</span>
        <span className="hidden text-xs font-semibold text-violet-800 group-open:inline">Dölj</span>
        <ChevronDown size={17} className="shrink-0 text-gray-500 transition group-open:rotate-180" aria-hidden />
      </summary>

      <div className="space-y-4 border-t border-gray-200 px-4 py-4">
        {preparation.case.overview ? (
          <p className="text-sm leading-6 text-gray-700">{preparation.case.overview}</p>
        ) : null}

        <ol className="divide-y divide-gray-100 rounded-md border border-gray-200">
          {areas.map((item, index) => (
            <li key={item.id} className="flex gap-3 px-3 py-3">
              <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-violet-50 text-xs font-semibold text-violet-800">
                {index + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold leading-5 text-gray-950">{item.title}</span>
                <span className="mt-0.5 block text-xs leading-5 text-gray-600">{item.description}</span>
              </span>
            </li>
          ))}
        </ol>

        <p className="flex gap-2 rounded-md bg-gray-50 px-3 py-2 text-xs leading-5 text-gray-600">
          <Info size={15} className="mt-0.5 shrink-0 text-violet-700" aria-hidden />
          Dokumentera det du faktiskt ser som observation, mätning eller bild. Områdena behöver inte bockas av eller kopplas till fältposter.
        </p>
      </div>
    </details>
  )
}
