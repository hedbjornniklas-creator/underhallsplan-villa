import type { TaskRisk, TaskStatus } from '@/lib/tasks/contracts'

const STATUS_LABELS: Record<TaskStatus, string> = {
  draft: 'Utkast',
  assigned: 'Tilldelad',
  in_progress: 'Pågår',
  waiting: 'Väntar',
  ready_for_review: 'Klar för kontroll',
  returned: 'Behöver rättas',
  approved: 'Godkänd',
  cancelled: 'Avbruten',
}

const STATUS_CLASSES: Record<TaskStatus, string> = {
  draft: 'border-slate-200 bg-slate-50 text-slate-700',
  assigned: 'border-blue-200 bg-blue-50 text-blue-700',
  in_progress: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  waiting: 'border-amber-200 bg-amber-50 text-amber-800',
  ready_for_review: 'border-violet-200 bg-violet-50 text-violet-700',
  returned: 'border-orange-200 bg-orange-50 text-orange-800',
  approved: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  cancelled: 'border-slate-200 bg-slate-100 text-slate-600',
}

const RISK_CLASSES: Record<TaskRisk, string> = {
  green: 'bg-emerald-500 ring-emerald-100',
  yellow: 'bg-amber-400 ring-amber-100',
  red: 'bg-rose-500 ring-rose-100',
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_CLASSES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  )
}

export function TaskRiskDot({ risk }: { risk: TaskRisk }) {
  const label = risk === 'green' ? 'I fas' : risk === 'yellow' ? 'Behöver uppmärksamhet' : 'Försenad'
  return (
    <span
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-4 ${RISK_CLASSES[risk]}`}
      title={label}
      aria-label={label}
    />
  )
}

export function taskStatusLabel(status: TaskStatus) {
  return STATUS_LABELS[status]
}
