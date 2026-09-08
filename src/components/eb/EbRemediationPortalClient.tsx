'use client'

/* eslint-disable @next/next/no-img-element */

import Link from 'next/link'
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type MouseEvent, type ReactNode } from 'react'
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
  Pencil,
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
import { ebRemediationDeadlineSummary, ebRemediationEffectiveDeadline } from '@/lib/eb/remediationDefaults'
import EbRemediationImageViewer from '@/components/eb/EbRemediationImageViewer'

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
  if (paid) return status === 'reported_remedied' ? 'Klar' : 'Ej klar'
  return STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status
}

function statusClassName(status: EbRemediationStatus, paid = false) {
  if (status === 'reported_remedied') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (paid) return 'border-gray-200 bg-gray-50 text-gray-700'
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

function matchesTaskFilters(task: EbRemediationTask, status: string, assignee: string, paid: boolean) {
  if (paid ? status === 'done' ? task.status !== 'reported_remedied' : status === 'not_done' && task.status === 'reported_remedied' : status !== 'all' && task.status !== status) return false
  if (assignee === 'unassigned') return !task.assigneeId
  return assignee === 'all' || task.assigneeId === assignee
}

function taskImageGallery(task: EbRemediationTask, workspace: EbRemediationWorkspace) {
  return [
    ...(workspace.followUp ? workspace.originalImages ?? [] : []).filter((image) => image.taskId === task.id).map((image) => ({
      id: `original:${image.id}`, url: image.imageUrl,
      alt: `${taskReference(task)} – ${image.fileName || 'Originalbild från utlåtandet'}`,
      caption: `${taskReference(task)} · Bilder i utlåtandet${image.fileName ? ` · ${image.fileName}` : ''}`,
    })),
    ...workspace.images.filter((image) => image.taskId === task.id).map((image) => ({
      id: `follow-up:${image.id}`, url: image.imageUrl,
      alt: `${taskReference(task)} – ${image.fileName || 'Bild i uppföljningen'}`,
      caption: `${taskReference(task)} · Bilder i uppföljningen${image.fileName ? ` · ${image.fileName}` : ''}`,
    })),
  ]
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

function PortalHelp({ children, label, className = '' }: { children: ReactNode; label: string; className?: string }) {
  const id = useId()
  const container = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ left: number; top: number; width: number } | null>(null)
  useEffect(() => {
    if (!position) return
    const dismiss = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setPosition(null) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setPosition(null) }
    const close = () => setPosition(null)
    const closeOnScroll = (event: Event) => { if (!(event.target instanceof Node) || !container.current?.contains(event.target)) close() }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', closeOnScroll, true)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', escape)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', closeOnScroll, true)
    }
  }, [position])
  return <div ref={container} className={`inline-flex shrink-0 print:hidden ${className}`}>
    <button type="button" aria-label={`Hjälp om ${label}`} aria-expanded={Boolean(position)} aria-controls={position ? id : undefined}
      onClick={(event) => {
        if (position) { setPosition(null); return }
        const box = event.currentTarget.getBoundingClientRect()
        const width = Math.min(320, window.innerWidth - 32)
        setPosition({ width, left: Math.max(16, Math.min(box.left, window.innerWidth - width - 16)), top: window.innerHeight - box.bottom < 210 ? Math.max(16, box.top - 210) : box.bottom + 8 })
      }} className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600">
      <Info size={17} aria-hidden />
    </button>
    {position ? <div id={id} role="note" style={position} className="fixed z-[310] max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-700 shadow-lg print:hidden">{children}</div> : null}
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
  const [expandedHistory, setExpandedHistory] = useState<string[]>([])
  const [taskErrors, setTaskErrors] = useState<Record<string, string>>({})
  const [imageSelection, setImageSelection] = useState<{ taskId: string; imageId: string } | null>(null)
  const [selectedSuggestion, setSelectedSuggestion] = useState('')
  const [addingAssignee, setAddingAssignee] = useState(initialWorkspace.assignees.length === 0)
  const [editingAssigneeId, setEditingAssigneeId] = useState<string | null>(null)
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
  const orderDetailsRef = useRef<HTMLDetailsElement>(null)

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
    setImageSelection((selection) => selection && next.state === 'open' && next.tasks.some((task) =>
      task.id === selection.taskId && matchesTaskFilters(task, filterStatus, filterAssignee, Boolean(next.followUp)))
      ? selection : null)
  }, [filterStatus, filterAssignee])

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
  useEffect(() => {
    const openOrder = () => {
      if (window.location.hash !== '#angra-bestallning' || !orderDetailsRef.current) return
      orderDetailsRef.current.open = true
      orderDetailsRef.current.scrollIntoView({ block: 'start' })
    }
    openOrder()
    window.addEventListener('hashchange', openOrder)
    return () => window.removeEventListener('hashchange', openOrder)
  }, [isCustomerOwner])

  const callAction = async (action: string, payload: Record<string, unknown>, key = action, onError?: (message: string) => void) => {
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
      const message = error instanceof Error ? error.message : 'Åtgärden misslyckades.'
      if (onError) onError(message)
      else showNotice(message)
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
    () => workspace.tasks.filter((task) => matchesTaskFilters(task, filterStatus, filterAssignee, paid)),
    [filterAssignee, filterStatus, workspace.tasks, paid]
  )
  const selectedVisibleTaskIds = selectedTaskIds.filter((id) => filteredTasks.some((task) => task.id === id))
  const deadlineSummary = ebRemediationDeadlineSummary(filteredTasks, defaultRemedyDeadline)
  // Re-resolve against current authorized data after refresh/reassignment.
  // Never retain an old task's signed image URLs in viewer state.
  const imageTask = filteredTasks.find((task) => task.id === imageSelection?.taskId)
  const galleryImages = imageTask ? taskImageGallery(imageTask, workspace) : []

  const createAssignee = async () => {
    const ok = await callAction('create_assignee', newAssignee, 'create-assignee')
    if (ok) {
      setNewAssignee(newAssigneeDraft())
      setSelectedSuggestion('')
      setBulkAssigneeId(null)
      setAddingAssignee(false)
      showNotice('Mottagaren är tillagd. Tilldela anmärkningar och välj sedan Skicka lista.')
    }
  }

  const saveAssignee = async (assigneeId: string) => {
    const draft = assigneeDrafts[assigneeId]
    if (!draft) return false
    const saved = await callAction('update_assignee', { assigneeId, ...draft }, `save-assignee-${assigneeId}`)
    if (saved) setEditingAssigneeId(null)
    return saved
  }

  const sendAssigneeLink = async (assigneeId: string) => {
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
    setTaskErrors((current) => ({ ...current, [taskId]: '' }))
    const ok = await callAction('status', { taskId, status, message: comments[taskId] ?? '', expectedUpdatedAt: task?.updatedAt }, `status-${taskId}-${status}`, paid ? (message) => setTaskErrors((current) => ({ ...current, [taskId]: message })) : undefined)
    if (ok) {
      setComments((current) => ({ ...current, [taskId]: '' }))
      if (paid) {
        setExpandedComments((current) => current.filter((id) => id !== taskId))
        showNotice(status === 'reported_remedied' ? `${task ? taskReference(task) : 'Punkten'} är markerad klar.` : 'Begäran om komplettering är sparad. Punkten är nu Ej klar.')
      }
    }
  }

  const addComment = async (taskId: string) => {
    const message = comments[taskId] ?? ''
    setTaskErrors((current) => ({ ...current, [taskId]: '' }))
    const ok = await callAction('comment', { taskId, message, expectedUpdatedAt: workspace.tasks.find((task) => task.id === taskId)?.updatedAt }, `comment-${taskId}`, paid ? (error) => setTaskErrors((current) => ({ ...current, [taskId]: error })) : undefined)
    if (ok) {
      setComments((current) => ({ ...current, [taskId]: '' }))
      if (paid) showNotice('Kommentaren är sparad. Punktens status har inte ändrats.')
    }
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
    setTaskErrors((current) => ({ ...current, [taskId]: '' }))
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
      const message = error instanceof Error ? error.message : 'Kunde inte ladda upp bilderna.'
      if (paid) setTaskErrors((current) => ({ ...current, [taskId]: message }))
      else showNotice(message)
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
      {notice && !isBusy ? (
        <div className="fixed bottom-4 right-4 z-[300] flex w-[min(360px,calc(100vw-2rem))] items-start gap-3 rounded-md bg-black px-3 py-2 text-sm font-medium leading-5 text-white shadow-2xl print:hidden" role="status">
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
            <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50">
              <Printer size={16} />
              Skriv ut åtgärdslista
            </button>
            <PortalHelp label="utskrift">Skriv ut åtgärdslista skriver ut det urval du visar, inte originalutlåtandet. Sidan hämtar ny information automatiskt.</PortalHelp>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-5 sm:px-6 lg:px-8 print:max-w-none print:px-0">
        {paid ? (
          <section className="flex items-center justify-between gap-3 text-sm text-slate-600 print:hidden">
            <p>{isCustomerOwner ? 'Tilldela anmärkningar, skicka listan och följ vad som blir klart.' : 'Markera klart när åtgärden är utförd. Bifoga en bild eller beskriv åtgärden.'}</p>
            <PortalHelp label="åtgärdsuppföljning">Punkter och originalbilder kommer från det fastställda utlåtandet. Uppföljningen ändrar inte utlåtandet och ersätter inte besiktning. Sidan uppdateras automatiskt och behåller dina osparade texter.</PortalHelp>
          </section>
        ) : null}
        <section aria-label="Sammanställning">
          {paid ? <div className="mb-2 flex items-center justify-between text-sm text-slate-600"><p>{counts.total} {counts.total === 1 ? 'anmärkning' : 'anmärkningar'} totalt</p><PortalHelp label="status">Klar betyder att entreprenören har anmält åtgärden klar, inte att besiktningsmannen har godkänt den. Alla övriga punkter räknas som ej klara. Ingen behöver registrera att arbetet har påbörjats.</PortalHelp></div> : null}
          <div className={`grid grid-cols-2 gap-3 ${paid ? '' : 'md:grid-cols-5'}`}>
          {((paid ? [
            ['Ej klara', counts.remaining, Clock3],
            ['Klara', counts.done, CheckCircle2],
          ] : [
            ['Totalt', counts.total, UsersRound],
            ['Kvar', counts.remaining, Clock3],
            ['Pågår', counts.active, RefreshCw],
            [paid ? 'Komplettering' : 'För kontroll', counts.review, CircleAlert],
            ['Anmälda avhjälpta', counts.done, CheckCircle2],
          ]) as Array<[string, number, LucideIcon]>).map(([label, value, Icon]) => (
            <div key={String(label)} className="rounded-lg border border-gray-200 bg-white px-4 py-3 print:border-gray-500">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold text-gray-500">{String(label)}</p>
                <Icon size={15} className="text-emerald-700" />
              </div>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{Number(value)}</p>
            </div>
          ))}
          </div>
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
          <section className="rounded-lg border border-gray-200 bg-white print:hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div className="flex items-center gap-1"><h2 className="text-lg font-semibold">Åtgärdas av</h2>
                <PortalHelp label="åtgärdas av">Kontrollera entreprenörens namn och e-postadress. Tilldela anmärkningarna och välj Skicka lista. Först då får mottagaren ett mejl med sina punkter. Att lägga till eller redigera en entreprenör skickar inget mejl.</PortalHelp>
              </div>
              {!addingAssignee ? <button type="button" onClick={() => setAddingAssignee(true)} disabled={isBusy} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"><Plus size={16} />Lägg till entreprenör</button> : null}
            </div>
            {addingAssignee ? <form id="new-assignee-form" onSubmit={(event) => { event.preventDefault(); void createAssignee() }} className="mx-5 mb-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <h3 className="mb-3 font-semibold">Ny entreprenör</h3>
            {contractorSuggestions.length > 0 ? <div className="border-b border-gray-200 bg-emerald-50/50 px-4 py-3 text-sm">
              <p className="text-xs leading-5 text-gray-600">Förslag från entreprenaduppgifterna. Kontrollera företag och mottagare; inget skickas automatiskt.</p>
              {contractorSuggestions.length > 1 || workspace.assignees.length > 0 ? <label className="mt-2 block max-w-xl"><span className="text-xs font-semibold text-gray-700">Hämta entreprenörsuppgifter</span><select aria-label="Hämta entreprenörsuppgifter" value={selectedSuggestion} onChange={(event) => {
                setSelectedSuggestion(event.target.value)
                const suggestion = contractorSuggestions[Number(event.target.value)]
                if (event.target.value !== '' && suggestion) setNewAssignee(newAssigneeDraft(suggestion))
              }} disabled={isBusy} className={`${inputClassName()} mt-1`}><option value="">Välj entreprenör eller fyll i nedan</option>{contractorSuggestions.map((suggestion, index) => <option key={index} value={index}>{suggestion.name}{suggestion.contactName ? ` · ${suggestion.contactName}` : ''}{suggestion.email ? ` · ${suggestion.email}` : ''}</option>)}</select></label> : <p className="mt-1 text-xs text-emerald-800">Entreprenörens uppgifter är förifyllda nedan. Komplettera det som saknas.</p>}
            </div> : null}
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <label><span className="text-xs font-semibold text-gray-700">{isCustomerOwner ? 'Entreprenör / arbetsområde' : 'Åtgärdas av'}</span><input value={newAssignee.name} onChange={(event) => setNewAssignee((current) => ({ ...current, name: event.target.value }))} placeholder={isCustomerOwner ? 'Entreprenörens namn' : 'Exempel: Målare'} className={`${inputClassName()} mt-1`} /></label>
              <label><span className="text-xs font-semibold text-gray-700">Företag</span><input value={newAssignee.companyName} onChange={(event) => setNewAssignee((current) => ({ ...current, companyName: event.target.value }))} className={`${inputClassName()} mt-1`} /></label>
              <label><span className="text-xs font-semibold text-gray-700">Kontaktperson</span><input value={newAssignee.contactName} onChange={(event) => setNewAssignee((current) => ({ ...current, contactName: event.target.value }))} className={`${inputClassName()} mt-1`} /></label>
              <label><span className="text-xs font-semibold text-gray-700">E-post</span><input type="email" value={newAssignee.email} onChange={(event) => setNewAssignee((current) => ({ ...current, email: event.target.value }))} className={`${inputClassName()} mt-1`} /></label>
              <label><span className="text-xs font-semibold text-gray-700">Telefon</span><input type="tel" value={newAssignee.phone} onChange={(event) => setNewAssignee((current) => ({ ...current, phone: event.target.value }))} className={`${inputClassName()} mt-1`} /></label>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="submit" disabled={isBusy || !newAssignee.name.trim()} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
                {busyKey === 'create-assignee' ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Spara entreprenör
              </button>
              <button type="button" disabled={isBusy} onClick={() => setAddingAssignee(false)} className="min-h-10 rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-50">Stäng formuläret</button>
            </div>
            </form> : null}
            {workspace.assignees.length > 0 ? (
              <div className="space-y-3 px-5 pb-5">
                {workspace.assignees.map((assignee) => {
                  const draft = assigneeDrafts[assignee.id] ?? assigneeDraft(assignee)
                  const editing = editingAssigneeId === assignee.id
                  const taskCount = workspace.tasks.filter((task) => task.assigneeId === assignee.id).length
                  return (
                    <div key={assignee.id} data-assignee-id={assignee.id} className="rounded-lg border border-slate-200 p-4">
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 space-y-1">
                          <h3 className="text-base font-semibold text-gray-950">{assignee.name}{!assignee.isActive ? <span className="ml-2 text-xs font-normal text-gray-500">Inaktiv</span> : null}</h3>
                          {[assignee.companyName !== assignee.name ? assignee.companyName : null, assignee.contactName].filter(Boolean).length > 0 ? <p className="text-sm text-slate-600">{[assignee.companyName !== assignee.name ? assignee.companyName : null, assignee.contactName].filter(Boolean).join(' · ')}</p> : null}
                          <p className="break-words text-sm text-slate-700">{assignee.email || 'E-post saknas'}{assignee.phone ? ` · ${assignee.phone}` : ''}</p>
                          <p className="text-sm text-slate-500">{taskCount} {taskCount === 1 ? 'tilldelad anmärkning' : 'tilldelade anmärkningar'}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {!editing ? <button type="button" aria-label={`Redigera ${assignee.name}`} onClick={() => setEditingAssigneeId(assignee.id)} disabled={isBusy || Boolean(editingAssigneeId)} className="inline-flex min-h-10 items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"><Pencil size={15} />Redigera</button> : null}
                          {!editing ? <button type="button" onClick={() => void sendAssigneeLink(assignee.id)} disabled={!draft.email || isBusy || !assignee.isActive || (paid && taskCount === 0)} title={paid && taskCount === 0 ? 'Tilldela minst en punkt innan du skickar listan.' : 'Skicka en personlig länk till tilldelade punkter.'} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-emerald-300 px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50 disabled:opacity-40">{busyKey === `send-assignee-${assignee.id}` || busyKey === `save-assignee-${assignee.id}` ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />} Skicka lista</button> : null}
                        </div>
                      </div>
                      {editing ? <div className="mt-4 border-t border-slate-200 pt-4">
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                          {([['name', 'Åtgärdas av', 'text'], ['companyName', 'Företag', 'text'], ['contactName', 'Kontaktperson', 'text'], ['email', 'E-post', 'email'], ['phone', 'Telefon', 'tel']] as const).map(([key, label, type]) => <label key={key} className="block"><span className="text-sm font-medium text-slate-700">{label}</span><input type={type} value={draft[key]} disabled={isBusy} onChange={(event) => setAssigneeDrafts((current) => ({ ...current, [assignee.id]: { ...draft, [key]: event.target.value } }))} aria-label={label} className={`${inputClassName()} mt-1`} /></label>)}
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <button type="button" onClick={() => void saveAssignee(assignee.id)} disabled={isBusy || !draft.name.trim()} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" aria-label="Spara mottagare">{busyKey === `save-assignee-${assignee.id}` ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}Spara</button>
                          <button type="button" onClick={() => { setAssigneeDrafts((current) => ({ ...current, [assignee.id]: assigneeDraft(assignee) })); setEditingAssigneeId(null) }} disabled={isBusy} className="min-h-10 rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">Avbryt ändringar</button>
                        </div>
                      </div> : null}
                    </div>
                  )
                })}
              </div>
            ) : null}
            {isCustomerOwner && soleAssignee && unassignedTaskIds.length > 0 ? <div className="flex flex-col gap-3 border-t border-emerald-200 bg-emerald-50/50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm leading-6 text-gray-700"><strong>{unassignedTaskIds.length} {unassignedTaskIds.length === 1 ? 'anmärkning' : 'anmärkningar'}</strong> saknar entreprenör. Tilldela {unassignedTaskIds.length === 1 ? 'den' : 'dem'} till <strong>{soleAssignee.name}</strong>.</p>
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
            <div><h2 className="text-lg font-semibold">Anmärkningar</h2><p className="mt-1 text-xs text-gray-600">{paid ? 'Klar = anmäld klar av entreprenören, inte godkänd vid besiktning.' : '“Anmäld avhjälpt” är entreprenörens uppgift och innebär inte att punkten är godkänd vid besiktning.'}</p></div>
            <div className="flex flex-wrap gap-2">
              <label><span className="sr-only">Filtrera status</span><select aria-label="Filtrera status" value={filterStatus} onChange={(event) => { setFilterStatus(event.target.value); setSelectedTaskIds([]); setImageSelection(null) }} className={inputClassName()}><option value="all">Alla anmärkningar</option>{paid ? <><option value="not_done">Ej klara</option><option value="done">Klara</option></> : STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              {role !== 'assignee' ? <label><span className="sr-only">Filtrera mottagare</span><select aria-label="Filtrera mottagare" value={filterAssignee} onChange={(event) => { setFilterAssignee(event.target.value); setSelectedTaskIds([]); setImageSelection(null) }} className={inputClassName()}><option value="all">Alla utförare</option><option value="unassigned">Ej tilldelade</option>{workspace.assignees.map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.name}</option>)}</select></label> : null}
            </div>
          </div>

          <div id="remediation-print-summary" className="hidden border-b border-gray-300 px-4 py-3 text-sm print:block">
            <h2 className="font-semibold">Åtgärdslista</h2>
            <p>Urval: {filteredTasks.length} av {workspace.tasks.length} anmärkningar. Status: {filterStatus === 'all' ? 'Alla' : paid ? filterStatus === 'done' ? 'Klara' : 'Ej klara' : statusLabel(filterStatus as EbRemediationStatus)}. Åtgärdas av: {filterAssignee === 'all' ? 'Alla' : filterAssignee === 'unassigned' ? 'Ej tilldelade' : workspace.assignees.find((assignee) => assignee.id === filterAssignee)?.name ?? 'Vald mottagare'}.</p>
            <p>Detta är en uppföljningslista, inte ett nytt besiktningsutlåtande.</p>
          </div>

          {canManage ? <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-4 py-3 print:hidden">
            <button type="button" disabled={isBusy || filteredTasks.length === 0} onClick={() => setSelectedTaskIds(filteredTasks.map((task) => task.id))} className="min-h-10 rounded-md border border-gray-300 px-3 py-2 text-xs font-semibold hover:bg-gray-50 disabled:opacity-50">Markera alla i urvalet</button>
            <button type="button" disabled={isBusy || !filteredTasks.some((task) => !task.assigneeId)} onClick={() => setSelectedTaskIds(filteredTasks.filter((task) => !task.assigneeId).map((task) => task.id))} className="min-h-10 rounded-md border border-gray-300 px-3 py-2 text-xs font-semibold hover:bg-gray-50 disabled:opacity-50">Markera ej tilldelade</button>
            <button type="button" disabled={isBusy || selectedTaskIds.length === 0} onClick={() => setSelectedTaskIds([])} className="min-h-10 rounded-md px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">Avmarkera</button>
            <span className="text-xs text-gray-600">{selectedVisibleTaskIds.length} av {filteredTasks.length} i urvalet valda</span>
            <PortalHelp label="masshantering">Markera de anmärkningar du vill hantera tillsammans. Tilldela ändrar ansvarig men skickar ingen lista. Befintliga datum behålls om du inte väljer att ändra dem. Filterbyte rensar markeringarna.</PortalHelp>
          </div> : null}

          {canManage && selectedVisibleTaskIds.length > 0 ? (
            <div className="sticky top-0 z-20 space-y-3 border-b border-emerald-200 bg-emerald-50 px-4 py-3 print:hidden">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
                <label className="min-w-0 lg:w-64"><span className="text-xs font-semibold text-emerald-900">Åtgärdas av</span><select aria-label="Tilldela till" value={effectiveBulkAssigneeId} onChange={(event) => setBulkAssigneeId(event.target.value)} disabled={isBusy} className={`${inputClassName()} mt-1`}><option value="">Ej tilldelad</option>{activeAssignees.map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.name}</option>)}</select></label>
                <div className="min-w-0"><label className="flex min-h-10 items-center gap-2 text-xs font-semibold text-emerald-900"><input type="checkbox" checked={changeBulkDueDate} onChange={(event) => setChangeBulkDueDate(event.target.checked)} disabled={isBusy} className="h-4 w-4" />Ändra sista åtgärdsdatum</label><input aria-label="Sista åtgärdsdatum" type="date" value={bulkDueDate} onChange={(event) => setBulkDueDate(event.target.value)} disabled={!changeBulkDueDate || isBusy} className={inputClassName()} /></div>
                <button type="button" onClick={() => void assignTasks(selectedVisibleTaskIds, effectiveBulkAssigneeId, changeBulkDueDate ? bulkDueDate : undefined)} disabled={isBusy || (changeBulkDueDate && !bulkDueDate)} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60">{busyKey?.startsWith('assign-') ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} {busyKey?.startsWith('assign-') ? 'Tilldelar...' : 'Tilldela'}</button>
              </div>
              <PortalHelp label="datumändring">Befintliga datum behålls. Datumet ändras bara om du markerar Ändra sista åtgärdsdatum.</PortalHelp>
              {changeBulkDueDate ? <p className="text-sm text-emerald-900">{bulkDueDate ? `Datumet ersätts för ${selectedVisibleTaskIds.length} valda anmärkningar.` : 'Välj ett datum eller avmarkera datumändringen.'}</p> : null}
            </div>
          ) : null}

          {paid && filteredTasks.length > 0 ? (
            <div data-testid="remediation-deadline-summary" className="flex items-center gap-1 px-4 py-2 text-sm text-slate-600 print:hidden">
              <p>{deadlineSummary.missingCount > 0
                ? `Åtgärdsdatum saknas för ${deadlineSummary.missingCount} av ${filteredTasks.length} anmärkningar i urvalet.`
                : deadlineSummary.commonDeadline
                  ? `Klar senast: ${formatDate(deadlineSummary.commonDeadline)}`
                  : 'Olika åtgärdsdatum – se respektive anmärkning.'}</p>
              <PortalHelp label="sista åtgärdsdatum">
                <p>Sammanfattningen gäller anmärkningarna i det aktuella urvalet. Ett separat angivet datum har företräde framför fristen i utlåtandet. Datumet för varje punkt visas vid Klar senast.</p>
                {deadlineSummary.missingCount > 0 ? <p className="mt-2">{isCustomerOwner
                  ? 'För punkter som saknar datum: kom överens med entreprenören om när åtgärderna ska vara klara. Markera sedan dessa anmärkningar och välj Ändra sista åtgärdsdatum.'
                  : 'För punkter som saknar datum behöver beställaren och entreprenören komma överens om när åtgärderna ska vara klara.'}</p> : null}
              </PortalHelp>
            </div>
          ) : null}

          {filteredTasks.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-gray-600">Inga anmärkningar matchar urvalet.</div>
          ) : (
            <div className="space-y-3 bg-slate-50/50 p-3 sm:p-4 print:bg-white print:p-0">
              {filteredTasks.map((task) => {
                const assignee = workspace.assignees.find((item) => item.id === task.assigneeId)
                const events = workspace.events.filter((event) => event.taskId === task.id)
                const images = workspace.images.filter((image) => image.taskId === task.id)
                const taskGallery = taskImageGallery(task, workspace)
                const checked = selectedTaskIds.includes(task.id)
                const showResponse = !paid || expandedComments.includes(task.id)
                const showHistory = expandedHistory.includes(task.id)
                return (
                  <article key={task.id} data-task-id={task.id} className="break-inside-avoid overflow-hidden rounded-xl border border-slate-200 bg-white [overflow-wrap:anywhere] print:rounded-none">
                    <header className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2">
                      {canManage ? <input type="checkbox" checked={checked} disabled={isBusy} onChange={(event) => setSelectedTaskIds((current) => event.target.checked ? [...current, task.id] : current.filter((id) => id !== task.id))} className="mr-1 h-4 w-4 rounded border-gray-300 text-emerald-700 print:hidden" aria-label={`Välj ${taskReference(task)}`} /> : null}
                      <span aria-label={task.snapshot.noteNumber ? `Punkt ${task.snapshot.noteNumber}` : 'Onumrerad punkt'} className="flex h-8 min-w-8 shrink-0 items-center justify-center rounded-full bg-emerald-700 px-1 text-sm font-bold text-white">{task.snapshot.noteNumber ?? '–'}</span>
                      <span title={`Besiktning: ${formatDate(task.snapshot.inspectionDate)}`} className="text-sm font-semibold text-slate-950">{task.snapshot.inspectionVariant}{task.snapshot.inspectionSequenceNo}</span>
                      {task.snapshot.markerKey ? <span title="Beteckning i utlåtandet" className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900">{task.snapshot.markerKey}</span> : null}
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClassName(task.status, paid)}`}>{statusLabel(task.status, paid)}</span>
                      {taskGallery.length > 0 ? <button type="button" data-testid="remediation-note-images" aria-label={`Visa ${taskGallery.length} ${taskGallery.length === 1 ? 'bild' : 'bilder'} för ${taskReference(task)}`} aria-haspopup="dialog" onClick={() => setImageSelection({ taskId: task.id, imageId: taskGallery[0].id })} className="ml-auto inline-flex min-h-10 items-center gap-1.5 rounded-full border border-emerald-200 bg-white px-3 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 print:hidden"><Camera size={15} aria-hidden />{taskGallery.length} {taskGallery.length === 1 ? 'bild' : 'bilder'}</button> : null}
                    </header>
                    <div className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(150px,0.32fr)_1fr]">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-[0.11em] text-slate-500">Del / rum</p>
                        <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-800">{[task.snapshot.disciplineLabel, locationLabel(task)].filter(Boolean).join(' · ') || '–'}</p>
                        {!paid ? <p className="mt-1 text-xs leading-5 text-slate-500">Besiktning: {formatDate(task.snapshot.inspectionDate)}</p> : null}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-[0.11em] text-slate-500">Notering</p>
                        <p className="mt-1 whitespace-pre-wrap text-base leading-7 text-slate-950">{task.snapshot.noteText || '–'}</p>
                      </div>
                    </div>
                    <div className="border-t border-slate-100 px-4 py-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                          <p className="text-xs leading-5 text-slate-600"><span className="font-medium">Klar senast:</span> {formatDate(ebRemediationEffectiveDeadline(task.dueDate, defaultRemedyDeadline))}{!task.dueDate && defaultRemedyDeadline ? ' (enligt utlåtandet)' : ''}</p>
                          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
                            <label htmlFor={canManage ? `task-assignee-${task.id}` : undefined} className="text-xs text-slate-600">Åtgärdas av:</label>
                            {canManage ? (
                              <>
                                <div className="min-w-0 max-w-full print:hidden"><select id={`task-assignee-${task.id}`} value={task.assigneeId ?? ''} onChange={(event) => void assignTasks([task.id], event.target.value)} disabled={isBusy} aria-busy={busyKey === `assign-${task.id}`} className="min-h-10 w-44 max-w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm disabled:opacity-50"><option value="">Ej tilldelad</option>{workspace.assignees.filter((item) => item.isActive || item.id === task.assigneeId).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{busyKey === `assign-${task.id}` ? <span className="ml-2 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800"><Loader2 size={12} className="animate-spin" /> Tilldelar...</span> : null}</div>
                                <p className="hidden text-sm font-semibold print:block">{assignee?.name ?? 'Ej tilldelad'}</p>
                              </>
                            ) : <p className="text-xs font-medium text-slate-800">{assignee?.name ?? 'Ej tilldelad'}</p>}
                          </div>
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:ml-auto print:hidden">
                            <button type="button" onClick={() => setExpandedHistory((current) => current.includes(task.id) ? current.filter((id) => id !== task.id) : [...current, task.id])} aria-expanded={showHistory} aria-controls={`history-${task.id}`} className="inline-flex min-h-10 items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-950"><MessageSquareText size={14} aria-hidden />Historik ({events.length})<ChevronDown size={13} className={showHistory ? 'rotate-180' : ''} aria-hidden /></button>
                            {paid && !isReadOnly ? <button type="button" disabled={isBusy} onClick={() => setExpandedComments((current) => current.includes(task.id) ? current.filter((id) => id !== task.id) : [...current, task.id])} aria-expanded={showResponse} aria-controls={`comment-panel-${task.id}`} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50">{showResponse ? <X size={15} aria-hidden /> : <Pencil size={15} aria-hidden />}{isCustomerOwner || task.status === 'reported_remedied' ? showResponse ? 'Stäng kommentarsfält' : 'Kommentera' : showResponse ? 'Stäng återrapportering' : 'Rapportera åtgärd'}</button> : null}
                          </div>
                        </div>

                        {paid && !isReadOnly && showResponse ? (
                          <div id={`comment-panel-${task.id}`} className="mt-3 space-y-2 border-t border-slate-100 pt-3 print:hidden">
                            <label className="block text-xs font-semibold text-gray-700" htmlFor={`comment-${task.id}`}>{isCustomerOwner ? 'Kommentar till entreprenören' : 'Kommentar eller beskrivning av utförd åtgärd'}</label>
                            <textarea id={`comment-${task.id}`} rows={3} value={comments[task.id] ?? ''} onChange={(event) => setComments((current) => ({ ...current, [task.id]: event.target.value }))} disabled={isBusy} className={inputClassName()} placeholder={role === 'customer_owner' ? 'Beskriv din fråga eller vad som behöver kompletteras.' : 'Beskriv utförd åtgärd. Om arbetet inte kan fotograferas: förklara varför och hur det har åtgärdats.'} />
                            <PortalHelp label="kommentarer">{isCustomerOwner ? 'Ställ en fråga, bifoga en bild eller förklara vad som behöver kompletteras. Begär komplettering återför punkten till Ej klar och är inte ett besiktningsbeslut.' : 'Markera klar med en åtgärdsbild eller en förklarande kommentar när arbetet inte kan fotograferas. Om du inte kan åtgärda punkten: lämna den som Ej klar och beskriv hindret i en kommentar.'}</PortalHelp>
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
                          <div className="mt-4 hidden print:block">
                            <h3 className="text-xs font-semibold text-gray-700">Bilder i utlåtandet</h3>
                            <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                              {(workspace.originalImages ?? []).filter((image) => image.taskId === task.id).map((image) => image.imageUrl ? <div key={image.id} className="overflow-hidden rounded-md border border-gray-200 bg-gray-100"><img src={image.thumbnailUrl ?? image.imageUrl} alt={image.fileName ?? 'Originalbild från utlåtandet'} loading="lazy" className="aspect-square w-full object-cover" /></div> : <p key={image.id} className="text-xs text-gray-500">Originalbilden kunde inte läsas.</p>)}
                            </div>
                          </div>
                        ) : null}

                        <div className={paid && !showResponse ? 'hidden print:block' : ''}>
                        {images.length > 0 ? <h3 className="mt-4 text-xs font-semibold text-gray-700">{paid ? 'Bilder i uppföljningen' : 'Åtgärdsbilder'}</h3> : null}
                        {(images.length > 0 || uploading[task.id]) ? (
                          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                            {images.map((image) => <button type="button" key={image.id} aria-label={`Visa åtgärdsbild för ${taskReference(task)}`} aria-haspopup="dialog" onClick={() => setImageSelection({ taskId: task.id, imageId: `follow-up:${image.id}` })} className="block overflow-hidden rounded-md border border-gray-200 bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600">{image.thumbnailUrl || image.imageUrl ? <img src={image.thumbnailUrl ?? image.imageUrl!} alt={image.fileName ?? 'Åtgärdsbild'} loading="lazy" className="aspect-square w-full object-cover" /> : <span className="block p-3 text-sm text-slate-600">Bilden kunde inte läsas.</span>}</button>)}
                            {uploading[task.id] ? <div className="flex aspect-square items-center justify-center border border-dashed border-emerald-300 bg-emerald-50 text-emerald-800"><div className="text-center"><Loader2 className="mx-auto animate-spin" size={20} /><p className="mt-2 text-xs">{uploading[task.id]} laddas upp</p></div></div> : null}
                          </div>
                        ) : null}
                        </div>

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

                        {paid && !isReadOnly && showResponse ? <div className="my-3 space-y-3 print:hidden">
                          {taskErrors[task.id] ? <p data-testid="remediation-task-error" role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm leading-6 text-rose-800">{taskErrors[task.id]}</p> : null}
                          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                            {ebRemediationAllowedStatuses(role, true).filter((status) => (status === 'reported_remedied' || status === 'returned') && status !== task.status && (!isCustomerOwner || task.status === 'reported_remedied' || task.status === 'cannot_remedy')).map((status) => (
                              <button key={status} type="button" onClick={() => void changeStatus(task.id, status as EbRemediationStatus)} disabled={isBusy} className={`inline-flex min-h-10 items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50 ${status === 'reported_remedied' ? 'bg-emerald-700 text-white hover:bg-emerald-800' : 'border border-gray-300 bg-white text-gray-800 hover:bg-gray-50'}`}>
                                {busyKey === `status-${task.id}-${status}` ? <Loader2 size={14} className="animate-spin" /> : null}
                                {status === 'returned' ? 'Begär komplettering' : 'Markera klar'}
                              </button>
                            ))}
                            <button type="button" disabled={isBusy || !(comments[task.id] ?? '').trim()} onClick={() => void addComment(task.id)} className="inline-flex min-h-10 items-center gap-2 py-2 text-sm font-medium text-slate-600 underline underline-offset-4 hover:text-slate-950 disabled:opacity-50">{busyKey === `comment-${task.id}` ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} aria-hidden />}{isCustomerOwner ? 'Skicka kommentar' : 'Skicka endast kommentar'}</button>
                          </div>
                        </div> : null}

                        <div id={`history-${task.id}`} className={`${showHistory ? '' : 'hidden print:block'} mt-2 border-t border-slate-100 py-3`}>
                          <h3 className="text-xs font-semibold text-slate-700">Kommentarer och historik</h3>
                          <div className="mt-2 space-y-2">
                            {events.length === 0 ? <p className="text-xs text-gray-500">Ingen historik ännu.</p> : events.map((event) => (
                              <div key={event.id} className="border-l-2 border-gray-200 pl-3 text-xs">
                                <div className="flex flex-wrap gap-x-2 text-gray-500"><span className="font-semibold text-gray-700">{event.actorName ?? event.actorEmail ?? 'System'}</span><span>{formatDateTime(event.createdAt)}</span></div>
                                <p className="mt-1 whitespace-pre-wrap text-gray-700">{event.eventType === 'comment' ? event.message : event.eventType === 'task_created' ? 'Åtgärdsuppgiften skapades.' : event.eventType === 'assigned' ? 'Tilldelningen ändrades.' : event.eventType === 'photo_added' ? 'En åtgärdsbild lades till.' : event.fromStatus && event.toStatus ? `Status ändrades från ${statusLabel(event.fromStatus, paid)} till ${statusLabel(event.toStatus, paid)}.` : 'Uppgiften uppdaterades.'}</p>
                                {event.eventType !== 'comment' && event.message ? <p className="mt-1 whitespace-pre-wrap text-gray-700">{event.message}</p> : null}
                              </div>
                            ))}
                          </div>
                          {!isReadOnly && !paid ? <div className="mt-3 flex gap-2 print:hidden"><input value={comments[task.id] ?? ''} onChange={(event) => setComments((current) => ({ ...current, [task.id]: event.target.value }))} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (!busyKeyRef.current) void addComment(task.id) } }} disabled={isBusy} placeholder="Skriv en kommentar" className={inputClassName()} /><button type="button" onClick={() => void addComment(task.id)} disabled={isBusy} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-gray-900 text-white disabled:cursor-not-allowed disabled:opacity-50" aria-label="Skicka kommentar" title="Skicka kommentar">{busyKey === `comment-${task.id}` ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}</button></div> : null}
                        </div>
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>

        {paid && role === 'customer_owner' ? <section className="rounded-lg border border-slate-200 bg-white text-sm [overflow-wrap:anywhere] print:hidden"><details ref={orderDetailsRef} open={withdrawalPending || undefined} id="angra-bestallning" className="group scroll-mt-5">
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-slate-700 focus-visible:outline-2 focus-visible:outline-emerald-600">
            <span><span className="font-semibold">Din beställning</span><span className="mt-1 block text-xs text-slate-500">{withdrawalPending ? 'Registrerad begäran' : consumerOrder ? 'Uppgifter och ångerrätt' : 'Uppgifter och avbeställning'}</span></span><ChevronDown size={17} className="shrink-0 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <div className="border-t border-slate-200 p-5">
          <div id="follow-up-order" className="scroll-mt-5">
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
            {reviewWithdrawal ? <form id="withdrawal-review" aria-label="Bekräfta begäran" onSubmit={async event => {
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
              </form> : null}
          </>}
          </div>
        </details>
          {!withdrawalPending ? <div className="px-5 pb-3"><button type="button" disabled={isBusy} aria-expanded={reviewWithdrawal} aria-controls={reviewWithdrawal ? 'withdrawal-review' : 'angra-bestallning'} onClick={() => { if (orderDetailsRef.current) orderDetailsRef.current.open = true; setReviewWithdrawal(true); if (reviewWithdrawal) withdrawalReviewRef.current?.focus() }} className="min-h-10 py-2 text-sm text-slate-700 underline underline-offset-4 hover:text-slate-950 disabled:opacity-50">{withdrawalLabel}</button></div> : null}
        </section> : null}
        <p className="pb-8 text-xs leading-5 text-gray-500 print:pb-0">Åtgärdslistan används för uppföljning. Utlåtandet och dess låsta innehåll ändras inte av kommentarer, bilder, tilldelningar eller statusar här. Formell kontroll sker vid besiktning.</p>
      </div>
      <EbRemediationImageViewer images={galleryImages} activeImageId={imageTask ? imageSelection?.imageId ?? null : null} onClose={() => setImageSelection(null)} />
    </main>
  )
}
