'use client'

import { useMemo } from 'react'
import {
  AlertTriangle,
  BrainCircuit,
  Check,
  ChevronDown,
  ClipboardCheck,
  FileCheck2,
  FileText,
  Mic,
} from 'lucide-react'
import type { TuWorkflowStep, TuWorkspaceView } from '@/lib/tu/workflow'

const ICONS = {
  field: Mic,
  evidence: ClipboardCheck,
  assessment: BrainCircuit,
  report: FileText,
  delivery: FileCheck2,
} satisfies Record<TuWorkspaceView, typeof Mic>

function statusIcon(step: TuWorkflowStep) {
  if (step.status === 'complete') return <Check size={14} aria-hidden />
  if (step.status === 'needs_attention') return <AlertTriangle size={14} aria-hidden />
  if (step.status === 'in_progress') return <span className="size-2 rounded-full bg-current" aria-hidden />
  return <span className="text-[11px] font-semibold">{step.number}</span>
}

function statusClasses(step: TuWorkflowStep, active: boolean) {
  if (active) return 'border-violet-600 bg-violet-700 text-white shadow-sm'
  if (step.status === 'complete') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (step.status === 'needs_attention') return 'border-amber-200 bg-amber-50 text-amber-900'
  return 'border-gray-200 bg-white text-gray-700 hover:border-violet-200 hover:bg-violet-50/50'
}

export default function TuWorkflowRail({
  steps,
  current,
  onChange,
  loading,
}: {
  steps: TuWorkflowStep[]
  current: TuWorkspaceView
  onChange: (view: TuWorkspaceView) => void
  loading: boolean
}) {
  const currentStep = useMemo(
    () => steps.find((step) => step.id === current) ?? steps[0],
    [current, steps]
  )

  if (!currentStep) return null

  return (
    <>
      <details className="group rounded-md border border-gray-200 bg-white shadow-sm lg:hidden">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase text-violet-700">Steg {currentStep.number} av 5</p>
            <p className="truncate text-sm font-semibold text-gray-950">{currentStep.title}</p>
            <p className="truncate text-xs text-gray-500">{loading ? 'Hämtar status…' : currentStep.statusText}</p>
          </div>
          <ChevronDown size={18} className="shrink-0 text-gray-500 transition group-open:rotate-180" aria-hidden />
        </summary>
        <div className="space-y-1 border-t border-gray-100 p-2">
          {steps.map((step) => {
            const Icon = ICONS[step.id]
            const active = step.id === current
            return (
              <button
                key={step.id}
                type="button"
                onClick={(event) => {
                  onChange(step.id)
                  event.currentTarget.closest('details')?.removeAttribute('open')
                }}
                className={`flex w-full items-start gap-3 rounded-md border px-3 py-3 text-left transition ${statusClasses(step, active)}`}
              >
                <Icon size={18} className="mt-0.5 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{step.title}</span>
                  <span className={`mt-0.5 block text-xs ${active ? 'text-violet-100' : 'text-current opacity-75'}`}>{step.statusText}</span>
                </span>
                <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-current/20">
                  {statusIcon(step)}
                </span>
              </button>
            )
          })}
        </div>
      </details>

      <nav className="sticky top-4 hidden self-start lg:block" aria-label="Arbetsflöde för tekniskt utlåtande">
        <div className="mb-3 px-1">
          <p className="text-xs font-semibold uppercase text-violet-700">Arbetsflöde</p>
        </div>
        <ol className="space-y-2">
          {steps.map((step) => {
            const Icon = ICONS[step.id]
            const active = step.id === current
            return (
              <li key={step.id}>
                <button
                  type="button"
                  onClick={() => onChange(step.id)}
                  aria-current={active ? 'step' : undefined}
                  className={`w-full rounded-md border px-3 py-3 text-left transition ${statusClasses(step, active)}`}
                >
                  <span className="flex items-start gap-3">
                    <span className={`inline-flex size-8 shrink-0 items-center justify-center rounded-md ${active ? 'bg-white/15' : 'bg-current/5'}`}>
                      <Icon size={17} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold leading-5">{step.title}</span>
                      <span className={`mt-1 block text-xs leading-4 ${active ? 'text-violet-100' : 'opacity-75'}`}>{step.statusText}</span>
                    </span>
                    <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-current/20">
                      {statusIcon(step)}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      </nav>
    </>
  )
}
