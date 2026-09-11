'use client'

import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

export default function ApplicationHelp({ children, label = 'Visa mer' }: { children: ReactNode; label?: string }) {
  return (
    <details className="group/help min-w-0 text-sm text-stone-700">
      <summary className="flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 text-emerald-800 underline underline-offset-4 [&::-webkit-details-marker]:hidden">
        <ChevronDown size={16} aria-hidden="true" className="shrink-0 group-open/help:rotate-180" />
        <span className="group-open/help:hidden">{label}</span>
        <span className="hidden group-open/help:inline">Visa mindre</span>
      </summary>
      <div className="space-y-3 whitespace-pre-line break-words pb-3 leading-6">{children}</div>
    </details>
  )
}
