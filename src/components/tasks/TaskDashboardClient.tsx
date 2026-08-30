'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  BarChart3,
  ChevronLeft,
  CheckCircle2,
  ChevronRight,
  ChevronsUpDown,
  CircleDot,
  Clock3,
  ListFilter,
  MessageCircle,
  Plus,
  Repeat2,
  RefreshCw,
  Search,
  UserRoundCheck,
  X,
} from 'lucide-react'
import Protected from '@/components/Protected'
import { useToast } from '@/components/ui/AppToastProvider'
import type {
  TaskActionResponse,
  TaskAnalyticsPeriod,
  TaskAiSuggestionView,
  TaskView,
  TaskWorkspace,
} from '@/lib/tasks/contracts'
import {
  formatTaskDateTime,
  normalizeTaskTimeZone,
  taskTimeZoneLabel,
} from '@/lib/tasks/dateTime'
import TaskComposerSheet from './TaskComposerSheet'
import TaskDetailSheet from './TaskDetailSheet'
import TaskIssuerAnalyticsPanel from './TaskIssuerAnalyticsPanel'
import { SigneCheckIcon } from './SigneMark'
import { TaskRiskDot, TaskStatusBadge } from './TaskStatusBadge'

type FilterKey = 'all' | 'my_ball' | 'review' | 'overdue' | 'unread'
type WorkspaceView = 'current' | 'statistics'
type SortField = 'title' | 'status' | 'assignee' | 'due' | 'updated'
type SortDirection = 'asc' | 'desc'

const TASK_LIST_STORAGE_KEY = 'hushub:tasks:list-view:v1'
const TASK_PAGE_SIZE_OPTIONS = [10, 25, 50] as const
const TASK_COLLATOR = new Intl.Collator('sv', { sensitivity: 'base', numeric: true })

type Props = {
  initialWorkspace: TaskWorkspace | null
  initialError: string | null
}

type TaskDrilldown = {
  label: string
  taskIds: string[]
}

function taskMatchesFilter(task: TaskView, filter: FilterKey, userId: string) {
  if (filter === 'unread') return task.unreadMessageCount > 0
  if (filter === 'overdue') return task.risk === 'red' && !['approved', 'cancelled'].includes(task.status)
  if (filter === 'review') {
    return (
      task.issuerId === userId &&
      (task.status === 'ready_for_review' ||
        task.deadlineRequests.some((request) => request.status === 'pending'))
    )
  }
  if (filter === 'my_ball') {
    if (task.ballHolder === 'issuer') return task.issuerId === userId
    return task.ballHolder === 'assignee' && task.assignee.kind === 'profile' && task.assignee.id === userId
  }
  return true
}

function ballText(task: TaskView) {
  return task.ballHolder === 'issuer'
    ? task.issuerName
    : task.ballHolder === 'assignee'
      ? task.assignee.name
      : 'Avslutad'
}

function statusSortRank(status: TaskView['status']) {
  return {
    ready_for_review: 0,
    returned: 1,
    waiting: 2,
    in_progress: 3,
    assigned: 4,
    draft: 5,
    approved: 6,
    cancelled: 7,
  }[status]
}

function latestMessageLabel(task: TaskView) {
  if (!task.latestMessage) return 'Inga meddelanden'
  return `${task.latestMessage.actorName}: ${task.latestMessage.message}`
}

function recurrenceShortLabel(task: TaskView) {
  if (task.recurrenceInterval === 'weekly') return 'Varje vecka'
  if (task.recurrenceInterval === 'monthly') return 'Varje månad'
  if (task.recurrenceInterval === 'quarterly') return 'Varje kvartal'
  if (task.recurrenceInterval === 'yearly') return 'Varje år'
  return null
}

function SortButton({
  field,
  label,
  activeField,
  direction,
  onChange,
}: {
  field: SortField
  label: string
  activeField: SortField
  direction: SortDirection
  onChange: (field: SortField) => void
}) {
  const active = field === activeField
  return (
    <button
      type="button"
      onClick={() => onChange(field)}
      className="inline-flex items-center gap-1 font-semibold text-slate-600 hover:text-slate-950"
    >
      {label}
      <ChevronsUpDown size={13} className={active ? 'text-slate-900' : 'text-slate-300'} />
      <span className="sr-only">{active ? `Sorterat ${direction === 'asc' ? 'stigande' : 'fallande'}` : 'Sortera'}</span>
    </button>
  )
}

function SummaryCard({
  label,
  value,
  icon,
  tone,
  onClick,
}: {
  label: string
  value: number
  icon: React.ReactNode
  tone: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-w-0 rounded-2xl border border-white/70 bg-white/90 p-4 text-left shadow-sm ring-1 ring-slate-950/5 transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <span className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${tone}`}>{icon}</span>
      <span className="mt-3 block text-2xl font-semibold tracking-tight text-slate-950">{value}</span>
      <span className="mt-0.5 block truncate text-xs font-medium text-slate-600 sm:text-sm">{label}</span>
    </button>
  )
}

function TaskCard({
  task,
  parentTitle,
  onClick,
}: {
  task: TaskView
  parentTitle: string | null
  onClick: () => void
}) {
  const holder = ballText(task)
  const effectiveTimeZone = normalizeTaskTimeZone(task.dueTimeZone)
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group w-full rounded-2xl border p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
        task.unreadMessageCount > 0
          ? 'border-blue-300 bg-blue-50/80 ring-1 ring-blue-100'
          : task.depth > 0
            ? 'border-slate-200 border-l-4 border-l-slate-300 bg-white'
            : 'border-slate-200 bg-white'
      }`}
    >
      {parentTitle ? (
        <p className="mb-2 truncate text-xs font-medium text-slate-400">
          {'↳ '.repeat(Math.min(task.depth, 2))}{parentTitle}
        </p>
      ) : null}
      <div className="flex items-start gap-3">
        <div className="pt-1.5"><TaskRiskDot risk={task.risk} /></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <TaskStatusBadge status={task.status} />
            {recurrenceShortLabel(task) ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800">
                <Repeat2 size={12} /> {recurrenceShortLabel(task)}
              </span>
            ) : null}
            {task.unreadMessageCount > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-600 px-2 py-1 text-[11px] font-semibold text-white">
                <MessageCircle size={12} /> {task.unreadMessageCount} nya
              </span>
            ) : null}
            {task.contextLabel ? <span className="truncate text-xs font-medium text-slate-500">{task.contextLabel}</span> : null}
          </div>
          <h2 className={`mt-2 text-base leading-snug text-slate-950 ${task.unreadMessageCount > 0 ? 'font-bold' : 'font-semibold'}`}>{task.title}</h2>
          {task.description ? <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-600">{task.description}</p> : null}
          <div className="mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-2">
            <span className="flex min-w-0 items-center gap-1.5">
              <UserRoundCheck size={14} className="shrink-0" />
              <span className="truncate">Bollen hos: <strong className="font-semibold text-slate-700">{holder}</strong></span>
            </span>
            <span className="flex items-center gap-1.5">
              <Clock3 size={14} className="shrink-0" />
              Klart {formatTaskDateTime(task.dueAt, effectiveTimeZone, 'compact')}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-400">{taskTimeZoneLabel(effectiveTimeZone)}</p>
          {task.latestMessage ? (
            <p className="mt-3 line-clamp-2 rounded-xl border border-blue-100 bg-white/80 px-3 py-2 text-xs leading-5 text-slate-600">
              <span className="font-semibold text-slate-800">{task.latestMessage.actorName}:</span>{' '}
              {task.latestMessage.message}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {task.childCount > 0 ? (
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                {task.openChildCount}/{task.childCount} underuppgifter öppna
              </span>
            ) : null}
            {task.requirements.length > 0 ? (
              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800">
                {task.requirements.filter((item) => ['verified', 'not_required', 'waived'].includes(item.status)).length}/{task.requirements.length} kontroller
              </span>
            ) : null}
          </div>
        </div>
        <ChevronRight className="mt-1 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500" size={20} />
      </div>
    </button>
  )
}

export default function TaskDashboardClient({ initialWorkspace, initialError }: Props) {
  const { success: showSuccess, error: showError, warning: showWarning } = useToast()
  const deepLinkHandled = useRef(false)
  const taskListRef = useRef<HTMLElement>(null)
  const [workspace, setWorkspace] = useState(initialWorkspace)
  const [workspaceError, setWorkspaceError] = useState(initialError)
  const [busy, setBusy] = useState(false)
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>('current')
  const [analyticsPeriod, setAnalyticsPeriod] = useState<TaskAnalyticsPeriod>(
    initialWorkspace?.analytics.defaultPeriod ?? '90d'
  )
  const [taskDrilldown, setTaskDrilldown] = useState<TaskDrilldown | null>(null)
  const [filter, setFilter] = useState<FilterKey>('all')
  const [search, setSearch] = useState('')
  const workspaceTimeZone = normalizeTaskTimeZone(workspace?.timeZone)
  const [sortField, setSortField] = useState<SortField>('due')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [pageSize, setPageSize] = useState<number>(25)
  const [page, setPage] = useState(1)
  const [listPreferencesLoaded, setListPreferencesLoaded] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [composerOpen, setComposerOpen] = useState(false)
  const [composerParentId, setComposerParentId] = useState<string | null>(null)
  const [composerSuggestion, setComposerSuggestion] = useState<TaskAiSuggestionView | null>(null)

  const selectedTask = workspace?.tasks.find((task) => task.id === selectedTaskId) ?? null
  const composerParent = workspace?.tasks.find((task) => task.id === composerParentId) ?? null

  useEffect(() => {
    if (deepLinkHandled.current || !workspace) return

    deepLinkHandled.current = true
    const taskId = new URLSearchParams(window.location.search).get('task')
    if (taskId && workspace.tasks.some((task) => task.id === taskId)) {
      setSelectedTaskId(taskId)
    }
  }, [workspace])

  const drilldownTaskIds = useMemo(
    () => taskDrilldown ? new Set(taskDrilldown.taskIds) : null,
    [taskDrilldown]
  )

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(TASK_LIST_STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<{
          filter: FilterKey
          search: string
          sortField: SortField
          sortDirection: SortDirection
          pageSize: number
        }>
        if (['all', 'my_ball', 'review', 'overdue', 'unread'].includes(parsed.filter ?? '')) {
          setFilter(parsed.filter as FilterKey)
        }
        if (typeof parsed.search === 'string') setSearch(parsed.search)
        if (['title', 'status', 'assignee', 'due', 'updated'].includes(parsed.sortField ?? '')) {
          setSortField(parsed.sortField as SortField)
        }
        if (parsed.sortDirection === 'asc' || parsed.sortDirection === 'desc') {
          setSortDirection(parsed.sortDirection)
        }
        if (TASK_PAGE_SIZE_OPTIONS.includes(parsed.pageSize as 10 | 25 | 50)) {
          setPageSize(parsed.pageSize as number)
        }
      }
    } catch {
      // A corrupt local preference must never block the task list.
    } finally {
      setListPreferencesLoaded(true)
    }
  }, [])

  useEffect(() => {
    if (!listPreferencesLoaded) return
    window.localStorage.setItem(
      TASK_LIST_STORAGE_KEY,
      JSON.stringify({ filter, search, sortField, sortDirection, pageSize })
    )
  }, [filter, listPreferencesLoaded, pageSize, search, sortDirection, sortField])

  useEffect(() => {
    setPage(1)
  }, [drilldownTaskIds, filter, pageSize, search, sortDirection, sortField])

  const visibleTasks = useMemo(() => {
    if (!workspace) return []
    const term = search.trim().toLocaleLowerCase('sv-SE')
    const byId = new Map(workspace.tasks.map((task) => [task.id, task]))
    return workspace.tasks
      .filter((task) => !drilldownTaskIds || drilldownTaskIds.has(task.id))
      .filter((task) => taskMatchesFilter(task, filter, workspace.currentUser.id))
      .filter((task) => {
        if (!term) return true
        return [task.title, task.description, task.contextLabel, task.assignee.name, task.issuerName]
          .filter(Boolean)
          .some((value) => String(value).toLocaleLowerCase('sv-SE').includes(term))
      })
      .sort((a, b) => {
        let comparison = 0
        if (sortField === 'title') comparison = TASK_COLLATOR.compare(a.title, b.title)
        if (sortField === 'status') comparison = statusSortRank(a.status) - statusSortRank(b.status)
        if (sortField === 'assignee') comparison = TASK_COLLATOR.compare(a.assignee.name, b.assignee.name)
        if (sortField === 'due') comparison = new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()
        if (sortField === 'updated') {
          comparison = new Date(a.latestMessage?.createdAt ?? a.updatedAt).getTime() - new Date(b.latestMessage?.createdAt ?? b.updatedAt).getTime()
        }
        if (comparison === 0) comparison = TASK_COLLATOR.compare(a.title, b.title)
        return sortDirection === 'asc' ? comparison : -comparison
      })
      .map((task) => ({ task, parentTitle: task.parentTaskId ? byId.get(task.parentTaskId)?.title ?? null : null }))
  }, [drilldownTaskIds, filter, search, sortDirection, sortField, workspace])

  const filterCounts = useMemo(() => {
    if (!workspace) return { all: 0, my_ball: 0, review: 0, overdue: 0, unread: 0 }
    return {
      all: workspace.tasks.length,
      my_ball: workspace.tasks.filter((task) => taskMatchesFilter(task, 'my_ball', workspace.currentUser.id)).length,
      review: workspace.tasks.filter((task) => taskMatchesFilter(task, 'review', workspace.currentUser.id)).length,
      overdue: workspace.tasks.filter((task) => taskMatchesFilter(task, 'overdue', workspace.currentUser.id)).length,
      unread: workspace.tasks.filter((task) => task.unreadMessageCount > 0).length,
    }
  }, [workspace])

  const totalPages = Math.max(1, Math.ceil(visibleTasks.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pagedTasks = visibleTasks.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  const changeSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortField(field)
    setSortDirection(field === 'updated' ? 'desc' : 'asc')
  }

  const selectTaskFilter = (nextFilter: FilterKey) => {
    setTaskDrilldown(null)
    setFilter(nextFilter)
  }

  const openAnalyticsDrilldown = (label: string, taskIds: string[]) => {
    setTaskDrilldown({ label, taskIds })
    setFilter('all')
    setSearch('')
    setWorkspaceView('current')
  }

  useEffect(() => {
    if (workspaceView !== 'current' || !taskDrilldown) return
    const frame = window.requestAnimationFrame(() => {
      taskListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [taskDrilldown, workspaceView])

  const refresh = async () => {
    setBusy(true)
    setWorkspaceError(null)
    try {
      const response = await fetch('/api/tasks', { cache: 'no-store' })
      const body = (await response.json().catch(() => ({}))) as { workspace?: TaskWorkspace; error?: string }
      if (!response.ok || !body.workspace) throw new Error(body.error || 'Kunde inte hämta uppgifterna.')
      setWorkspace(body.workspace)
    } catch (refreshError) {
      const message = refreshError instanceof Error ? refreshError.message : 'Kunde inte hämta uppgifterna.'
      if (workspace) showError(message)
      else setWorkspaceError(message)
    } finally {
      setBusy(false)
    }
  }

  const runAction = async (
    action: string,
    payload: Record<string, unknown>,
    options: { showResultToast?: boolean; showErrorToast?: boolean } = {}
  ): Promise<TaskActionResponse> => {
    setBusy(true)
    try {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, payload }),
      })
      const body = (await response.json().catch(() => ({}))) as Partial<TaskActionResponse> & { error?: string }
      if (!response.ok || !body.workspace) throw new Error(body.error || 'Åtgärden misslyckades.')
      const result: TaskActionResponse = {
        workspace: body.workspace,
        notice: body.notice,
        warning: body.warning,
        accessUrl: body.accessUrl,
        createdTaskId: body.createdTaskId,
      }
      setWorkspace(result.workspace)
      if (options.showResultToast !== false) {
        if (result.warning) showWarning(result.warning)
        else showSuccess(result.notice ?? 'Sparat.')
      }
      return result
    } catch (actionError) {
      if (options.showErrorToast !== false) {
        showError(actionError instanceof Error ? actionError.message : 'Åtgärden misslyckades.')
      }
      throw actionError
    } finally {
      setBusy(false)
    }
  }

  const uploadEvidence = async (taskId: string, formData: FormData, transcribe = false) => {
    setBusy(true)
    try {
      const endpoint = transcribe
        ? `/api/tasks/${taskId}/transcribe`
        : `/api/tasks/${taskId}/attachments`
      const response = await fetch(endpoint, { method: 'POST', body: formData })
      const body = (await response.json().catch(() => ({}))) as Partial<TaskActionResponse> & {
        error?: string
        transcript?: string
      }
      if (!response.ok || !body.workspace) throw new Error(body.error || 'Kunde inte spara underlaget.')
      setWorkspace(body.workspace)
      if (body.warning) showWarning(body.warning)
      else showSuccess(body.notice ?? 'Underlaget sparades.')
    } catch (uploadError) {
      showError(uploadError instanceof Error ? uploadError.message : 'Kunde inte spara underlaget.')
      throw uploadError
    } finally {
      setBusy(false)
    }
  }

  const updateTranscript = async (taskId: string, attachmentId: string, transcript: string) => {
    setBusy(true)
    try {
      const response = await fetch(
        `/api/tasks/${encodeURIComponent(taskId)}/attachments/${encodeURIComponent(attachmentId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript }),
        }
      )
      const body = (await response.json().catch(() => ({}))) as Partial<TaskActionResponse> & {
        error?: string
      }
      if (!response.ok || !body.workspace) {
        throw new Error(body.error || 'Transkriberingen kunde inte uppdateras.')
      }
      setWorkspace(body.workspace)
      showSuccess(body.notice ?? 'Transkriberingen uppdaterades.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Transkriberingen kunde inte uppdateras.'
      showError(message)
      throw error
    } finally {
      setBusy(false)
    }
  }

  const uploadInitialAttachments = async (taskId: string, files: File[]) => {
    if (files.length === 0) return { uploaded: 0, failed: [] as string[] }
    setBusy(true)
    const failed: string[] = []
    let uploaded = 0
    try {
      for (const file of files) {
        try {
          const formData = new FormData()
          formData.append('file', file)
          formData.append('title', file.name)
          formData.append('completionEvidence', 'false')
          const response = await fetch(`/api/tasks/${taskId}/attachments`, {
            method: 'POST',
            body: formData,
          })
          const body = (await response.json().catch(() => ({}))) as Partial<TaskActionResponse> & {
            error?: string
          }
          if (!response.ok || !body.workspace) throw new Error(body.error || 'Uppladdningen misslyckades.')
          setWorkspace(body.workspace)
          uploaded += 1
        } catch {
          failed.push(file.name)
        }
      }
    } finally {
      setBusy(false)
    }
    return { uploaded, failed }
  }

  const openComposer = (
    parent: TaskView | null = null,
    suggestion: TaskAiSuggestionView | null = null
  ) => {
    setComposerParentId(parent?.id ?? null)
    setComposerSuggestion(suggestion)
    setComposerOpen(true)
  }

  return (
    <Protected>
      <main className="relative min-h-full bg-slate-50">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-gradient-to-br from-amber-100 via-orange-50 to-transparent" />
        <div className="relative mx-auto w-full max-w-7xl px-4 pb-28 pt-6 sm:px-6 sm:pb-12 sm:pt-9">
          <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-amber-800">
                <SigneCheckIcon size={17} /> Gizmo håller i uppföljningen
              </div>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">Uppdrag</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
                Se vem som har bollen, vad som riskerar att stanna och vad som väntar på din kontroll.
              </p>
            </div>
            <button
              type="button"
              onClick={() => openComposer()}
              disabled={!workspace || busy}
              className="hidden min-h-12 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white shadow-lg shadow-slate-900/15 hover:bg-slate-800 disabled:opacity-50 sm:inline-flex"
            >
              <Plus size={18} /> Nytt uppdrag
            </button>
          </header>

          {!workspace ? (
            <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-7 text-center shadow-sm sm:p-10">
              <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-800"><AlertTriangle size={23} /></span>
              <h2 className="mt-4 text-xl font-semibold text-slate-950">Uppdrag är inte redo i databasen</h2>
              {workspaceError ? (
                <p role="alert" className="mx-auto mt-2 max-w-xl text-sm font-medium leading-6 text-rose-700">
                  {workspaceError}
                </p>
              ) : null}
              <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">
                Kör Uppdrag-migrationen och försök sedan igen. Inga befintliga EB-, TU- eller ÖB-data ändras av migrationen.
              </p>
              <button
                type="button"
                onClick={refresh}
                disabled={busy}
                className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                <RefreshCw className={busy ? 'animate-spin' : ''} size={17} /> Försök igen
              </button>
            </section>
          ) : (
            <>
              <div
                className="mt-6 inline-flex w-full rounded-2xl border border-slate-200 bg-white p-1 shadow-sm sm:w-auto"
                role="tablist"
                aria-label="Välj uppdragsvy"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={workspaceView === 'current'}
                  onClick={() => setWorkspaceView('current')}
                  className={`min-h-11 flex-1 rounded-xl px-4 text-sm font-semibold transition sm:flex-none ${workspaceView === 'current' ? 'bg-slate-950 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950'}`}
                >
                  Aktuellt
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={workspaceView === 'statistics'}
                  onClick={() => setWorkspaceView('statistics')}
                  className={`inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition sm:flex-none ${workspaceView === 'statistics' ? 'bg-slate-950 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950'}`}
                >
                  <BarChart3 size={17} aria-hidden="true" /> Statistik
                </button>
              </div>

              {workspaceView === 'statistics' ? (
                <TaskIssuerAnalyticsPanel
                  analytics={workspace.analytics}
                  period={analyticsPeriod}
                  onPeriodChange={setAnalyticsPeriod}
                  onDrilldown={openAnalyticsDrilldown}
                />
              ) : (
                <>
                  <section className="mt-7 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
                    <SummaryCard label="Din åtgärd" value={workspace.summary.userHasBall} icon={<UserRoundCheck size={19} />} tone="bg-indigo-100 text-indigo-700" onClick={() => selectTaskFilter('my_ball')} />
                    <SummaryCard label="Väntar på kontroll" value={workspace.summary.awaitingReview} icon={<CheckCircle2 size={19} />} tone="bg-violet-100 text-violet-700" onClick={() => selectTaskFilter('review')} />
                    <SummaryCard label="Nya meddelanden" value={workspace.summary.unreadMessages} icon={<MessageCircle size={19} />} tone="bg-blue-100 text-blue-700" onClick={() => selectTaskFilter('unread')} />
                    <SummaryCard label="Försenade" value={workspace.summary.overdue} icon={<AlertTriangle size={19} />} tone="bg-rose-100 text-rose-700" onClick={() => selectTaskFilter('overdue')} />
                    <SummaryCard label="Aktiva totalt" value={workspace.summary.totalActive} icon={<CircleDot size={19} />} tone="bg-amber-100 text-amber-800" onClick={() => selectTaskFilter('all')} />
                  </section>

                  <section ref={taskListRef} className="mt-7 scroll-mt-24">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {([
                      ['all', 'Alla'],
                      ['my_ball', 'Din åtgärd'],
                      ['review', 'Att kontrollera'],
                      ['unread', 'Olästa'],
                      ['overdue', 'Försenade'],
                    ] as Array<[FilterKey, string]>).map(([key, label]) => (
                      <button
                        type="button"
                        key={key}
                        onClick={() => selectTaskFilter(key)}
                        className={`min-h-10 shrink-0 rounded-full px-4 text-sm font-semibold transition ${filter === key ? 'bg-slate-950 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                      >
                        {label}
                        <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[11px] ${filter === key ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-600'}`}>
                          {filterCounts[key]}
                        </span>
                      </button>
                    ))}
                  </div>
                  <label className="relative block w-full lg:max-w-sm">
                    <Search className="pointer-events-none absolute left-3.5 top-3 text-slate-400" size={18} />
                    <input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Sök uppgift, projekt, uppdragsansvarig eller mottagare"
                      className="min-h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 text-sm outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
                    />
                  </label>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs font-medium text-slate-500">
                  <span className="inline-flex items-center gap-2"><ListFilter size={15} /> {visibleTasks.length} uppgifter visas</span>
                  <label className="inline-flex items-center gap-2">
                    Rader per sida
                    <select
                      value={pageSize}
                      onChange={(event) => setPageSize(Number(event.target.value))}
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700"
                    >
                      {TASK_PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}</option>)}
                    </select>
                  </label>
                </div>

                {taskDrilldown ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2" role="status">
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

                {visibleTasks.length > 0 ? (
                  <>
                    <div className="mt-3 space-y-3 md:hidden">
                      {pagedTasks.map(({ task, parentTitle }) => (
                        <TaskCard key={task.id} task={task} parentTitle={parentTitle} onClick={() => setSelectedTaskId(task.id)} />
                      ))}
                    </div>

                    <div className="mt-3 hidden overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:block">
                      <div className="overflow-x-auto">
                        <table className="min-w-full table-fixed text-left text-sm text-slate-800">
                          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide">
                            <tr>
                              <th className="w-10 px-3 py-3"><span className="sr-only">Risk</span></th>
                              <th className="w-[30%] px-3 py-3"><SortButton field="title" label="Uppdrag" activeField={sortField} direction={sortDirection} onChange={changeSort} /></th>
                              <th className="w-[15%] px-3 py-3"><SortButton field="status" label="Status" activeField={sortField} direction={sortDirection} onChange={changeSort} /></th>
                              <th className="w-[19%] px-3 py-3"><SortButton field="assignee" label="Mottagare / boll" activeField={sortField} direction={sortDirection} onChange={changeSort} /></th>
                              <th className="w-[12%] px-3 py-3"><SortButton field="due" label="Slutdatum" activeField={sortField} direction={sortDirection} onChange={changeSort} /></th>
                              <th className="w-[24%] px-3 py-3"><SortButton field="updated" label="Senaste meddelande" activeField={sortField} direction={sortDirection} onChange={changeSort} /></th>
                            </tr>
                          </thead>
                          <tbody>
                            {pagedTasks.map(({ task, parentTitle }) => (
                              <tr
                                key={task.id}
                                role="button"
                                tabIndex={0}
                                onClick={() => setSelectedTaskId(task.id)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault()
                                    setSelectedTaskId(task.id)
                                  }
                                }}
                                aria-label={`Öppna uppdraget ${task.title}${task.unreadMessageCount > 0 ? `, ${task.unreadMessageCount} olästa meddelanden` : ''}`}
                                className={`cursor-pointer border-b border-slate-100 outline-none transition last:border-b-0 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-400 ${task.unreadMessageCount > 0 ? 'bg-blue-50/70 hover:bg-blue-50' : 'bg-white'}`}
                              >
                                <td className="px-3 py-3 align-middle"><TaskRiskDot risk={task.risk} /></td>
                                <td className="px-3 py-3 align-middle">
                                  <p className={`truncate text-slate-950 ${task.unreadMessageCount > 0 ? 'font-bold' : 'font-semibold'}`}>{task.title}</p>
                                  <p className="mt-0.5 truncate text-xs text-slate-500">
                                    {recurrenceShortLabel(task) ? `${recurrenceShortLabel(task)} · ` : ''}
                                    {parentTitle ? `↳ ${parentTitle}` : task.contextLabel || 'Inget projekt angivet'}
                                  </p>
                                </td>
                                <td className="px-3 py-3 align-middle"><TaskStatusBadge status={task.status} /></td>
                                <td className="px-3 py-3 align-middle">
                                  <p className="truncate font-medium text-slate-800">{task.assignee.name}</p>
                                  <p className="mt-0.5 truncate text-xs text-slate-500">Bollen hos {ballText(task)}</p>
                                </td>
                                <td className="px-3 py-3 align-middle font-medium">
                                  <span className="block whitespace-nowrap">{formatTaskDateTime(task.dueAt, task.dueTimeZone, 'compact')}</span>
                                  <span className="mt-0.5 block text-[11px] font-normal text-slate-400">{taskTimeZoneLabel(task.dueTimeZone)}</span>
                                </td>
                                <td className="px-3 py-3 align-middle">
                                  <div className="flex min-w-0 items-center gap-2">
                                    {task.unreadMessageCount > 0 ? (
                                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-blue-600 px-2 py-1 text-[11px] font-semibold text-white">
                                        <MessageCircle size={11} /> {task.unreadMessageCount}
                                      </span>
                                    ) : <MessageCircle size={15} className="shrink-0 text-slate-300" />}
                                    <p className="truncate text-xs text-slate-600" title={latestMessageLabel(task)}>{latestMessageLabel(task)}</p>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {totalPages > 1 ? (
                      <nav className="mt-4 flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2" aria-label="Sidindelning">
                        <p className="text-xs text-slate-500">Sida {currentPage} av {totalPages}</p>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={currentPage <= 1}
                            onClick={() => setPage(Math.max(1, currentPage - 1))}
                            className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                          ><ChevronLeft size={15} /> Föregående</button>
                          <button
                            type="button"
                            disabled={currentPage >= totalPages}
                            onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
                            className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                          >Nästa <ChevronRight size={15} /></button>
                        </div>
                      </nav>
                    ) : null}
                  </>
                ) : (
                  <div className="mt-4 rounded-3xl border border-dashed border-slate-300 bg-white/70 px-6 py-12 text-center">
                    <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500"><CheckCircle2 size={22} /></span>
                    <h2 className="mt-4 text-lg font-semibold text-slate-900">Inget här just nu</h2>
                    <p className="mt-1 text-sm text-slate-500">Byt filter eller skapa ett nytt uppdrag.</p>
                  </div>
                )}
                  </section>
                </>
              )}
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => openComposer()}
          disabled={!workspace || busy}
          className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 z-20 inline-flex min-h-14 items-center gap-2 rounded-full bg-slate-950 px-5 text-sm font-semibold text-white shadow-2xl shadow-slate-950/30 disabled:opacity-50 sm:hidden"
        >
          <Plus size={20} /> Nytt uppdrag
        </button>

        {workspace ? (
          <>
            {selectedTask ? (
              <TaskDetailSheet
                key={selectedTask.id}
                task={selectedTask}
                workspace={workspace}
                busy={busy}
                onClose={() => setSelectedTaskId(null)}
                onAction={async (action, payload) => {
                  await runAction(action, payload, {
                    showResultToast: action !== 'mark_messages_read',
                    showErrorToast: action !== 'mark_messages_read',
                  })
                }}
                onUpload={uploadEvidence}
                onUpdateTranscript={updateTranscript}
                onCreateSubtask={(task, suggestion) => {
                  setSelectedTaskId(null)
                  openComposer(task, suggestion ?? null)
                }}
                onSelectTask={setSelectedTaskId}
              />
            ) : null}
            {composerOpen ? (
              <TaskComposerSheet
                key={`${composerParentId ?? 'root'}:${composerSuggestion?.id ?? 'manual'}`}
                open
                parentTask={composerParent}
                suggestion={composerSuggestion}
                people={workspace.people}
                currentUserId={workspace.currentUser.id}
                timeZone={workspaceTimeZone}
                busy={busy}
                onClose={() => {
                  setComposerOpen(false)
                  setComposerSuggestion(null)
                }}
                onCreate={async (payload) => {
                  const { attachments, aiSubtasks, ...taskPayload } = payload
                  const isExternalRecipient = !payload.assigneeRef.startsWith('profile:')
                  const createsTaskTree = !payload.parentTaskId && aiSubtasks.length > 0
                  const deferAssignment = attachments.length > 0 || createsTaskTree
                  const created = await runAction(
                    payload.parentTaskId ? 'create_subtask' : 'create_task',
                    {
                      ...taskPayload,
                      sendAssignment: !deferAssignment,
                    },
                    { showResultToast: !deferAssignment }
                  )
                  const createdTaskId = created.createdTaskId
                  if (!createdTaskId) {
                    const message = 'Uppgiften skapades men kunde inte öppnas för bilagor.'
                    showError(message)
                    throw new Error(message)
                  }
                  setComposerOpen(false)
                  setComposerParentId(null)
                  setComposerSuggestion(null)

                  let latestResult = created
                  const createdTaskIds = [createdTaskId]
                  let treeFailure: string | null = null
                  if (createsTaskTree) {
                    const rootTask = latestResult.workspace.tasks.find((task) => task.id === createdTaskId)
                    if (!rootTask) {
                      treeFailure = 'Huvuduppdraget kunde inte läsas tillbaka efter skapandet.'
                    } else {
                      const inheritedAssigneeRef = `${rootTask.assignee.kind}:${rootTask.assignee.id}`
                      for (let index = 0; index < aiSubtasks.length; index += 1) {
                        const subtask = aiSubtasks[index]
                        const currentParent = latestResult.workspace.tasks.find(
                          (task) => task.id === createdTaskId
                        )
                        if (!currentParent) {
                          treeFailure = 'Huvuduppdragets aktuella version kunde inte läsas.'
                          break
                        }
                        try {
                          const childResult = await runAction(
                            'create_subtask',
                            {
                              ...taskPayload,
                              parentTaskId: createdTaskId,
                              recurrenceInterval: '',
                              parentVersion: currentParent.version,
                              sourceAiSuggestionId: null,
                              title: subtask.title,
                              description: subtask.description,
                              assigneeRef: inheritedAssigneeRef,
                              newContact: null,
                              evidenceRequirements: [],
                              sendAssignment: false,
                            },
                            { showResultToast: false, showErrorToast: false }
                          )
                          if (!childResult.createdTaskId) {
                            throw new Error('Underuppgiften saknar id efter skapandet.')
                          }
                          createdTaskIds.push(childResult.createdTaskId)
                          latestResult = childResult
                        } catch (error) {
                          const remaining = aiSubtasks.length - index
                          const detail = error instanceof Error ? error.message : 'Okänt fel.'
                          treeFailure = `${remaining} ${remaining === 1 ? 'underuppgift kunde' : 'underuppgifter kunde'} inte skapas. ${detail}`
                          break
                        }
                      }
                    }
                  }

                  const uploadResult = await uploadInitialAttachments(createdTaskId, attachments)
                  if (treeFailure) {
                    const attachmentFailure = uploadResult.failed.length > 0
                      ? ` Dessutom kunde ${uploadResult.failed.length} ${
                          uploadResult.failed.length === 1 ? 'bilaga' : 'bilagor'
                        } inte sparas: ${uploadResult.failed.join(', ')}.`
                      : ''
                    showWarning(
                      `Huvuduppdraget skapades och ${createdTaskIds.length - 1} ${
                        createdTaskIds.length - 1 === 1 ? 'underuppgift sparades' : 'underuppgifter sparades'
                      }, men hela trädet kunde inte slutföras. ${treeFailure}${attachmentFailure} Ingen mottagare har meddelats.`
                    )
                    setSelectedTaskId(createdTaskId)
                    return
                  }
                  if (uploadResult.failed.length > 0) {
                    let recipientNotice = ''
                    if (deferAssignment && !isExternalRecipient && !createsTaskTree) {
                      try {
                        const dispatched = await runAction(
                          'dispatch_assignment',
                          { taskId: createdTaskId },
                          { showResultToast: false, showErrorToast: false }
                        )
                        recipientNotice = ` ${dispatched.notice ?? 'Gizmo meddelar mottagaren.'}`
                      } catch {
                        recipientNotice = ' Mottagaren kunde inte meddelas automatiskt.'
                      }
                    }
                    showWarning(
                      `Uppgiften skapades och finns kvar i översikten.${recipientNotice} ${
                        uploadResult.failed.length
                      } ${
                        uploadResult.failed.length === 1 ? 'fil kunde' : 'filer kunde'
                      } inte laddas upp: ${uploadResult.failed.join(', ')}. Lägg till dem från uppdraget.${
                        deferAssignment && (isExternalRecipient || createsTaskTree)
                          ? ' Ingen mottagare har därför meddelats ännu.'
                          : ''
                      }`
                    )
                    setSelectedTaskId(createdTaskId)
                    return
                  }

                  if (!deferAssignment) return

                  let dispatchResult = created
                  const dispatchWarnings: string[] = []
                  if (deferAssignment) {
                    for (const taskId of createdTaskIds) {
                      const taskToDispatch = latestResult.workspace.tasks.find((task) => task.id === taskId)
                      if (!taskToDispatch) {
                        showWarning(
                          'Uppdraget och underlagen sparades, men ett uppdrag kunde inte förberedas för utskick. Ingen ytterligare mottagare har meddelats.'
                        )
                        setSelectedTaskId(createdTaskId)
                        return
                      }
                      try {
                        dispatchResult = taskToDispatch.assignee.kind === 'contact'
                          ? await runAction(
                              'issue_access_link',
                              {
                                taskId,
                                sendEmail: true,
                              },
                              { showResultToast: false, showErrorToast: false }
                            )
                          : await runAction(
                              'dispatch_assignment',
                              { taskId },
                              { showResultToast: false, showErrorToast: false }
                            )
                        latestResult = dispatchResult
                        if (dispatchResult.warning) dispatchWarnings.push(dispatchResult.warning)
                      } catch {
                        showWarning(
                          'Uppdraget och underlagen sparades, men alla mottagare kunde inte meddelas. Öppna uppdraget och försök skicka igen.'
                        )
                        setSelectedTaskId(createdTaskId)
                        return
                      }
                    }
                  }

                  const taskTreeMessage = createsTaskTree
                    ? `Huvuduppdraget och ${aiSubtasks.length} ${
                        aiSubtasks.length === 1 ? 'underuppgift skapades' : 'underuppgifter skapades'
                      }.`
                    : dispatchResult.notice ?? 'Uppgiften skapades.'
                  const attachmentMessage = uploadResult.uploaded > 0
                    ? ` ${uploadResult.uploaded} ${uploadResult.uploaded === 1 ? 'bilaga sparades' : 'bilagor sparades'}.`
                    : ''
                  const message = `${taskTreeMessage}${attachmentMessage}`
                  if (dispatchWarnings.length > 0) {
                    showWarning(`${message} ${[...new Set(dispatchWarnings)].join(' ')}`)
                  } else {
                    showSuccess(message)
                  }
                }}
              />
            ) : null}
          </>
        ) : null}
      </main>
    </Protected>
  )
}
