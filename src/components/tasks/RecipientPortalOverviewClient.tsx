'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  ClipboardCheck,
  LogOut,
  Search,
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

const TERMINAL_STATUSES = new Set(['approved', 'cancelled'])

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
  const [filter, setFilter] = useState<FilterKey>('active')
  const [search, setSearch] = useState('')
  const [signingOut, setSigningOut] = useState(false)

  const visibleTasks = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('sv-SE')
    return initialOverview.tasks.filter((task) => {
      if (!matchesFilter(task, filter)) return false
      if (!query) return true
      return [task.title, task.contextLabel, task.organizationName, task.issuerName]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLocaleLowerCase('sv-SE').includes(query))
    })
  }, [filter, initialOverview.tasks, search])

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
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-700">Signe håller koll</p>
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

        <section className="mt-6" aria-labelledby="recipient-task-list-heading">
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

          <div className="mt-4 flex gap-2 overflow-x-auto pb-2" role="tablist" aria-label="Filtrera uppdrag">
            {filters.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={filter === item.key}
                onClick={() => setFilter(item.key)}
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
      </div>
    </main>
  )
}
