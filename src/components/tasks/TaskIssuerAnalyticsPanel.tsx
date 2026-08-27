'use client'

import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  UserRound,
} from 'lucide-react'
import type {
  TaskAnalyticsPeriod,
  TaskAssigneeAnalytics,
  TaskDeliveryStats,
  TaskWorkspaceAnalytics,
} from '@/lib/tasks/contracts'

const PERIODS: Array<{ key: TaskAnalyticsPeriod; label: string }> = [
  { key: '30d', label: '30 dagar' },
  { key: '90d', label: '90 dagar' },
  { key: '12m', label: '12 månader' },
  { key: 'all', label: 'All historik i vyn' },
]

function percentOf(value: number, total: number) {
  if (total <= 0) return 0
  return Math.round((value * 100) / total)
}

function deliveryPercent(stats: TaskDeliveryStats) {
  return stats.onTimePercent === null ? '—' : `${stats.onTimePercent} %`
}

function AnalyticsCard({
  label,
  value,
  detail,
  icon,
  tone,
  limitedSample = false,
  onClick,
}: {
  label: string
  value: string
  detail: string
  icon: React.ReactNode
  tone: string
  limitedSample?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-amber-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-100"
    >
      <span className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${tone}`}>{icon}</span>
      <span className="mt-3 block text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">{value}</span>
      <span className="mt-1 block text-sm font-semibold text-slate-800">{label}</span>
      <span className="mt-1 block text-xs leading-5 text-slate-500">{detail}</span>
      {limitedSample ? (
        <span className="mt-2 inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-800">
          Begränsat underlag
        </span>
      ) : null}
    </button>
  )
}

function AssigneeCard({
  analytics,
  period,
  onOpen,
}: {
  analytics: TaskAssigneeAnalytics
  period: TaskAnalyticsPeriod
  onOpen: (label: string, taskIds: string[]) => void
}) {
  const delivery = analytics.deliveryByPeriod[period]
  const approvedTotal = delivery.approvedCount
  const allTaskIds = [...new Set([
    ...delivery.taskIds.approved,
    ...analytics.current.taskIds.active,
  ])]
  const personType = analytics.assignee.kind === 'profile' ? 'Intern mottagare' : 'Extern mottagare'

  return (
    <button
      type="button"
      onClick={() => onOpen(analytics.assignee.name, allTaskIds)}
      className="group min-w-0 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-amber-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-100"
    >
      <div className="flex items-start gap-3">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
          <UserRound size={20} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-slate-950">{analytics.assignee.name}</p>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {analytics.assignee.companyName || personType}
          </p>
        </div>
        <ChevronRight className="mt-1 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-amber-600" size={19} aria-hidden="true" />
      </div>

      <div className="mt-4 flex items-end justify-between gap-3">
        <div>
          <p className="text-2xl font-semibold tracking-tight text-slate-950">{deliveryPercent(delivery)}</p>
          <p className="mt-0.5 text-xs text-slate-500">{delivery.onTimeCount} av {delivery.measuredCount} i tid</p>
        </div>
        <div className="text-right text-xs leading-5 text-slate-500">
          <p><span className="font-semibold text-slate-800">{analytics.current.activeCount}</span> aktiva</p>
          <p><span className={analytics.current.overdueCount > 0 ? 'font-semibold text-rose-700' : 'font-semibold text-slate-800'}>{analytics.current.overdueCount}</span> försenade</p>
        </div>
      </div>

      <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-slate-200" aria-label={`Leveransprecision för ${analytics.assignee.name}`}>
        {approvedTotal > 0 ? (
          <>
            <span className="bg-emerald-500" style={{ width: `${percentOf(delivery.onTimeCount, approvedTotal)}%` }} />
            <span className="bg-rose-500" style={{ width: `${percentOf(delivery.lateCount, approvedTotal)}%` }} />
            <span className="bg-slate-400" style={{ width: `${percentOf(delivery.unknownCount, approvedTotal)}%` }} />
          </>
        ) : null}
      </div>
      {delivery.limitedSample ? <p className="mt-2 text-[11px] font-semibold text-amber-700">Begränsat underlag</p> : null}
    </button>
  )
}

export default function TaskIssuerAnalyticsPanel({
  analytics,
  period,
  onPeriodChange,
  onDrilldown,
}: {
  analytics: TaskWorkspaceAnalytics
  period: TaskAnalyticsPeriod
  onPeriodChange: (period: TaskAnalyticsPeriod) => void
  onDrilldown: (label: string, taskIds: string[]) => void
}) {
  const scope = analytics.issuedByMe
  const current = scope.current
  const delivery = scope.deliveryByPeriod[period]
  const approvedTotal = delivery.approvedCount
  const selectedPeriodLabel = PERIODS.find((item) => item.key === period)?.label ?? ''
  const segments = [
    {
      key: 'on-time',
      label: 'I tid',
      count: delivery.onTimeCount,
      taskIds: delivery.taskIds.onTime,
      color: 'bg-emerald-500 hover:bg-emerald-600',
      dot: 'bg-emerald-500',
    },
    {
      key: 'late',
      label: 'Sent',
      count: delivery.lateCount,
      taskIds: delivery.taskIds.late,
      color: 'bg-rose-500 hover:bg-rose-600',
      dot: 'bg-rose-500',
    },
    {
      key: 'unknown',
      label: 'Okänt',
      count: delivery.unknownCount,
      taskIds: delivery.taskIds.unknown,
      color: 'bg-slate-300 hover:bg-slate-400',
      dot: 'bg-slate-400',
    },
  ]

  return (
    <section className="mt-5 rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-7" aria-labelledby="issuer-statistics-heading">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-700">Uppdrag utfärdade av dig</p>
          <h2 id="issuer-statistics-heading" className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">Leveransstatistik</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            I tid mäts när mottagarens slutliga, senare godkända version skickades in för kontroll. Uppdrag som någon annan har skapat ingår inte.
            Perioden påverkar leveranshistoriken; nuläget visas alltid som det ser ut nu.
            Arkiverade uppdrag ingår inte.
          </p>
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Period</p>
          <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1" role="group" aria-label="Välj statistikperiod">
            {PERIODS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => onPeriodChange(option.key)}
                aria-pressed={period === option.key}
                className={`min-h-10 shrink-0 rounded-lg px-3 text-xs font-semibold transition ${period === option.key ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-600 hover:text-slate-950'}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {delivery.limitedSample ? (
        <div className="mt-5 flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
          <AlertTriangle className="mt-0.5 shrink-0 text-amber-700" size={19} aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold">Begränsat underlag</p>
            <p className="mt-1 text-xs leading-5 text-amber-900/80">Färre än fem mätbara, godkända uppdrag ingår i perioden. Procenten bör därför tolkas försiktigt.</p>
          </div>
        </div>
      ) : null}

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <AnalyticsCard
          label="I tid"
          value={deliveryPercent(delivery)}
          detail={`${delivery.onTimeCount} av ${delivery.measuredCount} mätbara`}
          icon={<CheckCircle2 size={20} aria-hidden="true" />}
          tone="bg-emerald-100 text-emerald-700"
          limitedSample={delivery.limitedSample}
          onClick={() => onDrilldown(`I tid · ${selectedPeriodLabel}`, delivery.taskIds.onTime)}
        />
        <AnalyticsCard
          label="Försenade nu"
          value={String(current.overdueCount)}
          detail={`${percentOf(current.overdueCount, current.activeCount)} % av ${current.activeCount} aktiva`}
          icon={<AlertTriangle size={20} aria-hidden="true" />}
          tone="bg-rose-100 text-rose-700"
          onClick={() => onDrilldown('Försenade nu · uppdrag utfärdade av dig', current.taskIds.overdue)}
        />
        <AnalyticsCard
          label="Inom 7 dagar"
          value={String(current.dueWithin7DaysCount)}
          detail={`${percentOf(current.dueWithin7DaysCount, current.activeCount)} % av ${current.activeCount} aktiva`}
          icon={<CalendarDays size={20} aria-hidden="true" />}
          tone="bg-amber-100 text-amber-700"
          onClick={() => onDrilldown('Klart inom 7 dagar · uppdrag utfärdade av dig', current.taskIds.dueWithin7Days)}
        />
        <AnalyticsCard
          label="Väntar på dig"
          value={String(current.awaitingReviewCount)}
          detail={`${percentOf(current.awaitingReviewCount, current.activeCount)} % av ${current.activeCount} aktiva`}
          icon={<ClipboardCheck size={20} aria-hidden="true" />}
          tone="bg-violet-100 text-violet-700"
          onClick={() => onDrilldown('Väntar på din kontroll', current.taskIds.awaitingReview)}
        />
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold text-slate-950">Leveranser i perioden</h3>
            <p className="mt-1 text-xs text-slate-500">{approvedTotal} godkända uppdrag totalt</p>
          </div>
          <p className="text-xs font-medium text-slate-500">{delivery.measuredCount} mätbara · {delivery.unknownCount} okända</p>
        </div>

        {approvedTotal > 0 ? (
          <div className="mt-4 flex h-4 w-full overflow-hidden rounded-full bg-slate-200" aria-label="Fördelning av leveranser">
            {segments.filter((segment) => segment.count > 0).map((segment) => (
              <button
                key={segment.key}
                type="button"
                onClick={() => onDrilldown(`${segment.label} · ${selectedPeriodLabel}`, segment.taskIds)}
                className={`${segment.color} min-w-1 transition focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white`}
                style={{ flexGrow: segment.count, flexBasis: 0 }}
                aria-label={`${segment.label}: ${segment.count} uppdrag, ${percentOf(segment.count, approvedTotal)} procent`}
              />
            ))}
          </div>
        ) : (
          <div className="mt-4 h-4 w-full rounded-full bg-slate-200" aria-label="Inga godkända leveranser i perioden" />
        )}

        <div className="mt-4 grid grid-cols-3 gap-2">
          {segments.map((segment) => (
            <button
              key={segment.key}
              type="button"
              onClick={() => onDrilldown(`${segment.label} · ${selectedPeriodLabel}`, segment.taskIds)}
              className="min-w-0 rounded-xl border border-slate-200 bg-white px-2 py-3 text-left transition hover:border-amber-300 hover:shadow-sm focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-100 sm:px-3"
            >
              <span className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${segment.dot}`} />
                <span className="truncate">{segment.label}</span>
              </span>
              <span className="mt-1 block text-sm font-bold text-slate-950 sm:text-base">{segment.count} · {percentOf(segment.count, approvedTotal)} %</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-7">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="text-lg font-semibold tracking-tight text-slate-950">Per mottagare</h3>
            <p className="mt-1 text-sm text-slate-500">Endast personer som har fått uppdrag skapade av dig.</p>
          </div>
          <p className="text-xs font-medium text-slate-500">{scope.assignees.length} mottagare</p>
        </div>
        {scope.assignees.length > 0 ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {scope.assignees.map((assigneeAnalytics) => (
              <AssigneeCard
                key={`${assigneeAnalytics.assignee.kind}:${assigneeAnalytics.assignee.id}`}
                analytics={assigneeAnalytics}
                period={period}
                onOpen={(label, taskIds) => onDrilldown(`${label} · ${selectedPeriodLabel}`, taskIds)}
              />
            ))}
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center">
            <UserRound className="mx-auto text-slate-400" size={28} aria-hidden="true" />
            <p className="mt-3 text-sm font-semibold text-slate-800">Ingen mottagarstatistik ännu</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">När dina egna uppdrag börjar utföras visas leveransprecisionen här.</p>
          </div>
        )}
      </div>
    </section>
  )
}
