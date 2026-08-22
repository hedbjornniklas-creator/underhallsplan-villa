'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  ListFilter,
  Link2,
  Plus,
  RefreshCw,
  Search,
  UserRoundCheck,
  X,
} from 'lucide-react'
import Protected from '@/components/Protected'
import type {
  TaskActionResponse,
  TaskAiSuggestionView,
  TaskView,
  TaskWorkspace,
} from '@/lib/tasks/contracts'
import TaskComposerSheet from './TaskComposerSheet'
import TaskDetailSheet from './TaskDetailSheet'
import { SigneCheckIcon } from './SigneMark'
import { TaskRiskDot, TaskStatusBadge } from './TaskStatusBadge'

type FilterKey = 'all' | 'my_ball' | 'review' | 'overdue'

type Props = {
  initialWorkspace: TaskWorkspace | null
  initialError: string | null
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short' }).format(new Date(value))
}

function taskMatchesFilter(task: TaskView, filter: FilterKey, userId: string) {
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

function TaskCard({ task, parentTitle, onClick }: { task: TaskView; parentTitle: string | null; onClick: () => void }) {
  const ballText = task.ballHolder === 'issuer' ? task.issuerName : task.ballHolder === 'assignee' ? task.assignee.name : 'Avslutad'
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group w-full rounded-2xl border bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md sm:p-5 ${
        task.depth > 0 ? 'border-l-4 border-l-slate-300' : 'border-slate-200'
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
            {task.contextLabel ? <span className="truncate text-xs font-medium text-slate-500">{task.contextLabel}</span> : null}
          </div>
          <h2 className="mt-2 text-base font-semibold leading-snug text-slate-950 sm:text-lg">{task.title}</h2>
          {task.description ? <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-600">{task.description}</p> : null}
          <div className="mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-2">
            <span className="flex min-w-0 items-center gap-1.5">
              <UserRoundCheck size={14} className="shrink-0" />
              <span className="truncate">Bollen hos: <strong className="font-semibold text-slate-700">{ballText}</strong></span>
            </span>
            <span className="flex items-center gap-1.5">
              <Clock3 size={14} className="shrink-0" />
              Klart {formatDate(task.dueAt)}
            </span>
          </div>
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
  const deepLinkHandled = useRef(false)
  const [workspace, setWorkspace] = useState(initialWorkspace)
  const [error, setError] = useState(initialError)
  const [notice, setNotice] = useState<string | null>(null)
  const [accessLink, setAccessLink] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState<FilterKey>('all')
  const [search, setSearch] = useState('')
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

  const visibleTasks = useMemo(() => {
    if (!workspace) return []
    const term = search.trim().toLocaleLowerCase('sv-SE')
    const byId = new Map(workspace.tasks.map((task) => [task.id, task]))
    return workspace.tasks
      .filter((task) => taskMatchesFilter(task, filter, workspace.currentUser.id))
      .filter((task) => {
        if (!term) return true
        return [task.title, task.description, task.contextLabel, task.assignee.name, task.issuerName]
          .filter(Boolean)
          .some((value) => String(value).toLocaleLowerCase('sv-SE').includes(term))
      })
      .sort((a, b) => {
        if (a.risk !== b.risk) {
          const order = { red: 0, yellow: 1, green: 2 }
          return order[a.risk] - order[b.risk]
        }
        const rootCompare = a.rootTaskId.localeCompare(b.rootTaskId)
        if (rootCompare !== 0) return rootCompare
        if (a.depth !== b.depth) return a.depth - b.depth
        return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()
      })
      .map((task) => ({ task, parentTitle: task.parentTaskId ? byId.get(task.parentTaskId)?.title ?? null : null }))
  }, [filter, search, workspace])

  const refresh = async () => {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/tasks', { cache: 'no-store' })
      const body = (await response.json().catch(() => ({}))) as { workspace?: TaskWorkspace; error?: string }
      if (!response.ok || !body.workspace) throw new Error(body.error || 'Kunde inte hämta uppgifterna.')
      setWorkspace(body.workspace)
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Kunde inte hämta uppgifterna.')
    } finally {
      setBusy(false)
    }
  }

  const runAction = async (action: string, payload: Record<string, unknown>): Promise<TaskActionResponse> => {
    setBusy(true)
    setError(null)
    setNotice(null)
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
      setNotice(result.warning ?? result.notice ?? 'Sparat.')
      if (result.accessUrl) {
        setAccessLink(result.accessUrl)
        try {
          await navigator.clipboard.writeText(result.accessUrl)
        } catch {
          // Länken visas nedan om webbläsaren inte tillåter urklipp.
        }
      }
      return result
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Åtgärden misslyckades.')
      throw actionError
    } finally {
      setBusy(false)
    }
  }

  const uploadEvidence = async (taskId: string, formData: FormData, transcribe = false) => {
    setBusy(true)
    setError(null)
    setNotice(null)
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
      setNotice(body.notice ?? 'Underlaget sparades.')
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Kunde inte spara underlaget.')
      throw uploadError
    } finally {
      setBusy(false)
    }
  }

  const uploadInitialAttachments = async (taskId: string, files: File[]) => {
    if (files.length === 0) return { uploaded: 0, failed: [] as string[] }
    setBusy(true)
    setError(null)
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
        <div className="relative mx-auto w-full max-w-6xl px-4 pb-28 pt-6 sm:px-6 sm:pb-12 sm:pt-9">
          <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-amber-800">
                <SigneCheckIcon size={17} /> Signe håller i uppföljningen
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

          {notice ? (
            <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900">
              <span className="flex items-center gap-2"><CheckCircle2 size={18} /> {notice}</span>
              <button type="button" onClick={() => setNotice(null)} className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-emerald-100" aria-label="Stäng">
                <X size={17} />
              </button>
            </div>
          ) : null}

          {accessLink ? (
            <div className="mt-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">
              <div className="flex items-start gap-3">
                <Link2 className="mt-0.5 shrink-0" size={18} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">Mottagarens uppdragslänk</p>
                  <a href={accessLink} target="_blank" rel="noreferrer" className="mt-1 block truncate text-xs underline underline-offset-2">
                    {accessLink}
                  </a>
                </div>
                <button type="button" onClick={() => setAccessLink(null)} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-blue-100" aria-label="Stäng">
                  <X size={17} />
                </button>
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="mt-5 flex items-start justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
              <span className="flex items-start gap-2"><AlertTriangle className="mt-0.5 shrink-0" size={18} /> {error}</span>
              <button type="button" onClick={() => setError(null)} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-rose-100" aria-label="Stäng">
                <X size={17} />
              </button>
            </div>
          ) : null}

          {!workspace ? (
            <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-7 text-center shadow-sm sm:p-10">
              <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-800"><AlertTriangle size={23} /></span>
              <h2 className="mt-4 text-xl font-semibold text-slate-950">Uppdrag är inte redo i databasen</h2>
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
              <section className="mt-7 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <SummaryCard label="Din åtgärd" value={workspace.summary.userHasBall} icon={<UserRoundCheck size={19} />} tone="bg-indigo-100 text-indigo-700" onClick={() => setFilter('my_ball')} />
                <SummaryCard label="Väntar på kontroll" value={workspace.summary.awaitingReview} icon={<CheckCircle2 size={19} />} tone="bg-violet-100 text-violet-700" onClick={() => setFilter('review')} />
                <SummaryCard label="Försenade" value={workspace.summary.overdue} icon={<AlertTriangle size={19} />} tone="bg-rose-100 text-rose-700" onClick={() => setFilter('overdue')} />
                <SummaryCard label="Aktiva totalt" value={workspace.summary.totalActive} icon={<CircleDot size={19} />} tone="bg-amber-100 text-amber-800" onClick={() => setFilter('all')} />
              </section>

              <section className="mt-7">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {([
                      ['all', 'Alla'],
                      ['my_ball', 'Din åtgärd'],
                      ['review', 'Att kontrollera'],
                      ['overdue', 'Försenade'],
                    ] as Array<[FilterKey, string]>).map(([key, label]) => (
                      <button
                        type="button"
                        key={key}
                        onClick={() => setFilter(key)}
                        className={`min-h-10 shrink-0 rounded-full px-4 text-sm font-semibold transition ${filter === key ? 'bg-slate-950 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                      >
                        {label}
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

                <div className="mt-4 flex items-center gap-2 text-xs font-medium text-slate-500">
                  <ListFilter size={15} /> {visibleTasks.length} uppgifter visas
                </div>

                {visibleTasks.length > 0 ? (
                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    {visibleTasks.map(({ task, parentTitle }) => (
                      <TaskCard key={task.id} task={task} parentTitle={parentTitle} onClick={() => setSelectedTaskId(task.id)} />
                    ))}
                  </div>
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
                  await runAction(action, payload)
                }}
                onUpload={uploadEvidence}
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
                busy={busy}
                onClose={() => {
                  setComposerOpen(false)
                  setComposerSuggestion(null)
                }}
                onCreate={async (payload) => {
                  const { attachments, ...taskPayload } = payload
                  const isExternalRecipient = !payload.assigneeRef.startsWith('profile:')
                  const deferAssignment = attachments.length > 0
                  const created = await runAction(
                    payload.parentTaskId ? 'create_subtask' : 'create_task',
                    {
                      ...taskPayload,
                      sendAssignment: !deferAssignment,
                    }
                  )
                  const createdTaskId = created.createdTaskId
                  if (!createdTaskId) throw new Error('Uppgiften skapades men kunde inte öppnas för bilagor.')
                  setComposerOpen(false)
                  setComposerParentId(null)
                  setComposerSuggestion(null)

                  const uploadResult = await uploadInitialAttachments(createdTaskId, attachments)
                  if (uploadResult.failed.length > 0) {
                    let recipientNotice = ''
                    if (deferAssignment && !isExternalRecipient) {
                      try {
                        const dispatched = await runAction('dispatch_assignment', { taskId: createdTaskId })
                        recipientNotice = ` ${dispatched.notice ?? 'Signe meddelar mottagaren.'}`
                      } catch {
                        recipientNotice = ' Mottagaren kunde inte meddelas automatiskt.'
                      }
                    }
                    setNotice(`Uppgiften skapades och finns kvar i översikten.${recipientNotice}`)
                    setError(
                      `Uppgiften skapades, men ${uploadResult.failed.length} ${
                        uploadResult.failed.length === 1 ? 'fil kunde' : 'filer kunde'
                      } inte laddas upp: ${uploadResult.failed.join(', ')}. Lägg till dem från uppdraget.${
                        deferAssignment && isExternalRecipient ? ' Mottagaren har därför inte meddelats ännu.' : ''
                      }`
                    )
                    setSelectedTaskId(createdTaskId)
                    return
                  }

                  let dispatchResult = created
                  if (deferAssignment) {
                    try {
                      dispatchResult = isExternalRecipient
                        ? await runAction('issue_access_link', {
                            taskId: createdTaskId,
                            sendEmail: true,
                          })
                        : await runAction('dispatch_assignment', { taskId: createdTaskId })
                    } catch {
                      setSelectedTaskId(createdTaskId)
                      return
                    }
                  }

                  if (uploadResult.uploaded > 0) {
                    setNotice(
                      `${dispatchResult.warning ?? dispatchResult.notice ?? 'Uppgiften skapades.'} ${
                        uploadResult.uploaded
                      } ${uploadResult.uploaded === 1 ? 'bilaga sparades' : 'bilagor sparades'}.`
                    )
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
