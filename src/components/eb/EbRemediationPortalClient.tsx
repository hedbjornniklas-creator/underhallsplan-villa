'use client'

/* eslint-disable @next/next/no-img-element */

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent, type ReactNode } from 'react'
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Camera,
  Clock3,
  ImagePlus,
  Info,
  Loader2,
  Mail,
  MessageSquareText,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  ShieldCheck,
  Trash2,
  UserRoundCog,
  UsersRound,
  X,
  type LucideIcon,
} from 'lucide-react'
import type {
  EbRemediationAccessRole,
  EbRemediationAssignee,
  EbRemediationContractorSuggestion,
  EbRemediationStatus,
  EbRemediationTask,
  EbRemediationWorkspace,
} from '@/lib/eb/remediation'
import { ebRemediationAllowedStatuses, ebRemediationCanComment, ebRemediationCanManage } from '@/lib/eb/remediationPolicy'

type Props = {
  initialWorkspace: EbRemediationWorkspace
  endpoint: string
  inspectionId?: string | null
  internal?: boolean
  backHref?: string | null
}

function backNavigationClassName(busy: boolean) {
  const base =
    'mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 print:hidden'
  return busy ? `${base} pointer-events-none cursor-wait opacity-70` : base
}

type ApiResponse = {
  workspace?: EbRemediationWorkspace | null
  error?: string
}

type AssigneeDraft = {
  name: string
  companyName: string
  contactName: string
  email: string
  phone: string
  isActive: boolean
}

function newAssigneeDraft(suggestion?: EbRemediationContractorSuggestion): AssigneeDraft {
  return {
    name: suggestion?.name ?? '', companyName: suggestion?.companyName ?? '',
    contactName: suggestion?.contactName ?? '', email: suggestion?.email ?? '',
    phone: suggestion?.phone ?? '', isActive: true,
  }
}

const STATUS_OPTIONS: Array<{ value: EbRemediationStatus; label: string }> = [
  { value: 'unassigned', label: 'Ej tilldelad' },
  { value: 'assigned', label: 'Tilldelad' },
  { value: 'in_progress', label: 'Pågår' },
  { value: 'ready_for_review', label: 'Klar för entreprenörens kontroll' },
  { value: 'returned', label: 'Återlämnad' },
  { value: 'reported_remedied', label: 'Anmäld avhjälpt' },
  { value: 'cannot_remedy', label: 'Kan inte avhjälpas' },
]

function statusLabel(status: EbRemediationStatus, paid = false) {
  if (paid && status === 'returned') return 'Komplettering begärd'
  return STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status
}

function statusClassName(status: EbRemediationStatus) {
  if (status === 'reported_remedied') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (status === 'ready_for_review') return 'border-sky-200 bg-sky-50 text-sky-800'
  if (status === 'returned' || status === 'cannot_remedy') return 'border-rose-200 bg-rose-50 text-rose-800'
  if (status === 'in_progress') return 'border-amber-200 bg-amber-50 text-amber-800'
  return 'border-gray-200 bg-gray-50 text-gray-700'
}

function formatDate(value: string | null) {
  if (!value) return 'Ej satt'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('sv-SE')
}

function formatDateTime(value: string | null) {
  if (!value) return 'Aldrig'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })
}

function taskReference(task: EbRemediationTask) {
  const inspection = `${task.snapshot.inspectionVariant}${task.snapshot.inspectionSequenceNo}`
  const note = task.snapshot.noteNumber ? `Punkt ${task.snapshot.noteNumber}` : 'Onumrerad punkt'
  return `${inspection} · ${note}`
}

function locationLabel(task: EbRemediationTask) {
  return [task.snapshot.location, task.snapshot.room, task.snapshot.placeDetail].filter(Boolean).join(' · ')
}

function assigneeDraft(assignee: EbRemediationAssignee): AssigneeDraft {
  return {
    name: assignee.name,
    companyName: assignee.companyName ?? '',
    contactName: assignee.contactName ?? '',
    email: assignee.email ?? '',
    phone: assignee.phone ?? '',
    isActive: assignee.isActive,
  }
}

export function mergeEbRemediationDrafts(
  drafts: Record<string, AssigneeDraft>, previous: EbRemediationAssignee[], next: EbRemediationAssignee[]
) {
  return Object.fromEntries(next.map((assignee) => {
    const before = previous.find((item) => item.id === assignee.id)
    const draft = drafts[assignee.id]
    const edited = draft && before && JSON.stringify(draft) !== JSON.stringify(assigneeDraft(before))
    return [assignee.id, edited ? draft : assigneeDraft(assignee)]
  }))
}

function inputClassName() {
  return 'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 disabled:bg-gray-100 disabled:text-gray-500'
}

function PortalHelp({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div role="note" className={`flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600 print:hidden ${className}`}>
    <Info size={15} className="mt-0.5 shrink-0 text-slate-500" aria-hidden />
    <p>{children}</p>
  </div>
}

export default function EbRemediationPortalClient({
  initialWorkspace,
  endpoint,
  inspectionId = null,
  internal = false,
  backHref = null,
}: Props) {
  const scopedEndpoint = inspectionId
    ? `${endpoint}?inspectionId=${encodeURIComponent(inspectionId)}`
    : endpoint
  const scopedImagesEndpoint = inspectionId
    ? `${endpoint}/images?inspectionId=${encodeURIComponent(inspectionId)}`
    : `${endpoint}/images`
  const [workspace, setWorkspace] = useState(initialWorkspace)
  const workspaceRef = useRef(initialWorkspace)
  const changeGenerationRef = useRef(0)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const busyKeyRef = useRef<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const noticeTimerRef = useRef<number | null>(null)
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([])
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterAssignee, setFilterAssignee] = useState('all')
  const [bulkAssigneeId, setBulkAssigneeId] = useState<string | null>(null)
  const [bulkDueDate, setBulkDueDate] = useState(initialWorkspace.inspection?.defaultRemedyDeadline ?? '')
  const [changeBulkDueDate, setChangeBulkDueDate] = useState(false)
  const [expandedComments, setExpandedComments] = useState<string[]>([])
  const [selectedSuggestion, setSelectedSuggestion] = useState('')
  const [backNavigationPending, setBackNavigationPending] = useState(false)
  const [newAssignee, setNewAssignee] = useState<AssigneeDraft>(() => newAssigneeDraft(
    initialWorkspace.access.role === 'customer_owner' && initialWorkspace.assignees.length === 0 && initialWorkspace.contractorSuggestions?.length === 1
      ? initialWorkspace.contractorSuggestions[0] : undefined
  ))
  const [assigneeDrafts, setAssigneeDrafts] = useState<Record<string, AssigneeDraft>>(() =>
    Object.fromEntries(initialWorkspace.assignees.map((assignee) => [assignee.id, assigneeDraft(assignee)]))
  )
  const [inviteName, setInviteName] = useState('')
  const [inviteEmail, setInviteEmail] = useState(initialWorkspace.project.contractorEmail ?? '')
  const [inviteRole, setInviteRole] = useState<EbRemediationAccessRole>('contractor_admin')
  const [comments, setComments] = useState<Record<string, string>>({})
  const [uploading, setUploading] = useState<Record<string, number>>({})
  const uploadingTaskIdsRef = useRef(new Set<string>())
  const [reviewWithdrawal, setReviewWithdrawal] = useState(false)
  const withdrawalReviewRef = useRef<HTMLParagraphElement>(null)

  const role = workspace.access.role
  const paid = Boolean(workspace.followUp)
  const isCustomerOwner = paid && role === 'customer_owner'
  const contractorSuggestions = isCustomerOwner ? workspace.contractorSuggestions ?? [] : []
  const defaultRemedyDeadline = workspace.inspection?.defaultRemedyDeadline ?? null
  const activeAssignees = workspace.assignees.filter((assignee) => assignee.isActive)
  const soleAssignee = activeAssignees.length === 1 ? activeAssignees[0] : null
  const effectiveBulkAssigneeId = bulkAssigneeId ?? soleAssignee?.id ?? ''
  const unassignedTaskIds = workspace.tasks.filter((task) => !task.assigneeId).map((task) => task.id)
  const withdrawalPending = Boolean(workspace.followUp?.withdrawalRequestedAt)
  const canManage = !withdrawalPending && ebRemediationCanManage(internal ? 'internal' : role, paid)
  const canRespond = role === 'assignee' || role === 'contractor_admin'
  const isReadOnly = withdrawalPending || !ebRemediationCanComment(role)
  const isBusy = Boolean(busyKey) || Object.keys(uploading).length > 0
  const consumerOrder = workspace.followUp?.customerType === 'consumer'
  const businessOrder = workspace.followUp?.customerType === 'business'
  const withdrawalLabel = consumerOrder ? 'Ångra beställningen' : businessOrder ? 'Begär avbeställning' : 'Frånträd beställningen'
  const withdrawalBuyerName = workspace.followUp?.buyerName || workspace.access.displayName || 'Beställaren'
  const withdrawalReceiptEmail = workspace.followUp?.receiptEmail || workspace.access.email

  const handleBackNavigation = (event: MouseEvent<HTMLAnchorElement>) => {
    if (backNavigationPending) {
      event.preventDefault()
      return
    }
    setBackNavigationPending(true)
  }

  const showNotice = (message: string) => {
    setNotice(message)
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 4000)
  }

  const applyWorkspace = useCallback((next: EbRemediationWorkspace) => {
    const previous = workspaceRef.current
    workspaceRef.current = next
    setWorkspace(next)
    setAssigneeDrafts((drafts) => mergeEbRemediationDrafts(drafts, previous.assignees, next.assignees))
    setSelectedTaskIds((ids) => ids.filter((id) => next.tasks.some((task) => task.id === id)))
  }, [])

  useEffect(() => {
    let disposed = false
    let polling = false
    const timer = window.setInterval(async () => {
      if (disposed || polling || document.visibilityState !== 'visible' || busyKeyRef.current ||
          uploadingTaskIdsRef.current.size || workspaceRef.current.state !== 'open') return
      polling = true
      const generation = changeGenerationRef.current
      try {
        const response = await fetch(scopedEndpoint, { cache: 'no-store' })
        const data = await response.json() as ApiResponse
        if (!disposed && response.ok && data.workspace && generation === changeGenerationRef.current) applyWorkspace(data.workspace)
      } catch { /* A temporary refresh failure must not discard the user's work. */ }
      finally { polling = false }
    }, 30000)
    return () => { disposed = true; window.clearInterval(timer) }
  }, [scopedEndpoint, applyWorkspace])

  useEffect(() => () => { if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current) }, [])
  useEffect(() => {
    if (reviewWithdrawal && !withdrawalPending) withdrawalReviewRef.current?.focus()
  }, [reviewWithdrawal, withdrawalPending])

  const callAction = async (action: string, payload: Record<string, unknown>, key = action) => {
    if (busyKeyRef.current || uploadingTaskIdsRef.current.size > 0) return false
    busyKeyRef.current = key
    changeGenerationRef.current += 1
    setBusyKey(key)
    try {
      const response = await fetch(scopedEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, payload }),
      })
      const data = (await response.json().catch(() => ({}))) as ApiResponse
      if (!response.ok) {
        if (response.status === 409) {
          const refreshed = await fetch(scopedEndpoint, { cache: 'no-store' })
          const current = await refreshed.json().catch(() => ({})) as ApiResponse
          if (refreshed.ok && current.workspace) applyWorkspace(current.workspace)
        }
        throw new Error(data.error ?? 'Åtgärden misslyckades.')
      }
      if (data.workspace) {
        applyWorkspace(data.workspace)
      }
      return true
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Åtgärden misslyckades.')
      return false
    } finally {
      if (busyKeyRef.current === key) {
        busyKeyRef.current = null
        setBusyKey(null)
      }
    }
  }

  const reload = async (allowDuringUpload = false) => {
    if (busyKeyRef.current || (!allowDuringUpload && uploadingTaskIdsRef.current.size > 0)) return
    busyKeyRef.current = 'reload'
    changeGenerationRef.current += 1
    setBusyKey('reload')
    try {
      const response = await fetch(scopedEndpoint, { cache: 'no-store' })
      const data = (await response.json().catch(() => ({}))) as ApiResponse
      if (!response.ok || !data.workspace) throw new Error(data.error ?? 'Kunde inte uppdatera sidan.')
      applyWorkspace(data.workspace)
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Kunde inte uppdatera sidan.')
    } finally {
      if (busyKeyRef.current === 'reload') {
        busyKeyRef.current = null
        setBusyKey(null)
      }
    }
  }

  const counts = useMemo(() => {
    const total = workspace.tasks.length
    const done = workspace.tasks.filter((task) => task.status === 'reported_remedied').length
    const review = workspace.tasks.filter((task) => task.status === (paid ? 'returned' : 'ready_for_review')).length
    const active = workspace.tasks.filter((task) => task.status === 'in_progress').length
    return { total, done, review, active, remaining: total - done }
  }, [workspace.tasks, paid])

  const filteredTasks = useMemo(
    () =>
      workspace.tasks.filter((task) => {
        if (filterStatus !== 'all' && task.status !== filterStatus) return false
        if (filterAssignee === 'unassigned' && task.assigneeId) return false
        if (filterAssignee !== 'all' && filterAssignee !== 'unassigned' && task.assigneeId !== filterAssignee) {
          return false
        }
        return true
      }),
    [filterAssignee, filterStatus, workspace.tasks]
  )
  const selectedVisibleTaskIds = selectedTaskIds.filter((id) => filteredTasks.some((task) => task.id === id))

  const createAssignee = async () => {
    const ok = await callAction('create_assignee', newAssignee, 'create-assignee')
    if (ok) {
      setNewAssignee(newAssigneeDraft())
      setSelectedSuggestion('')
      setBulkAssigneeId(null)
      showNotice('Mottagaren är tillagd. Tilldela anmärkningar och välj sedan Skicka lista.')
    }
  }

  const saveAssignee = async (assigneeId: string) => {
    const draft = assigneeDrafts[assigneeId]
    if (!draft) return false
    return callAction('update_assignee', { assigneeId, ...draft }, `save-assignee-${assigneeId}`)
  }

  const sendAssigneeLink = async (assigneeId: string) => {
    const saved = await saveAssignee(assigneeId)
    if (!saved) return
    const ok = await callAction('send_assignee_link', { assigneeId }, `send-assignee-${assigneeId}`)
    if (ok) showNotice(paid ? 'Den personliga länken är köad för utskick.' : 'Den personliga länken har skickats.')
  }

  const sendContractorLink = async () => {
    const action = inviteRole === 'contractor_admin' ? 'send_admin_link' : 'send_viewer_link'
    const ok = await callAction(action, { displayName: inviteName, email: inviteEmail }, 'send-contractor')
    if (ok) {
      setInviteName('')
      setInviteEmail('')
      showNotice('Den personliga länken har skickats.')
    }
  }

  const assignTasks = async (taskIds: string[], assigneeId: string, dueDate?: string) => {
    if (taskIds.length === 0) return
    const payload: Record<string, unknown> = {
      taskIds,
      assigneeId: assigneeId || null,
      expectedVersions: Object.fromEntries(workspace.tasks.filter((task) => taskIds.includes(task.id)).map((task) => [task.id, task.updatedAt])),
    }
    if (dueDate !== undefined) payload.dueDate = dueDate || null
    const ok = await callAction(
      'assign',
      payload,
      `assign-${taskIds.join('-')}`
    )
    if (ok) {
      setSelectedTaskIds((current) => current.filter((id) => !taskIds.includes(id)))
      setChangeBulkDueDate(false)
      showNotice(`${taskIds.length} ${taskIds.length === 1 ? 'anmärkning uppdaterad' : 'anmärkningar uppdaterade'}. Ingen lista har skickats. Befintliga datum behålls${dueDate !== undefined ? ' för övriga anmärkningar' : ''}.`)
    }
  }

  const changeStatus = async (taskId: string, status: EbRemediationStatus) => {
    const task = workspace.tasks.find((item) => item.id === taskId)
    const ok = await callAction('status', { taskId, status, message: comments[taskId] ?? '', expectedUpdatedAt: task?.updatedAt }, `status-${taskId}-${status}`)
    if (ok) setComments((current) => ({ ...current, [taskId]: '' }))
  }

  const addComment = async (taskId: string) => {
    const message = comments[taskId] ?? ''
    const ok = await callAction('comment', { taskId, message, expectedUpdatedAt: workspace.tasks.find((task) => task.id === taskId)?.updatedAt }, `comment-${taskId}`)
    if (ok) setComments((current) => ({ ...current, [taskId]: '' }))
  }

  const uploadImages = async (taskId: string, event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    await uploadFiles(taskId, files)
  }

  const uploadFiles = async (taskId: string, selectedFiles: File[]) => {
    const files = selectedFiles.slice(0, 15)
    if (files.length === 0 || busyKeyRef.current || uploadingTaskIdsRef.current.size > 0) return
    uploadingTaskIdsRef.current.add(taskId)
    changeGenerationRef.current += 1
    setUploading((current) => ({ ...current, [taskId]: files.length }))
    try {
      // Sequential uploads cannot conflict with one another's task revision.
      for (const file of files) {
          const body = new FormData()
          body.append('taskId', taskId)
          body.append('file', file)
          const response = await fetch(scopedImagesEndpoint, { method: 'POST', body })
          const data = (await response.json().catch(() => ({}))) as ApiResponse
          if (!response.ok) throw new Error(data.error ?? `Kunde inte ladda upp ${file.name}.`)
          if (data.workspace) applyWorkspace(data.workspace)
      }
      await reload(true)
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Kunde inte ladda upp bilderna.')
      await reload(true)
    } finally {
      uploadingTaskIdsRef.current.delete(taskId)
      setUploading((current) => {
        const next = { ...current }
        delete next[taskId]
        return next
      })
    }
  }

  if (workspace.state !== 'open') {
    return (
      <main className="min-h-screen bg-gray-50 px-4 py-16 text-gray-950">
        <section className="mx-auto max-w-xl border border-gray-200 bg-white p-8 shadow-sm">
          <CircleAlert className="h-8 w-8 text-rose-700" />
          <h1 className="mt-5 text-2xl font-semibold">Länken kan inte användas</h1>
          <p className="mt-3 text-sm leading-6 text-gray-600">
            {workspace.state === 'revoked' ? 'Länken har återkallats.' : 'Länkens giltighetstid har gått ut.'}
            {paid && role === 'customer_owner' ? ' Uppföljningen finns kvar. Beställ en ny säker länk till din e-postadress.' : ' Kontakta den som skickade länken för en ny personlig länk.'}
          </p>
          {paid && role === 'customer_owner' && workspace.state === 'expired' ? (
            <button type="button" disabled={isBusy} onClick={async () => {
              if (await callAction('renew_owner_link', {})) showNotice('Om länken kan förnyas skickas en ny personlig länk till beställarens verifierade e-postadress.')
            }} className="mt-4 rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{isBusy ? 'Beställer länk...' : 'Skicka en ny länk'}</button>
          ) : null}
          {notice ? <p role="status" className="mt-4 text-sm">{notice}</p> : null}
        </section>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gray-50 text-gray-950 print:bg-white">
      {notice ? (
        <div className="fixed right-4 top-4 z-[300] flex w-[min(360px,calc(100vw-2rem))] items-start gap-3 rounded-md bg-black px-3 py-2 text-sm font-medium leading-5 text-white shadow-2xl print:hidden" role="status">
          <p className="min-w-0 flex-1">{notice}</p>
          <button type="button" onClick={() => setNotice(null)} className="mt-0.5 text-white/80 hover:text-white" aria-label="Stäng meddelande">
            <X size={15} />
          </button>
        </div>
      ) : null}

      {isBusy ? (
        <div
          className="fixed bottom-4 right-4 z-[290] inline-flex items-center gap-2 rounded-md bg-gray-950 px-3 py-2 text-sm font-semibold text-white shadow-2xl print:hidden"
          role="status"
          aria-live="polite"
        >
          <Loader2 size={16} className="animate-spin" />
          {Object.keys(uploading).length > 0 ? 'Bilder laddas upp...' : 'Åtgärden genomförs...'}
        </div>
      ) : null}

      <header className="border-b border-gray-200 bg-white print:border-black">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6 lg:flex-row lg:items-start lg:justify-between lg:px-8">
          <div className="flex min-w-0 items-start gap-3">
            {backHref ? (
              <Link
                href={backHref}
                onClick={handleBackNavigation}
                aria-label="Tillbaka"
                aria-busy={backNavigationPending}
                className={backNavigationClassName(backNavigationPending)}
              >
                {backNavigationPending ? <Loader2 size={17} className="animate-spin" /> : <ArrowLeft size={17} />}
              </Link>
            ) : null}
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase text-emerald-700">{paid ? 'Åtgärdsuppföljning' : 'Åtgärdsportal'}</p>
              <h1 className="mt-1 truncate text-2xl font-semibold">{workspace.project.title}</h1>
              <p className="mt-1 text-sm text-gray-600">
                {workspace.project.objectLabel}{workspace.project.address ? ` · ${workspace.project.address}` : ''}
              </p>
              {workspace.inspection ? (
                <p className="mt-1 text-sm font-semibold text-emerald-800">
                  {workspace.inspection.variantLabel} {workspace.inspection.sequenceNo}
                  {workspace.inspection.date ? ` · ${formatDate(workspace.inspection.date)}` : ''}
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800">
              <ShieldCheck size={14} />
              {role === 'customer_owner' ? 'Beställare · uppföljning' : role === 'internal' ? 'Besiktningsman' : role === 'contractor_admin' ? (paid ? 'Entreprenör' : 'Entreprenör · administratör') : role === 'contractor_viewer' ? 'Entreprenör · läsbehörighet' : 'Utförare'}
            </span>
            {paid && role === 'customer_owner' ? (
              <a href="#angra-bestallning" className="inline-flex min-h-11 items-center gap-2 rounded-md border border-emerald-700 bg-white px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50"><RotateCcw size={16} />{withdrawalPending ? 'Beställning och registrerad begäran' : withdrawalLabel}</a>
            ) : null}
            <button type="button" onClick={() => void reload()} disabled={isBusy} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50" title="Hämta senaste uppdateringarna. Sidan uppdateras även automatiskt." aria-label="Uppdatera">
              <RefreshCw size={16} className={busyKey === 'reload' ? 'animate-spin' : ''} />
            </button>
            <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50">
              <Printer size={16} />
              Skriv ut åtgärdslista
            </button>
            <PortalHelp className="w-full lg:max-w-md">Uppdatera hämtar senaste informationen. Skriv ut åtgärdslista skriver ut det urval du visar, inte originalutlåtandet.</PortalHelp>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-5 sm:px-6 lg:px-8 print:max-w-none print:px-0">
        {paid ? (
          <section className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950 print:hidden">
            <h2 className="font-semibold">Digital uppföljning av det levererade utlåtandet</h2>
            <p className="mt-1 leading-6">Punkterna och originalbilderna kommer från den fastställda versionen vid beställningen. Uppföljningen ändrar inte utlåtandet och ersätter inte besiktning. Sidan uppdateras automatiskt utan att dina osparade texter försvinner.</p>
            {role === 'customer_owner' ? <p className="mt-2 text-sm">Kontrollera entreprenören, tilldela anmärkningar och välj Skicka lista. Följ sedan återrapporteringen här. Öppna Kommentera när du vill ställa en fråga, bifoga en bild eller begära komplettering.</p> : null}
          </section>
        ) : null}
        <section className="grid grid-cols-2 gap-3 md:grid-cols-5" aria-label="Sammanställning">
          {([
            ['Totalt', counts.total, UsersRound],
            ['Kvar', counts.remaining, Clock3],
            ['Pågår', counts.active, RefreshCw],
            [paid ? 'Komplettering' : 'För kontroll', counts.review, CircleAlert],
            ['Anmälda avhjälpta', counts.done, CheckCircle2],
          ] as Array<[string, number, LucideIcon]>).map(([label, value, Icon]) => (
            <div key={String(label)} className="border border-gray-200 bg-white px-4 py-3 shadow-sm print:border-gray-500 print:shadow-none">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold text-gray-500">{String(label)}</p>
                <Icon size={15} className="text-emerald-700" />
              </div>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{Number(value)}</p>
            </div>
          ))}
        </section>

        {internal && !paid ? (
          <section className="border border-gray-200 bg-white shadow-sm print:hidden">
            <div className="border-b border-gray-200 px-4 py-3">
              <h2 className="flex items-center gap-2 text-base font-semibold"><UserRoundCog size={18} className="text-emerald-700" /> Entreprenörens åtkomst</h2>
              <p className="mt-1 text-xs text-gray-600">Skicka en personlig länk. Administratören kan fördela om punkter och hantera UE; läsbehörighet kan bara följa läget.</p>
            </div>
            <div className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_15rem_auto] md:items-end">
              <label className="block"><span className="text-xs font-semibold text-gray-700">Namn</span><input value={inviteName} onChange={(event) => setInviteName(event.target.value)} className={`${inputClassName()} mt-1`} /></label>
              <label className="block"><span className="text-xs font-semibold text-gray-700">E-post</span><input type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} className={`${inputClassName()} mt-1`} /></label>
              <label className="block"><span className="text-xs font-semibold text-gray-700">Behörighet</span><select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as EbRemediationAccessRole)} className={`${inputClassName()} mt-1`}><option value="contractor_admin">Administratör</option><option value="contractor_viewer">Läsbehörighet</option></select></label>
              <button type="button" onClick={() => void sendContractorLink()} disabled={isBusy} className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60">
                {busyKey === 'send-contractor' ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Skicka länk
              </button>
            </div>
          </section>
        ) : null}

        {canManage ? (
          <section className="border border-gray-200 bg-white shadow-sm print:hidden">
            <div className="border-b border-gray-200 px-4 py-3">
              <h2 className="text-base font-semibold">Åtgärdas av</h2>
              <PortalHelp className="mt-2">{isCustomerOwner ? 'Kontrollera entreprenörens namn och e-postadress. Lägg till entreprenören och tilldela anmärkningarna. Först när du väljer Skicka lista får mottagaren ett mejl med sina punkter.' : 'Skapa en grupp en gång och återanvänd den. E-postadressen får en egen lista med endast gruppens punkter.'}</PortalHelp>
            </div>
            {contractorSuggestions.length > 0 ? <div className="border-b border-gray-200 bg-emerald-50/50 px-4 py-3 text-sm">
              <p className="text-xs leading-5 text-gray-600">Förslag från entreprenaduppgifterna. Kontrollera företag och mottagare; inget skickas automatiskt.</p>
              {contractorSuggestions.length > 1 || workspace.assignees.length > 0 ? <label className="mt-2 block max-w-xl"><span className="text-xs font-semibold text-gray-700">Hämta entreprenörsuppgifter</span><select aria-label="Hämta entreprenörsuppgifter" value={selectedSuggestion} onChange={(event) => {
                setSelectedSuggestion(event.target.value)
                const suggestion = contractorSuggestions[Number(event.target.value)]
                if (event.target.value !== '' && suggestion) setNewAssignee(newAssigneeDraft(suggestion))
              }} disabled={isBusy} className={`${inputClassName()} mt-1`}><option value="">Välj entreprenör eller fyll i nedan</option>{contractorSuggestions.map((suggestion, index) => <option key={index} value={index}>{suggestion.name}{suggestion.contactName ? ` · ${suggestion.contactName}` : ''}{suggestion.email ? ` · ${suggestion.email}` : ''}</option>)}</select></label> : <p className="mt-1 text-xs text-emerald-800">Entreprenörens uppgifter är förifyllda nedan. Komplettera det som saknas.</p>}
            </div> : null}
            <div className="grid gap-3 border-b border-gray-200 bg-gray-50 p-4 md:grid-cols-2 lg:grid-cols-6 lg:items-end">
              <label><span className="text-xs font-semibold text-gray-700">{isCustomerOwner ? 'Entreprenör / arbetsområde' : 'Åtgärdas av'}</span><input value={newAssignee.name} onChange={(event) => setNewAssignee((current) => ({ ...current, name: event.target.value }))} placeholder={isCustomerOwner ? 'Entreprenörens namn' : 'Exempel: Målare'} className={`${inputClassName()} mt-1`} /></label>
              <label><span className="text-xs font-semibold text-gray-700">Företag</span><input value={newAssignee.companyName} onChange={(event) => setNewAssignee((current) => ({ ...current, companyName: event.target.value }))} className={`${inputClassName()} mt-1`} /></label>
              <label><span className="text-xs font-semibold text-gray-700">Kontaktperson</span><input value={newAssignee.contactName} onChange={(event) => setNewAssignee((current) => ({ ...current, contactName: event.target.value }))} className={`${inputClassName()} mt-1`} /></label>
              <label><span className="text-xs font-semibold text-gray-700">E-post</span><input type="email" value={newAssignee.email} onChange={(event) => setNewAssignee((current) => ({ ...current, email: event.target.value }))} className={`${inputClassName()} mt-1`} /></label>
              <label><span className="text-xs font-semibold text-gray-700">Telefon</span><input type="tel" value={newAssignee.phone} onChange={(event) => setNewAssignee((current) => ({ ...current, phone: event.target.value }))} className={`${inputClassName()} mt-1`} /></label>
              <button type="button" onClick={() => void createAssignee()} disabled={isBusy} className="inline-flex items-center justify-center gap-2 rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-60">
                {busyKey === 'create-assignee' ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} {isCustomerOwner ? 'Lägg till entreprenör' : 'Lägg till'}
              </button>
            </div>
            {workspace.assignees.length > 0 ? (
              <div className="divide-y divide-gray-200">
                {workspace.assignees.map((assignee) => {
                  const draft = assigneeDrafts[assignee.id] ?? assigneeDraft(assignee)
                  return (
                    <div key={assignee.id} className="grid gap-2 px-4 py-3 lg:grid-cols-[1fr_1fr_1fr_1fr_0.8fr_auto] lg:items-center">
                      <input value={draft.name} onChange={(event) => setAssigneeDrafts((current) => ({ ...current, [assignee.id]: { ...draft, name: event.target.value } }))} aria-label="Åtgärdas av" className={inputClassName()} />
                      <input value={draft.companyName} onChange={(event) => setAssigneeDrafts((current) => ({ ...current, [assignee.id]: { ...draft, companyName: event.target.value } }))} aria-label="Företag" placeholder="Företag" className={inputClassName()} />
                      <input value={draft.contactName} onChange={(event) => setAssigneeDrafts((current) => ({ ...current, [assignee.id]: { ...draft, contactName: event.target.value } }))} aria-label="Kontaktperson" placeholder="Kontaktperson" className={inputClassName()} />
                      <input type="email" value={draft.email} onChange={(event) => setAssigneeDrafts((current) => ({ ...current, [assignee.id]: { ...draft, email: event.target.value } }))} aria-label="E-post" placeholder="E-post" className={inputClassName()} />
                      <input type="tel" value={draft.phone} onChange={(event) => setAssigneeDrafts((current) => ({ ...current, [assignee.id]: { ...draft, phone: event.target.value } }))} aria-label="Telefon" placeholder="Telefon" className={inputClassName()} />
                      <div className="flex items-center justify-end gap-2">
                        <button type="button" onClick={() => void saveAssignee(assignee.id)} disabled={isBusy} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50" title="Spara" aria-label="Spara mottagare">{busyKey === `save-assignee-${assignee.id}` ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}</button>
                        <button type="button" onClick={() => void sendAssigneeLink(assignee.id)} disabled={!draft.email || isBusy || (paid && !workspace.tasks.some((task) => task.assigneeId === assignee.id))} title={paid && !workspace.tasks.some((task) => task.assigneeId === assignee.id) ? 'Tilldela minst en punkt innan du skickar listan.' : 'Skicka en personlig länk till tilldelade punkter.'} className="inline-flex items-center gap-2 rounded-md border border-emerald-300 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40">{busyKey === `send-assignee-${assignee.id}` || busyKey === `save-assignee-${assignee.id}` ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />} Skicka lista</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : null}
            {isCustomerOwner && soleAssignee && unassignedTaskIds.length > 0 ? <div className="flex flex-col gap-3 border-t border-emerald-200 bg-emerald-50/50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm leading-6 text-gray-700">Tilldela samtliga <strong>{unassignedTaskIds.length} ej tilldelade</strong> anmärkningar till <strong>{soleAssignee.name}</strong>. Befintliga tilldelningar och datum behålls.</p>
              <button type="button" onClick={() => void assignTasks(unassignedTaskIds, soleAssignee.id)} disabled={isBusy} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busyKey?.startsWith('assign-') ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}Tilldela alla ej tilldelade</button>
            </div> : null}
          </section>
        ) : null}

        {canManage && workspace.accessLinks.length > 0 ? (
          <details className="border border-gray-200 bg-white print:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold">Personliga länkar <ChevronDown size={16} /></summary>
            <div className="overflow-x-auto border-t border-gray-200">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-gray-50 text-xs text-gray-600"><tr><th className="px-4 py-2">Mottagare</th><th className="px-4 py-2">Behörighet</th><th className="px-4 py-2">Senast använd</th><th className="px-4 py-2">Giltig till</th><th className="px-4 py-2 text-right">Åtgärd</th></tr></thead>
                <tbody className="divide-y divide-gray-200">
                  {workspace.accessLinks.map((link) => (
                    <tr key={link.id}><td className="px-4 py-2"><p className="font-medium">{link.displayName ?? link.email}</p><p className="text-xs text-gray-500">{link.email}</p></td><td className="px-4 py-2">{link.role === 'contractor_admin' ? 'Administratör' : link.role === 'contractor_viewer' ? 'Läsbehörighet' : 'Utförare'}</td><td className="px-4 py-2 text-gray-600">{formatDateTime(link.lastUsedAt)}</td><td className="px-4 py-2 text-gray-600">{formatDate(link.expiresAt)}</td><td className="px-4 py-2 text-right">{link.revokedAt ? <span className="text-xs text-gray-500">Återkallad</span> : <button type="button" onClick={() => void callAction('revoke_link', { linkId: link.id }, `revoke-${link.id}`)} disabled={isBusy} className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-700 hover:underline disabled:cursor-not-allowed disabled:opacity-50">{busyKey === `revoke-${link.id}` ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} {busyKey === `revoke-${link.id}` ? 'Återkallar...' : 'Återkalla'}</button>}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ) : null}

        <section className="border border-gray-200 bg-white shadow-sm print:border-0 print:shadow-none">
          <div className="flex flex-col gap-3 border-b border-gray-200 px-4 py-3 md:flex-row md:items-end md:justify-between print:hidden">
            <div><h2 className="text-base font-semibold">Anmärkningar</h2><p className="mt-1 text-xs text-gray-600">“Anmäld avhjälpt” är entreprenörens uppgift och innebär inte att punkten är godkänd vid besiktning.</p></div>
            <div className="flex flex-wrap gap-2">
              <label><span className="sr-only">Filtrera status</span><select aria-label="Filtrera status" value={filterStatus} onChange={(event) => { setFilterStatus(event.target.value); setSelectedTaskIds([]) }} className={inputClassName()}><option value="all">Alla statusar</option>{STATUS_OPTIONS.filter((option) => !paid || option.value !== 'ready_for_review').map((option) => <option key={option.value} value={option.value}>{statusLabel(option.value, paid)}</option>)}</select></label>
              {role !== 'assignee' ? <label><span className="sr-only">Filtrera mottagare</span><select aria-label="Filtrera mottagare" value={filterAssignee} onChange={(event) => { setFilterAssignee(event.target.value); setSelectedTaskIds([]) }} className={inputClassName()}><option value="all">Alla utförare</option><option value="unassigned">Ej tilldelade</option>{workspace.assignees.map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.name}</option>)}</select></label> : null}
            </div>
          </div>

          <div id="remediation-print-summary" className="hidden border-b border-gray-300 px-4 py-3 text-sm print:block">
            <h2 className="font-semibold">Åtgärdslista</h2>
            <p>Urval: {filteredTasks.length} av {workspace.tasks.length} anmärkningar. Status: {filterStatus === 'all' ? 'Alla' : statusLabel(filterStatus as EbRemediationStatus, paid)}. Åtgärdas av: {filterAssignee === 'all' ? 'Alla' : filterAssignee === 'unassigned' ? 'Ej tilldelade' : workspace.assignees.find((assignee) => assignee.id === filterAssignee)?.name ?? 'Vald mottagare'}.</p>
            <p>Detta är en uppföljningslista, inte ett nytt besiktningsutlåtande.</p>
          </div>

          {canManage ? <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-4 py-3 print:hidden">
            <button type="button" disabled={isBusy || filteredTasks.length === 0} onClick={() => setSelectedTaskIds(filteredTasks.map((task) => task.id))} className="min-h-10 rounded-md border border-gray-300 px-3 py-2 text-xs font-semibold hover:bg-gray-50 disabled:opacity-50">Markera alla i urvalet</button>
            <button type="button" disabled={isBusy || !filteredTasks.some((task) => !task.assigneeId)} onClick={() => setSelectedTaskIds(filteredTasks.filter((task) => !task.assigneeId).map((task) => task.id))} className="min-h-10 rounded-md border border-gray-300 px-3 py-2 text-xs font-semibold hover:bg-gray-50 disabled:opacity-50">Markera ej tilldelade</button>
            <button type="button" disabled={isBusy || selectedTaskIds.length === 0} onClick={() => setSelectedTaskIds([])} className="min-h-10 rounded-md px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">Avmarkera</button>
            <span className="text-xs text-gray-600">{selectedVisibleTaskIds.length} av {filteredTasks.length} i urvalet valda</span>
            <PortalHelp className="w-full">Markera de anmärkningar du vill hantera tillsammans. Tilldela ändrar ansvarig men skickar ingen lista. Filterbyte rensar markeringarna.</PortalHelp>
          </div> : null}

          {canManage && selectedVisibleTaskIds.length > 0 ? (
            <div className="sticky top-0 z-20 space-y-3 border-b border-emerald-200 bg-emerald-50 px-4 py-3 print:hidden">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
                <label className="min-w-0 lg:w-64"><span className="text-xs font-semibold text-emerald-900">Åtgärdas av</span><select aria-label="Tilldela till" value={effectiveBulkAssigneeId} onChange={(event) => setBulkAssigneeId(event.target.value)} disabled={isBusy} className={`${inputClassName()} mt-1`}><option value="">Ej tilldelad</option>{activeAssignees.map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.name}</option>)}</select></label>
                <div className="min-w-0"><label className="flex min-h-10 items-center gap-2 text-xs font-semibold text-emerald-900"><input type="checkbox" checked={changeBulkDueDate} onChange={(event) => setChangeBulkDueDate(event.target.checked)} disabled={isBusy} className="h-4 w-4" />Ändra sista åtgärdsdatum</label><input aria-label="Sista åtgärdsdatum" type="date" value={bulkDueDate} onChange={(event) => setBulkDueDate(event.target.value)} disabled={!changeBulkDueDate || isBusy} className={inputClassName()} /></div>
                <button type="button" onClick={() => void assignTasks(selectedVisibleTaskIds, effectiveBulkAssigneeId, changeBulkDueDate ? bulkDueDate : undefined)} disabled={isBusy || (changeBulkDueDate && !bulkDueDate)} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60">{busyKey?.startsWith('assign-') ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} {busyKey?.startsWith('assign-') ? 'Tilldelar...' : 'Tilldela'}</button>
              </div>
              <PortalHelp>{changeBulkDueDate ? bulkDueDate ? `Det valda datumet ersätter datumet för de ${selectedVisibleTaskIds.length} valda anmärkningarna.` : 'Välj ett datum eller avmarkera datumändringen för att behålla befintliga datum.' : 'Befintliga datum behålls. Datumet ändras bara om du markerar Ändra sista åtgärdsdatum.'}</PortalHelp>
            </div>
          ) : null}

          {paid ? <PortalHelp className="mx-4 my-3 print:hidden">{defaultRemedyDeadline ? `Frist enligt utlåtandet: ${formatDate(defaultRemedyDeadline)}. Den gäller som utgångspunkt när anmärkningen saknar ett separat datum.` : isCustomerOwner ? 'Sista åtgärdsdatum saknas i utlåtandet. Kom överens med entreprenören om när åtgärderna ska vara klara och ange datumet här.' : 'Sista åtgärdsdatum saknas i utlåtandet. Datumet behöver tas fram genom en gemensam överenskommelse mellan beställaren och entreprenören.'}</PortalHelp> : null}

          {filteredTasks.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-gray-600">Inga anmärkningar matchar urvalet.</div>
          ) : (
            <div className="divide-y divide-gray-200">
              {filteredTasks.map((task) => {
                const assignee = workspace.assignees.find((item) => item.id === task.assigneeId)
                const events = workspace.events.filter((event) => event.taskId === task.id)
                const images = workspace.images.filter((image) => image.taskId === task.id)
                const checked = selectedTaskIds.includes(task.id)
                const showResponse = !isCustomerOwner || expandedComments.includes(task.id)
                return (
                  <article key={task.id} data-task-id={task.id} className="break-inside-avoid px-4 py-4 print:px-0">
                    <div className="flex items-start gap-3">
                      {canManage ? <input type="checkbox" checked={checked} disabled={isBusy} onChange={(event) => setSelectedTaskIds((current) => event.target.checked ? [...current, task.id] : current.filter((id) => id !== task.id))} className="mt-1 h-4 w-4 rounded border-gray-300 text-emerald-700 print:hidden" aria-label={`Välj ${taskReference(task)}`} /> : null}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold uppercase text-emerald-700">{taskReference(task)}</span><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClassName(task.status)}`}>{statusLabel(task.status, paid)}</span></div>
                            <p className="mt-2 whitespace-pre-wrap text-sm font-medium leading-6 text-gray-950">{task.snapshot.noteText}</p>
                            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
                              {task.snapshot.disciplineLabel ? <span>Del: {task.snapshot.disciplineLabel}</span> : null}
                              {locationLabel(task) ? <span>Plats: {locationLabel(task)}</span> : null}
                              <span>Besiktning: {formatDate(task.snapshot.inspectionDate)}</span>
                              <span>Klar senast: {formatDate(task.dueDate ?? defaultRemedyDeadline)}{!task.dueDate && defaultRemedyDeadline ? ' (enligt utlåtandet)' : ''}</span>
                            </div>
                          </div>
                          <div className="flex shrink-0 flex-col gap-2 lg:w-64 print:w-auto">
                            <p className="text-xs font-semibold text-gray-500">Åtgärdas av</p>
                            {canManage ? (
                              <>
                                <div className="space-y-1 print:hidden"><select value={task.assigneeId ?? ''} onChange={(event) => void assignTasks([task.id], event.target.value)} disabled={isBusy} aria-busy={busyKey === `assign-${task.id}`} className={inputClassName()}><option value="">Ej tilldelad</option>{workspace.assignees.filter((item) => item.isActive || item.id === task.assigneeId).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{busyKey === `assign-${task.id}` ? <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800"><Loader2 size={12} className="animate-spin" /> Tilldelar...</span> : null}</div>
                                <p className="hidden text-sm font-semibold print:block">{assignee?.name ?? 'Ej tilldelad'}</p>
                              </>
                            ) : <p className="text-sm font-semibold">{assignee?.name ?? 'Ej tilldelad'}</p>}
                          </div>
                        </div>

                        {isCustomerOwner && !isReadOnly ? <button type="button" onClick={() => setExpandedComments((current) => current.includes(task.id) ? current.filter((id) => id !== task.id) : [...current, task.id])} aria-expanded={showResponse} aria-controls={`comment-panel-${task.id}`} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 print:hidden"><MessageSquareText size={15} />{showResponse ? 'Stäng kommentarsfält' : 'Kommentera'}</button> : null}
                        {paid && !isReadOnly && showResponse ? (
                          <div id={`comment-panel-${task.id}`} className="mt-4 space-y-2 print:hidden">
                            <label className="block text-xs font-semibold text-gray-700" htmlFor={`comment-${task.id}`}>{isCustomerOwner ? 'Kommentar till entreprenören' : 'Kommentar eller beskrivning av utförd åtgärd'}</label>
                            <textarea id={`comment-${task.id}`} rows={3} value={comments[task.id] ?? ''} onChange={(event) => setComments((current) => ({ ...current, [task.id]: event.target.value }))} disabled={isBusy} className={inputClassName()} placeholder={role === 'customer_owner' ? 'Beskriv din fråga eller vad som behöver kompletteras.' : 'Beskriv utförd åtgärd. Om arbetet inte kan fotograferas: förklara varför och hur det har åtgärdats.'} />
                            <PortalHelp>{isCustomerOwner ? 'Ställ en fråga, bifoga en bild eller förklara vad som behöver kompletteras. En begäran om komplettering är inte ett besiktningsbeslut.' : 'Anmäl åtgärdat med en åtgärdsbild eller en förklarande kommentar när arbetet inte kan fotograferas. Ange skäl om punkten inte kan avhjälpas.'}</PortalHelp>
                            <div className="flex flex-wrap gap-2">
                              {ebRemediationAllowedStatuses(role, true).filter((status) => status !== task.status && (!isCustomerOwner || task.status === 'reported_remedied' || task.status === 'cannot_remedy')).map((status) => (
                                <button key={status} type="button" onClick={() => void changeStatus(task.id, status as EbRemediationStatus)} disabled={isBusy} className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-xs font-semibold disabled:opacity-50 ${status === 'reported_remedied' ? 'bg-emerald-700 text-white' : 'border border-gray-300 bg-white text-gray-800'}`}>
                                  {busyKey === `status-${task.id}-${status}` ? <Loader2 size={14} className="animate-spin" /> : null}
                                  {status === 'returned' ? 'Begär komplettering' : status === 'in_progress' ? 'Påbörja' : status === 'reported_remedied' ? 'Anmäl åtgärdat' : 'Kan inte avhjälpas'}
                                </button>
                              ))}
                              <button type="button" disabled={isBusy || !(comments[task.id] ?? '').trim()} onClick={() => void addComment(task.id)} className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-semibold disabled:opacity-50"><Send size={14} /> Skicka kommentar</button>
                            </div>
                          </div>
                        ) : null}

                        {canRespond && !internal && !paid ? (
                          <div className="mt-4 flex flex-wrap gap-2 print:hidden">
                            {task.status !== 'in_progress' && task.status !== 'reported_remedied' ? <button type="button" onClick={() => void changeStatus(task.id, 'in_progress')} disabled={isBusy} className="inline-flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 disabled:cursor-not-allowed disabled:opacity-50">{busyKey === `status-${task.id}-in_progress` ? <Loader2 size={14} className="animate-spin" /> : <Clock3 size={14} />} {busyKey === `status-${task.id}-in_progress` ? 'Startar...' : 'Påbörja'}</button> : null}
                            {role === 'assignee' ? <button type="button" onClick={() => void changeStatus(task.id, 'ready_for_review')} disabled={isBusy} className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{busyKey === `status-${task.id}-ready_for_review` ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} {busyKey === `status-${task.id}-ready_for_review` ? 'Sparar...' : 'Klar för kontroll'}</button> : null}
                            {role === 'assignee' ? <button type="button" onClick={() => void changeStatus(task.id, 'cannot_remedy')} disabled={isBusy} className="inline-flex items-center gap-2 rounded-md border border-rose-300 px-3 py-2 text-xs font-semibold text-rose-800 disabled:cursor-not-allowed disabled:opacity-50">{busyKey === `status-${task.id}-cannot_remedy` ? <Loader2 size={14} className="animate-spin" /> : <CircleAlert size={14} />} {busyKey === `status-${task.id}-cannot_remedy` ? 'Sparar...' : 'Kan inte avhjälpas'}</button> : null}
                            {role === 'contractor_admin' && task.status === 'ready_for_review' ? <button type="button" onClick={() => void changeStatus(task.id, 'reported_remedied')} disabled={isBusy} className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{busyKey === `status-${task.id}-reported_remedied` ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} {busyKey === `status-${task.id}-reported_remedied` ? 'Sparar...' : 'Markera anmäld avhjälpt'}</button> : null}
                            {role === 'contractor_admin' && task.status === 'ready_for_review' ? <button type="button" onClick={() => void changeStatus(task.id, 'returned')} disabled={isBusy} className="inline-flex items-center gap-2 rounded-md border border-rose-300 px-3 py-2 text-xs font-semibold text-rose-800 disabled:cursor-not-allowed disabled:opacity-50">{busyKey === `status-${task.id}-returned` ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />} {busyKey === `status-${task.id}-returned` ? 'Återlämnar...' : 'Återlämna'}</button> : null}
                          </div>
                        ) : null}

                        {paid && (workspace.originalImages ?? []).some((image) => image.taskId === task.id) ? (
                          <div className="mt-4">
                            <h3 className="text-xs font-semibold text-gray-700">Bilder i utlåtandet</h3>
                            <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                              {(workspace.originalImages ?? []).filter((image) => image.taskId === task.id).map((image) => image.imageUrl ? <a key={image.id} href={image.imageUrl} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md border border-gray-200 bg-gray-100"><img src={image.thumbnailUrl ?? image.imageUrl} alt={image.fileName ?? 'Originalbild från utlåtandet'} loading="lazy" className="aspect-square w-full object-cover" /></a> : <p key={image.id} className="text-xs text-gray-500">Originalbilden kunde inte läsas.</p>)}
                            </div>
                          </div>
                        ) : null}

                        {images.length > 0 ? <h3 className="mt-4 text-xs font-semibold text-gray-700">{paid ? 'Bilder i uppföljningen' : 'Åtgärdsbilder'}</h3> : null}
                        {(images.length > 0 || uploading[task.id]) ? (
                          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                            {images.map((image) => <a key={image.id} href={image.imageUrl ?? '#'} target="_blank" rel="noreferrer" className="block overflow-hidden border border-gray-200 bg-gray-100"><img src={image.thumbnailUrl ?? image.imageUrl ?? ''} alt="Åtgärdsbild" loading="lazy" className="aspect-square w-full object-cover" /></a>)}
                            {uploading[task.id] ? <div className="flex aspect-square items-center justify-center border border-dashed border-emerald-300 bg-emerald-50 text-emerald-800"><div className="text-center"><Loader2 className="mx-auto animate-spin" size={20} /><p className="mt-2 text-xs">{uploading[task.id]} laddas upp</p></div></div> : null}
                          </div>
                        ) : null}

                        {!internal && !isReadOnly && showResponse && (canRespond || role === 'customer_owner') ? (
                          <div className="mt-4 rounded-md border border-dashed border-emerald-300 bg-emerald-50/40 p-3 print:hidden"
                            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = isBusy ? 'none' : 'copy' }}
                            onDrop={(event) => { event.preventDefault(); if (!isBusy) void uploadFiles(task.id, Array.from(event.dataTransfer.files)) }}>
                            <p className="mb-2 text-xs font-semibold text-emerald-900">Dra bilder hit eller välj från din enhet</p>
                            <label className={`inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-800 ${isBusy || Boolean(uploading[task.id]) ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-gray-50'}`}>
                              <ImagePlus size={15} /> {isCustomerOwner ? 'Bifoga bild' : 'Lägg till åtgärdsbilder'}
                              <input type="file" accept="image/*" multiple disabled={isBusy || Boolean(uploading[task.id])} className="sr-only" onChange={(event) => void uploadImages(task.id, event)} />
                            </label>
                            <label className={`ml-2 inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-800 ${isBusy ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
                              <Camera size={15} /> Ta foto
                              <input type="file" accept="image/*" capture="environment" disabled={isBusy} className="sr-only" onChange={(event) => void uploadImages(task.id, event)} />
                            </label>
                            <p className="mt-1 text-xs text-gray-500">Max 15 bilder åt gången och 15 MB per bild. Uppladdningen sker i bakgrunden.</p>
                          </div>
                        ) : null}

                        <details className="mt-4 border-t border-gray-200 pt-3 print:open">
                          <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-semibold text-gray-700 print:hidden"><MessageSquareText size={15} /> Kommentarer och historik ({events.length}) <ChevronDown size={14} /></summary>
                          <div className="mt-3 space-y-2">
                            {events.length === 0 ? <p className="text-xs text-gray-500">Ingen historik ännu.</p> : events.map((event) => (
                              <div key={event.id} className="border-l-2 border-gray-200 pl-3 text-xs">
                                <div className="flex flex-wrap gap-x-2 text-gray-500"><span className="font-semibold text-gray-700">{event.actorName ?? event.actorEmail ?? 'System'}</span><span>{formatDateTime(event.createdAt)}</span></div>
                                <p className="mt-1 whitespace-pre-wrap text-gray-700">{event.eventType === 'comment' ? event.message : event.eventType === 'task_created' ? 'Åtgärdsuppgiften skapades.' : event.eventType === 'assigned' ? 'Tilldelningen ändrades.' : event.eventType === 'photo_added' ? 'En åtgärdsbild lades till.' : event.fromStatus && event.toStatus ? `Status ändrades från ${statusLabel(event.fromStatus)} till ${statusLabel(event.toStatus)}.` : 'Uppgiften uppdaterades.'}</p>
                                {event.eventType !== 'comment' && event.message ? <p className="mt-1 whitespace-pre-wrap text-gray-700">{event.message}</p> : null}
                              </div>
                            ))}
                          </div>
                          {!isReadOnly && !paid ? <div className="mt-3 flex gap-2 print:hidden"><input value={comments[task.id] ?? ''} onChange={(event) => setComments((current) => ({ ...current, [task.id]: event.target.value }))} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (!busyKeyRef.current) void addComment(task.id) } }} disabled={isBusy} placeholder="Skriv en kommentar" className={inputClassName()} /><button type="button" onClick={() => void addComment(task.id)} disabled={isBusy} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-gray-900 text-white disabled:cursor-not-allowed disabled:opacity-50" aria-label="Skicka kommentar" title="Skicka kommentar">{busyKey === `comment-${task.id}` ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}</button></div> : null}
                        </details>
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>

        {paid && role === 'customer_owner' ? <section id="angra-bestallning" aria-labelledby="withdrawal-heading" className="scroll-mt-5 rounded-md border border-emerald-300 bg-white p-4 text-sm [overflow-wrap:anywhere] print:hidden">
          <h2 id="withdrawal-heading" className="flex items-center gap-2 text-base font-semibold"><RotateCcw size={18} />{withdrawalPending ? 'Registrerad begäran' : withdrawalLabel}</h2>
          <div id="follow-up-order" className="scroll-mt-5">
          <h3 className="mt-3 font-semibold">Din beställning</h3>
          <p className="mt-1 text-gray-600">Beställd {formatDateTime(workspace.followUp?.acceptedAt ?? null)} · 599 kr inklusive moms.</p>
          <dl className="mt-3 grid gap-x-4 gap-y-1 sm:grid-cols-[max-content_minmax(0,1fr)]">
            <dt className="font-medium">Beställare</dt><dd className="break-words">{withdrawalBuyerName}</dd>
            <dt className="font-medium">Beställningsnummer</dt><dd className="break-all">{workspace.followUp?.id}</dd>
            <dt className="font-medium">Bekräftelse skickas till</dt><dd className="break-all">{withdrawalReceiptEmail || 'Beställarens registrerade e-postadress'}</dd>
          </dl>
          </div>
          {workspace.followUp?.withdrawalRequestedAt ? <div role="status" className="mt-4 border-l-4 border-emerald-600 bg-emerald-50 p-3 text-emerald-950">
            <p className="font-semibold">Din begäran har registrerats {formatDateTime(workspace.followUp.withdrawalRequestedAt)}.</p>
            <p className="mt-2">Mottagningsbekräftelsen ligger i e-postkön till {withdrawalReceiptEmail || 'din registrerade e-postadress'}. Faktureringen och nya åtgärdssvar är pausade för hantering. Befintlig historik finns kvar.</p>
            <p className="mt-2">Detta bekräftar mottagandet av din begäran, inte ett beslut om återbetalning.</p>
          </div> : <>
            {consumerOrder ? <p className="mt-4 leading-6 text-gray-700">Som konsument har du normalt 14 dagars ångerrätt.{workspace.followUp?.withdrawalDeadline ? ` Enligt beställningsbekräftelsen är sista ordinarie ångerdag ${workspace.followUp.withdrawalDeadline} (svensk tid).` : ''} Omedelbar aktivering tar inte i sig bort ångerrätten. Du kan lämna en begäran även efter detta; den bedöms då utifrån omständigheterna.</p>
              : businessOrder ? <p className="mt-4 leading-6 text-gray-700">Beställningen gäller ett företag eller en organisation. Här kan du begära avbeställning. Begäran hanteras enligt avtalets villkor; konsumentens lagstadgade ångerrätt gäller inte.</p>
              : <p className="mt-4 leading-6 text-gray-700">Här kan du meddela att du vill frånträda beställningen. För denna äldre beställning visas ingen beräknad ångerfrist. Begäran bedöms enligt dina villkor och tillämpliga regler.</p>}
            {!reviewWithdrawal ? <button type="button" disabled={isBusy} aria-expanded={false} aria-controls="withdrawal-review" onClick={() => setReviewWithdrawal(true)} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-md border border-emerald-700 px-4 py-2 text-sm font-semibold text-emerald-900 disabled:opacity-50"><RotateCcw size={16} />{withdrawalLabel}</button>
              : <form id="withdrawal-review" aria-label="Bekräfta begäran" onSubmit={async event => {
                event.preventDefault()
                if (await callAction('withdraw_order', { confirmed: true })) setReviewWithdrawal(false)
              }} className="mt-4 border-t border-gray-200 pt-4">
                <p ref={withdrawalReviewRef} tabIndex={-1} className="font-semibold outline-none">Kontrollera uppgifterna ovan och bekräfta din begäran.</p>
                <p className="mt-2 leading-6 text-gray-700">Jag, {withdrawalBuyerName}, meddelar att jag vill frånträda beställning {workspace.followUp?.id} av digital åtgärdsuppföljning. Bekräftelsen skickas till {withdrawalReceiptEmail || 'min registrerade e-postadress'}.</p>
                <p className="mt-2 leading-6 text-gray-700">När du bekräftar registreras tidpunkten och faktureringen samt nya åtgärdssvar pausas för hantering. Underlag och historik bevaras. Eventuell betalning eller återbetalning bedöms separat.</p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <button type="submit" disabled={isBusy} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-emerald-800 px-4 py-2 font-semibold text-white hover:bg-emerald-900 disabled:opacity-50">{busyKey === 'withdraw_order' ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}{consumerOrder ? 'Bekräfta ånger' : 'Bekräfta begäran'}</button>
                  <button type="button" disabled={isBusy} onClick={() => setReviewWithdrawal(false)} className="min-h-11 rounded-md border border-gray-300 px-4 py-2 font-semibold disabled:opacity-50">Avbryt</button>
                </div>
              </form>}
          </>}
        </section> : null}
        <p className="pb-8 text-xs leading-5 text-gray-500 print:pb-0">Åtgärdslistan används för uppföljning. Utlåtandet och dess låsta innehåll ändras inte av kommentarer, bilder, tilldelningar eller statusar här. Formell kontroll sker vid besiktning.</p>
      </div>
    </main>
  )
}
