'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  ClipboardCheck,
  LogOut,
  Search,
  X,
} from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import {
  formatTaskDateTime,
  normalizeTaskTimeZone,
  taskTimeZoneLabel,
} from '@/lib/tasks/dateTime'
import { recipientTaskPath } from '@/lib/tasks/recipientAuthPaths'
import type {
  RecipientPortalOverview,
  RecipientPortalTaskSummary,
} from '@/lib/tasks/recipientPortal'
import { SigneMark } from './SigneMark'
import { TaskRiskDot, TaskStatusBadge } from './TaskStatusBadge'

type FilterKey = 'active' | 'needs_action' | 'overdue' | 'completed' | 'all'
type ViewKey = 'current' | 'statistics'
type AnalyticsPeriod = '30d' | '90d' | '12m' | 'all'

type TaskDrilldown = {
  label: string
  taskIds: string[]
}

const TERMINAL_STATUSES = new Set(['approved', 'cancelled'])
const ANALYTICS_PERIODS: Array<{ key: AnalyticsPeriod; label: string }> = [
  { key: '30d', label: '30 dagar' },
  { key: '90d', label: '90 dagar' },
  { key: '12m', label: '12 månader' },
  { key: 'all', label: 'All historik i vyn' },
]

function percentOf(value: number, total: number) {
  if (total <= 0) return 0
  return Math.round((value * 100) / total)
}

function percentLabel(value: number | null) {
  return value === null ? '—' : `${value} %`
}

function AnalyticsKpiCard({
  label,
  value,
  detail,
  icon,
  tone,
  onClick,
  limitedSample = false,
}: {
  label: string
  value: string
  detail: string
  icon: React.ReactNode
  tone: string
  onClick: () => void
  limitedSample?: boolean
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

function matchesFilter(task: RecipientPortalTaskSummary, filter: FilterKey) {
  const terminal = TERMINAL_STATUSES.has(task.status)
  if (filter === 'active') return !terminal
  if (filter === 'needs_action') return !terminal && ['assigned', 'returned', 'waiting'].includes(task.status)
  if (filter === 'overdue') return !terminal && task.risk === 'red'
  if (filter === 'completed') return terminal
  return true
}

function TaskCard({ task }: { task: RecipientPortalTaskSummary }) {
  const terminal = TERMINAL_STATUSES.has(task.status)
  const effectiveTimeZone = normalizeTaskTimeZone(task.dueTimeZone)
  return (
    <Link
      href={recipientTaskPath(task.id)}
      className="group block rounded-3xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-amber-300 hover:shadow-lg hover:shadow-amber-950/5 sm:p-5"
    >
      <div className="flex items-start gap-3">
        <span className="pt-2"><TaskRiskDot risk={task.risk} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <TaskStatusBadge status={task.status} />
            <span className="truncate text-xs font-semibold text-slate-500">{task.organizationName}</span>
          </div>
          <h2 className="mt-3 text-lg font-semibold leading-snug tracking-tight text-slate-950 sm:text-xl">
            {task.title}
          </h2>
          {task.contextLabel ? (
            <p className="mt-1.5 truncate text-sm text-slate-500">{task.contextLabel}</p>
          ) : null}
          <div className="mt-4 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
            <p className="flex min-w-0 items-center gap-2">
              <CalendarDays className="shrink-0 text-slate-400" size={16} aria-hidden="true" />
              <span className={task.risk === 'red' && !terminal ? 'font-semibold text-rose-700' : ''}>
                Klart senast {formatTaskDateTime(task.dueAt, effectiveTimeZone, 'compact')}
              </span>
            </p>
            <p className="truncate sm:text-right">Från {task.issuerName}</p>
          </div>
          <p className="mt-1 text-xs text-slate-400">{taskTimeZoneLabel(effectiveTimeZone)}</p>
        </div>
        <ChevronRight className="mt-1 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-amber-600" size={22} aria-hidden="true" />
      </div>
    </Link>
  )
}

export default function RecipientPortalOverviewClient({
  initialOverview,
}: {
  initialOverview: RecipientPortalOverview
}) {
  const router = useRouter()
  const taskListRef = useRef<HTMLElement>(null)
  const [view, setView] = useState<ViewKey>('current')
  const [analyticsPeriod, setAnalyticsPeriod] = useState<AnalyticsPeriod>(
    initialOverview.analytics.defaultPeriod
  )
  const [filter, setFilter] = useState<FilterKey>('active')
  const [search, setSearch] = useState('')
  const [taskDrilldown, setTaskDrilldown] = useState<TaskDrilldown | null>(null)
  const [signingOut, setSigningOut] = useState(false)

  const currentAnalytics = initialOverview.analytics.self.current
  const deliveryAnalytics = initialOverview.analytics.self.deliveryByPeriod[analyticsPeriod]
  const drilldownTaskIds = useMemo(
    () => taskDrilldown ? new Set(taskDrilldown.taskIds) : null,
    [taskDrilldown]
  )

  const visibleTasks = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('sv-SE')
    return initialOverview.tasks.filter((task) => {
      if (drilldownTaskIds && !drilldownTaskIds.has(task.id)) return false
      if (!matchesFilter(task, filter)) return false
      if (!query) return true
      return [task.title, task.contextLabel, task.organizationName, task.issuerName]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLocaleLowerCase('sv-SE').includes(query))
    })
  }, [drilldownTaskIds, filter, initialOverview.tasks, search])

  const openTaskDrilldown = (label: string, taskIds: string[]) => {
    setTaskDrilldown({ label, taskIds })
    setFilter('all')
    setSearch('')
    setView('current')
  }

  useEffect(() => {
    if (view !== 'current' || !taskDrilldown) return
    const frame = window.requestAnimationFrame(() => {
      taskListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [taskDrilldown, view])

  const selectFilter = (nextFilter: FilterKey) => {
    setTaskDrilldown(null)
    setFilter(nextFilter)
  }

  const approvedTotal = deliveryAnalytics.approvedCount
  const deliverySegments = [
    {
      key: 'on-time',
      label: 'I tid',
      count: deliveryAnalytics.onTimeCount,
      percent: percentOf(deliveryAnalytics.onTimeCount, approvedTotal),
      taskIds: deliveryAnalytics.taskIds.onTime,
      barClassName: 'bg-emerald-500 hover:bg-emerald-600',
      dotClassName: 'bg-emerald-500',
    },
    {
      key: 'late',
      label: 'Sent',
      count: deliveryAnalytics.lateCount,
      percent: percentOf(deliveryAnalytics.lateCount, approvedTotal),
      taskIds: deliveryAnalytics.taskIds.late,
      barClassName: 'bg-rose-500 hover:bg-rose-600',
      dotClassName: 'bg-rose-500',
    },
    {
      key: 'unknown',
      label: 'Okänt',
      count: deliveryAnalytics.unknownCount,
      percent: percentOf(deliveryAnalytics.unknownCount, approvedTotal),
      taskIds: deliveryAnalytics.taskIds.unknown,
      barClassName: 'bg-slate-300 hover:bg-slate-400',
      dotClassName: 'bg-slate-400',
    },
  ]

  const signOut = async () => {
    if (signingOut) return
    setSigningOut(true)
    await supabase.auth.signOut()
    router.replace('/mina-uppdrag/logga-in')
    router.refresh()
  }

  const filters: Array<{ key: FilterKey; label: string; count: number }> = [
    { key: 'active', label: 'Aktiva', count: initialOverview.summary.active },
    { key: 'needs_action', label: 'Ditt nästa steg', count: initialOverview.summary.needsAction },
    { key: 'overdue', label: 'Försenade', count: initialOverview.summary.overdue },
    { key: 'completed', label: 'Avslutade', count: initialOverview.tasks.length - initialOverview.summary.active },
    { key: 'all', label: 'Alla', count: initialOverview.tasks.length },
  ]

  return (
    <main className="min-h-dvh bg-[#f6f4ef] text-slate-950">
      <header className="sticky top-0 z-30 border-b border-amber-200/70 bg-white/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-4 py-3 sm:px-6">
          <SigneMark />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-700">Mina uppdrag</p>
            <p className="truncate text-sm text-slate-600">Hej {initialOverview.recipientName}</p>
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            disabled={signingOut}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
          >
            <LogOut size={17} aria-hidden="true" />
            <span className="hidden sm:inline">{signingOut ? 'Loggar ut…' : 'Logga ut'}</span>
          </button>
        </div>
      </header>

      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-9">
        <section className="overflow-hidden rounded-[2rem] border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-orange-50 p-5 shadow-xl shadow-amber-950/5 sm:p-8">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-700">Gizmo håller koll</p>
          <div className="mt-2 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Det här behöver bli gjort</h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600 sm:text-base">
                Här finns bara uppdrag som är tilldelade till dig. Öppna en uppgift för att svara,
                ladda upp underlag eller meddela om något hindrar arbetet.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:min-w-[25rem]">
              <div className="rounded-2xl border border-white/80 bg-white/85 p-3 shadow-sm">
                <CircleDot className="text-indigo-600" size={19} aria-hidden="true" />
                <p className="mt-2 text-2xl font-semibold">{initialOverview.summary.active}</p>
                <p className="text-xs text-slate-500">Aktiva</p>
              </div>
              <div className="rounded-2xl border border-white/80 bg-white/85 p-3 shadow-sm">
                <ClipboardCheck className="text-amber-600" size={19} aria-hidden="true" />
                <p className="mt-2 text-2xl font-semibold">{initialOverview.summary.needsAction}</p>
                <p className="text-xs text-slate-500">Nästa steg</p>
              </div>
              <div className="rounded-2xl border border-white/80 bg-white/85 p-3 shadow-sm">
                <AlertTriangle className="text-rose-600" size={19} aria-hidden="true" />
                <p className="mt-2 text-2xl font-semibold">{initialOverview.summary.overdue}</p>
                <p className="text-xs text-slate-500">Försenade</p>
              </div>
            </div>
          </div>
        </section>

        <div
          className="mt-5 inline-flex w-full rounded-2xl border border-slate-200 bg-white p-1 shadow-sm sm:w-auto"
          role="tablist"
          aria-label="Välj uppdragsvy"
        >
          <button
            type="button"
            role="tab"
            aria-selected={view === 'current'}
            aria-controls="recipient-current-panel"
            onClick={() => setView('current')}
            className={`min-h-11 flex-1 rounded-xl px-4 text-sm font-semibold transition sm:flex-none ${
              view === 'current'
                ? 'bg-slate-950 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950'
            }`}
          >
            Aktuella uppdrag
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'statistics'}
            aria-controls="recipient-statistics-panel"
            onClick={() => setView('statistics')}
            className={`inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition sm:flex-none ${
              view === 'statistics'
                ? 'bg-slate-950 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950'
            }`}
          >
            <BarChart3 size={17} aria-hidden="true" /> Min statistik
          </button>
        </div>

        {view === 'statistics' ? (
          <section
            id="recipient-statistics-panel"
            role="tabpanel"
            className="mt-5 rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-7"
            aria-labelledby="recipient-statistics-heading"
          >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-700">Leveransöversikt</p>
                <h2 id="recipient-statistics-heading" className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">
                  Så går dina uppdrag
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                  I tid mäts när ett godkänt uppdrag senast skickades in för kontroll jämfört med då gällande slutdatum.
                  Perioden påverkar leveranshistoriken; nuläget visas alltid som det ser ut nu.
                  Arkiverade uppdrag ingår inte.
                </p>
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Period</p>
                <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1" role="group" aria-label="Välj statistikperiod">
                  {ANALYTICS_PERIODS.map((periodOption) => (
                    <button
                      key={periodOption.key}
                      type="button"
                      onClick={() => setAnalyticsPeriod(periodOption.key)}
                      aria-pressed={analyticsPeriod === periodOption.key}
                      className={`min-h-10 shrink-0 rounded-lg px-3 text-xs font-semibold transition ${
                        analyticsPeriod === periodOption.key
                          ? 'bg-white text-slate-950 shadow-sm'
                          : 'text-slate-600 hover:text-slate-950'
                      }`}
                    >
                      {periodOption.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {deliveryAnalytics.limitedSample ? (
              <div className="mt-5 flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
                <AlertTriangle className="mt-0.5 shrink-0 text-amber-700" size={19} aria-hidden="true" />
                <div>
                  <p className="text-sm font-semibold">Begränsat underlag</p>
                  <p className="mt-1 text-xs leading-5 text-amber-900/80">
                    Färre än fem mätbara, godkända uppdrag ingår i perioden. Procenten visas, men bör tolkas försiktigt.
                  </p>
                </div>
              </div>
            ) : null}

            <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <AnalyticsKpiCard
                label="I tid"
                value={percentLabel(deliveryAnalytics.onTimePercent)}
                detail={`${deliveryAnalytics.onTimeCount} av ${deliveryAnalytics.measuredCount} mätbara`}
                icon={<CheckCircle2 size={20} aria-hidden="true" />}
                tone="bg-emerald-100 text-emerald-700"
                limitedSample={deliveryAnalytics.limitedSample}
                onClick={() => openTaskDrilldown(
                  `I tid · ${ANALYTICS_PERIODS.find((item) => item.key === analyticsPeriod)?.label ?? ''}`,
                  deliveryAnalytics.taskIds.onTime
                )}
              />
              <AnalyticsKpiCard
                label="Försenade nu"
                value={String(currentAnalytics.overdueCount)}
                detail={`${percentOf(currentAnalytics.overdueCount, currentAnalytics.activeCount)} % av ${currentAnalytics.activeCount} aktiva`}
                icon={<AlertTriangle size={20} aria-hidden="true" />}
                tone="bg-rose-100 text-rose-700"
                onClick={() => openTaskDrilldown('Försenade nu', currentAnalytics.taskIds.overdue)}
              />
              <AnalyticsKpiCard
                label="Inom 7 dagar"
                value={String(currentAnalytics.dueWithin7DaysCount)}
                detail={`${percentOf(currentAnalytics.dueWithin7DaysCount, currentAnalytics.activeCount)} % av ${currentAnalytics.activeCount} aktiva`}
                icon={<CalendarDays size={20} aria-hidden="true" />}
                tone="bg-amber-100 text-amber-700"
                onClick={() => openTaskDrilldown('Klart inom 7 dagar', currentAnalytics.taskIds.dueWithin7Days)}
              />
              <AnalyticsKpiCard
                label="Väntar på besked"
                value={String(currentAnalytics.awaitingReviewCount)}
                detail={`${percentOf(currentAnalytics.awaitingReviewCount, currentAnalytics.activeCount)} % av ${currentAnalytics.activeCount} aktiva`}
                icon={<ClipboardCheck size={20} aria-hidden="true" />}
                tone="bg-violet-100 text-violet-700"
                onClick={() => openTaskDrilldown('Väntar på besked', currentAnalytics.taskIds.awaitingReview)}
              />
            </div>

            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 sm:p-5">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h3 className="text-base font-semibold text-slate-950">Leveranser i perioden</h3>
                  <p className="mt-1 text-xs text-slate-500">{approvedTotal} godkända uppdrag totalt</p>
                </div>
                <p className="text-xs font-medium text-slate-500">
                  {deliveryAnalytics.measuredCount} mätbara · {deliveryAnalytics.unknownCount} okända
                </p>
              </div>

              {approvedTotal > 0 ? (
                <div className="mt-4 flex h-4 w-full overflow-hidden rounded-full bg-slate-200" aria-label="Fördelning av leveranser">
                  {deliverySegments.filter((segment) => segment.count > 0).map((segment) => (
                    <button
                      key={segment.key}
                      type="button"
                      onClick={() => openTaskDrilldown(
                        `${segment.label} · ${ANALYTICS_PERIODS.find((item) => item.key === analyticsPeriod)?.label ?? ''}`,
                        segment.taskIds
                      )}
                      className={`${segment.barClassName} min-w-1 transition focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white`}
                      style={{ flexGrow: segment.count, flexBasis: 0 }}
                      aria-label={`${segment.label}: ${segment.count} uppdrag, ${segment.percent} procent`}
                    />
                  ))}
                </div>
              ) : (
                <div className="mt-4 h-4 w-full rounded-full bg-slate-200" aria-label="Inga godkända leveranser i perioden" />
              )}

              <div className="mt-4 grid grid-cols-3 gap-2">
                {deliverySegments.map((segment) => (
                  <button
                    key={segment.key}
                    type="button"
                    onClick={() => openTaskDrilldown(
                      `${segment.label} · ${ANALYTICS_PERIODS.find((item) => item.key === analyticsPeriod)?.label ?? ''}`,
                      segment.taskIds
                    )}
                    className="min-w-0 rounded-xl border border-slate-200 bg-white px-2 py-3 text-left transition hover:border-amber-300 hover:shadow-sm focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-100 sm:px-3"
                  >
                    <span className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${segment.dotClassName}`} />
                      <span className="truncate">{segment.label}</span>
                    </span>
                    <span className="mt-1 block text-sm font-bold text-slate-950 sm:text-base">
                      {segment.count} · {segment.percent} %
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </section>
        ) : (
        <section
          ref={taskListRef}
          id="recipient-current-panel"
          role="tabpanel"
          className="mt-6 scroll-mt-24"
          aria-labelledby="recipient-task-list-heading"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 id="recipient-task-list-heading" className="text-xl font-semibold tracking-tight">Uppgifter</h2>
            <label className="relative block w-full sm:max-w-xs">
              <span className="sr-only">Sök uppdrag</span>
              <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={18} aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Sök uppdrag eller projekt"
                className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white pl-11 pr-4 text-base outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
              />
            </label>
          </div>

          {taskDrilldown ? (
            <div className="mt-4 flex flex-wrap items-center gap-2" role="status">
              <span className="inline-flex min-h-10 items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-3 text-sm font-semibold text-amber-950">
                Visar: {taskDrilldown.label}
                <span className="rounded-full bg-white px-2 py-0.5 text-xs text-amber-800">{visibleTasks.length}</span>
                <button
                  type="button"
                  onClick={() => setTaskDrilldown(null)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full text-amber-800 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                  aria-label={`Ta bort filtret ${taskDrilldown.label}`}
                >
                  <X size={15} aria-hidden="true" />
                </button>
              </span>
            </div>
          ) : null}

          <div className="mt-4 flex gap-2 overflow-x-auto pb-2" role="tablist" aria-label="Filtrera uppdrag">
            {filters.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={filter === item.key}
                onClick={() => selectFilter(item.key)}
                className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition ${
                  filter === item.key
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                }`}
              >
                {item.label}
                <span className={`rounded-full px-2 py-0.5 text-xs ${filter === item.key ? 'bg-white/15' : 'bg-slate-100'}`}>
                  {item.count}
                </span>
              </button>
            ))}
          </div>

          {visibleTasks.length > 0 ? (
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              {visibleTasks.map((task) => <TaskCard key={task.id} task={task} />)}
            </div>
          ) : (
            <div className="mt-4 rounded-3xl border border-dashed border-slate-300 bg-white/70 px-5 py-12 text-center">
              <CheckCircle2 className="mx-auto text-emerald-600" size={32} aria-hidden="true" />
              <h3 className="mt-3 text-lg font-semibold">Inga uppdrag här just nu</h3>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">
                {initialOverview.tasks.length === 0
                  ? 'När någon tilldelar dig ett uppdrag visas det här automatiskt.'
                  : 'Byt filter eller sök efter något annat.'}
              </p>
            </div>
          )}
        </section>
        )}
      </div>
    </main>
  )
}
