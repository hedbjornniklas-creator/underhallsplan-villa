'use client'

/* eslint-disable @next/next/no-img-element */

import Link from 'next/link'
import { useMemo, useRef, useState, type ChangeEvent, type MouseEvent } from 'react'
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock3,
  ImagePlus,
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
  EbRemediationStatus,
  EbRemediationTask,
  EbRemediationWorkspace,
} from '@/lib/eb/remediation'

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

const STATUS_OPTIONS: Array<{ value: EbRemediationStatus; label: string }> = [
  { value: 'unassigned', label: 'Ej tilldelad' },
  { value: 'assigned', label: 'Tilldelad' },
  { value: 'in_progress', label: 'Pågår' },
  { value: 'ready_for_review', label: 'Klar för entreprenörens kontroll' },
  { value: 'returned', label: 'Återlämnad' },
  { value: 'reported_remedied', label: 'Anmäld avhjälpt' },
  { value: 'cannot_remedy', label: 'Kan inte avhjälpas' },
]

function statusLabel(status: EbRemediationStatus) {
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

function inputClassName() {
  return 'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 disabled:bg-gray-100 disabled:text-gray-500'
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
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const busyKeyRef = useRef<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const noticeTimerRef = useRef<number | null>(null)
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([])
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterAssignee, setFilterAssignee] = useState('all')
  const [bulkAssigneeId, setBulkAssigneeId] = useState('')
  const [bulkDueDate, setBulkDueDate] = useState('')
  const [backNavigationPending, setBackNavigationPending] = useState(false)
  const [newAssignee, setNewAssignee] = useState<AssigneeDraft>({
    name: '',
    companyName: '',
    contactName: '',
    email: '',
    phone: '',
    isActive: true,
  })
  const [assigneeDrafts, setAssigneeDrafts] = useState<Record<string, AssigneeDraft>>(() =>
    Object.fromEntries(initialWorkspace.assignees.map((assignee) => [assignee.id, assigneeDraft(assignee)]))
  )
  const [inviteName, setInviteName] = useState('')
  const [inviteEmail, setInviteEmail] = useState(initialWorkspace.project.contractorEmail ?? '')
  const [inviteRole, setInviteRole] = useState<EbRemediationAccessRole>('contractor_admin')
  const [comments, setComments] = useState<Record<string, string>>({})
  const [uploading, setUploading] = useState<Record<string, number>>({})
  const uploadingTaskIdsRef = useRef(new Set<string>())

  const role = workspace.access.role
  const canManage = internal || role === 'contractor_admin'
  const canRespond = role === 'assignee' || role === 'contractor_admin'
  const isReadOnly = role === 'contractor_viewer'
  const isBusy = Boolean(busyKey) || Object.keys(uploading).length > 0

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

  const callAction = async (action: string, payload: Record<string, unknown>, key = action) => {
    if (busyKeyRef.current || uploadingTaskIdsRef.current.size > 0) return false
    busyKeyRef.current = key
    setBusyKey(key)
    try {
      const response = await fetch(scopedEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, payload }),
      })
      const data = (await response.json().catch(() => ({}))) as ApiResponse
      if (!response.ok) throw new Error(data.error ?? 'Åtgärden misslyckades.')
      if (data.workspace) {
        setWorkspace(data.workspace)
        setAssigneeDrafts(
          Object.fromEntries(data.workspace.assignees.map((assignee) => [assignee.id, assigneeDraft(assignee)]))
        )
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
    setBusyKey('reload')
    try {
      const response = await fetch(scopedEndpoint, { cache: 'no-store' })
      const data = (await response.json().catch(() => ({}))) as ApiResponse
      if (!response.ok || !data.workspace) throw new Error(data.error ?? 'Kunde inte uppdatera sidan.')
      setWorkspace(data.workspace)
      setAssigneeDrafts(
        Object.fromEntries(data.workspace.assignees.map((assignee) => [assignee.id, assigneeDraft(assignee)]))
      )
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
    const review = workspace.tasks.filter((task) => task.status === 'ready_for_review').length
    const active = workspace.tasks.filter((task) => task.status === 'in_progress').length
    return { total, done, review, active, remaining: total - done }
  }, [workspace.tasks])

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

  const createAssignee = async () => {
    const ok = await callAction('create_assignee', newAssignee, 'create-assignee')
    if (ok) {
      setNewAssignee({ name: '', companyName: '', contactName: '', email: '', phone: '', isActive: true })
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
    if (ok) showNotice('Den personliga länken har skickats.')
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
    const payload: Record<string, unknown> = {
      taskIds,
      assigneeId: assigneeId || null,
    }
    if (dueDate !== undefined) payload.dueDate = dueDate || null
    const ok = await callAction(
      'assign',
      payload,
      `assign-${taskIds.join('-')}`
    )
    if (ok) setSelectedTaskIds((current) => current.filter((id) => !taskIds.includes(id)))
  }

  const changeStatus = async (taskId: string, status: EbRemediationStatus) => {
    await callAction('status', { taskId, status }, `status-${taskId}-${status}`)
  }

  const addComment = async (taskId: string) => {
    const message = comments[taskId] ?? ''
    const ok = await callAction('comment', { taskId, message }, `comment-${taskId}`)
    if (ok) setComments((current) => ({ ...current, [taskId]: '' }))
  }

  const uploadImages = async (taskId: string, event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).slice(0, 15)
    event.target.value = ''
    if (files.length === 0 || busyKeyRef.current || uploadingTaskIdsRef.current.size > 0) return
    uploadingTaskIdsRef.current.add(taskId)
    setUploading((current) => ({ ...current, [taskId]: files.length }))
    try {
      const results = await Promise.all(
        files.map(async (file) => {
          const body = new FormData()
          body.append('taskId', taskId)
          body.append('file', file)
          const response = await fetch(scopedImagesEndpoint, { method: 'POST', body })
          const data = (await response.json().catch(() => ({}))) as ApiResponse
          if (!response.ok) throw new Error(data.error ?? `Kunde inte ladda upp ${file.name}.`)
          return data.workspace
        })
      )
      const latest = [...results].reverse().find(Boolean)
      if (latest) setWorkspace(latest)
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
            Kontakta entreprenören för en ny personlig länk.
          </p>
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
              <p className="text-xs font-semibold uppercase text-emerald-700">Åtgärdsportal</p>
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
              {role === 'internal' ? 'Besiktningsman' : role === 'contractor_admin' ? 'Entreprenör · administratör' : role === 'contractor_viewer' ? 'Entreprenör · läsbehörighet' : 'Utförare'}
            </span>
            <button type="button" onClick={() => void reload()} disabled={isBusy} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50" title="Uppdatera" aria-label="Uppdatera">
              <RefreshCw size={16} className={busyKey === 'reload' ? 'animate-spin' : ''} />
            </button>
            <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50">
              <Printer size={16} />
              Skriv ut / spara PDF
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-5 sm:px-6 lg:px-8 print:max-w-none print:px-0">
        <section className="grid grid-cols-2 gap-3 md:grid-cols-5" aria-label="Sammanställning">
          {([
            ['Totalt', counts.total, UsersRound],
            ['Kvar', counts.remaining, Clock3],
            ['Pågår', counts.active, RefreshCw],
            ['För kontroll', counts.review, CircleAlert],
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

        {internal ? (
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
              <p className="mt-1 text-xs text-gray-600">Skapa en grupp en gång och återanvänd den. E-postadressen får en egen lista med endast gruppens punkter.</p>
            </div>
            <div className="grid gap-3 border-b border-gray-200 bg-gray-50 p-4 md:grid-cols-2 lg:grid-cols-6 lg:items-end">
              <label><span className="text-xs font-semibold text-gray-700">Åtgärdas av</span><input value={newAssignee.name} onChange={(event) => setNewAssignee((current) => ({ ...current, name: event.target.value }))} placeholder="Exempel: Målare" className={`${inputClassName()} mt-1`} /></label>
              <label><span className="text-xs font-semibold text-gray-700">Företag</span><input value={newAssignee.companyName} onChange={(event) => setNewAssignee((current) => ({ ...current, companyName: event.target.value }))} className={`${inputClassName()} mt-1`} /></label>
              <label><span className="text-xs font-semibold text-gray-700">Kontaktperson</span><input value={newAssignee.contactName} onChange={(event) => setNewAssignee((current) => ({ ...current, contactName: event.target.value }))} className={`${inputClassName()} mt-1`} /></label>
              <label><span className="text-xs font-semibold text-gray-700">E-post</span><input type="email" value={newAssignee.email} onChange={(event) => setNewAssignee((current) => ({ ...current, email: event.target.value }))} className={`${inputClassName()} mt-1`} /></label>
              <label><span className="text-xs font-semibold text-gray-700">Telefon</span><input type="tel" value={newAssignee.phone} onChange={(event) => setNewAssignee((current) => ({ ...current, phone: event.target.value }))} className={`${inputClassName()} mt-1`} /></label>
              <button type="button" onClick={() => void createAssignee()} disabled={isBusy} className="inline-flex items-center justify-center gap-2 rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-60">
                {busyKey === 'create-assignee' ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Lägg till
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
                        <button type="button" onClick={() => void sendAssigneeLink(assignee.id)} disabled={!draft.email || isBusy} className="inline-flex items-center gap-2 rounded-md border border-emerald-300 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40">{busyKey === `send-assignee-${assignee.id}` || busyKey === `save-assignee-${assignee.id}` ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />} Skicka lista</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : null}
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
              <label><span className="sr-only">Filtrera status</span><select value={filterStatus} onChange={(event) => setFilterStatus(event.target.value)} className={inputClassName()}><option value="all">Alla statusar</option>{STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              {role !== 'assignee' ? <label><span className="sr-only">Filtrera mottagare</span><select value={filterAssignee} onChange={(event) => setFilterAssignee(event.target.value)} className={inputClassName()}><option value="all">Alla utförare</option><option value="unassigned">Ej tilldelade</option>{workspace.assignees.map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.name}</option>)}</select></label> : null}
            </div>
          </div>

          {canManage && selectedTaskIds.length > 0 ? (
            <div className="sticky top-0 z-20 flex flex-col gap-3 border-b border-emerald-200 bg-emerald-50 px-4 py-3 md:flex-row md:items-end print:hidden">
              <p className="self-center text-sm font-semibold text-emerald-900">{selectedTaskIds.length} valda</p>
              <label className="min-w-56"><span className="text-xs font-semibold text-emerald-900">Åtgärdas av</span><select value={bulkAssigneeId} onChange={(event) => setBulkAssigneeId(event.target.value)} className={`${inputClassName()} mt-1`}><option value="">Ej tilldelad</option>{workspace.assignees.filter((assignee) => assignee.isActive).map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.name}</option>)}</select></label>
              <label><span className="text-xs font-semibold text-emerald-900">Klar senast</span><input type="date" value={bulkDueDate} onChange={(event) => setBulkDueDate(event.target.value)} className={`${inputClassName()} mt-1`} /></label>
              <button type="button" onClick={() => void assignTasks(selectedTaskIds, bulkAssigneeId, bulkDueDate)} disabled={isBusy} className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60">{busyKey?.startsWith('assign-') ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} {busyKey?.startsWith('assign-') ? 'Tilldelar...' : 'Tilldela'}</button>
            </div>
          ) : null}

          {filteredTasks.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-gray-600">Inga anmärkningar matchar urvalet.</div>
          ) : (
            <div className="divide-y divide-gray-200">
              {filteredTasks.map((task) => {
                const assignee = workspace.assignees.find((item) => item.id === task.assigneeId)
                const events = workspace.events.filter((event) => event.taskId === task.id)
                const images = workspace.images.filter((image) => image.taskId === task.id)
                const checked = selectedTaskIds.includes(task.id)
                return (
                  <article key={task.id} className="break-inside-avoid px-4 py-4 print:px-0">
                    <div className="flex items-start gap-3">
                      {canManage ? <input type="checkbox" checked={checked} onChange={(event) => setSelectedTaskIds((current) => event.target.checked ? [...current, task.id] : current.filter((id) => id !== task.id))} className="mt-1 h-4 w-4 rounded border-gray-300 text-emerald-700 print:hidden" aria-label={`Välj ${taskReference(task)}`} /> : null}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold uppercase text-emerald-700">{taskReference(task)}</span><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClassName(task.status)}`}>{statusLabel(task.status)}</span></div>
                            <p className="mt-2 whitespace-pre-wrap text-sm font-medium leading-6 text-gray-950">{task.snapshot.noteText}</p>
                            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
                              {task.snapshot.disciplineLabel ? <span>Del: {task.snapshot.disciplineLabel}</span> : null}
                              {locationLabel(task) ? <span>Plats: {locationLabel(task)}</span> : null}
                              <span>Besiktning: {formatDate(task.snapshot.inspectionDate)}</span>
                              <span>Klar senast: {formatDate(task.dueDate)}</span>
                            </div>
                          </div>
                          <div className="flex shrink-0 flex-col gap-2 lg:w-64 print:w-auto">
                            <p className="text-xs font-semibold text-gray-500">Åtgärdas av</p>
                            {canManage ? (
                              <div className="space-y-1"><select value={task.assigneeId ?? ''} onChange={(event) => void assignTasks([task.id], event.target.value)} disabled={isBusy} aria-busy={busyKey === `assign-${task.id}`} className={inputClassName()}><option value="">Ej tilldelad</option>{workspace.assignees.filter((item) => item.isActive || item.id === task.assigneeId).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{busyKey === `assign-${task.id}` ? <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800"><Loader2 size={12} className="animate-spin" /> Tilldelar...</span> : null}</div>
                            ) : <p className="text-sm font-semibold">{assignee?.name ?? 'Ej tilldelad'}</p>}
                          </div>
                        </div>

                        {canRespond && !internal ? (
                          <div className="mt-4 flex flex-wrap gap-2 print:hidden">
                            {task.status !== 'in_progress' && task.status !== 'reported_remedied' ? <button type="button" onClick={() => void changeStatus(task.id, 'in_progress')} disabled={isBusy} className="inline-flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 disabled:cursor-not-allowed disabled:opacity-50">{busyKey === `status-${task.id}-in_progress` ? <Loader2 size={14} className="animate-spin" /> : <Clock3 size={14} />} {busyKey === `status-${task.id}-in_progress` ? 'Startar...' : 'Påbörja'}</button> : null}
                            {role === 'assignee' ? <button type="button" onClick={() => void changeStatus(task.id, 'ready_for_review')} disabled={isBusy} className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{busyKey === `status-${task.id}-ready_for_review` ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} {busyKey === `status-${task.id}-ready_for_review` ? 'Sparar...' : 'Klar för kontroll'}</button> : null}
                            {role === 'assignee' ? <button type="button" onClick={() => void changeStatus(task.id, 'cannot_remedy')} disabled={isBusy} className="inline-flex items-center gap-2 rounded-md border border-rose-300 px-3 py-2 text-xs font-semibold text-rose-800 disabled:cursor-not-allowed disabled:opacity-50">{busyKey === `status-${task.id}-cannot_remedy` ? <Loader2 size={14} className="animate-spin" /> : <CircleAlert size={14} />} {busyKey === `status-${task.id}-cannot_remedy` ? 'Sparar...' : 'Kan inte avhjälpas'}</button> : null}
                            {role === 'contractor_admin' && task.status === 'ready_for_review' ? <button type="button" onClick={() => void changeStatus(task.id, 'reported_remedied')} disabled={isBusy} className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{busyKey === `status-${task.id}-reported_remedied` ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} {busyKey === `status-${task.id}-reported_remedied` ? 'Sparar...' : 'Markera anmäld avhjälpt'}</button> : null}
                            {role === 'contractor_admin' && task.status === 'ready_for_review' ? <button type="button" onClick={() => void changeStatus(task.id, 'returned')} disabled={isBusy} className="inline-flex items-center gap-2 rounded-md border border-rose-300 px-3 py-2 text-xs font-semibold text-rose-800 disabled:cursor-not-allowed disabled:opacity-50">{busyKey === `status-${task.id}-returned` ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />} {busyKey === `status-${task.id}-returned` ? 'Återlämnar...' : 'Återlämna'}</button> : null}
                          </div>
                        ) : null}

                        {(images.length > 0 || uploading[task.id]) ? (
                          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                            {images.map((image) => <a key={image.id} href={image.imageUrl ?? '#'} target="_blank" rel="noreferrer" className="block overflow-hidden border border-gray-200 bg-gray-100"><img src={image.thumbnailUrl ?? image.imageUrl ?? ''} alt="Åtgärdsbild" loading="lazy" className="aspect-square w-full object-cover" /></a>)}
                            {uploading[task.id] ? <div className="flex aspect-square items-center justify-center border border-dashed border-emerald-300 bg-emerald-50 text-emerald-800"><div className="text-center"><Loader2 className="mx-auto animate-spin" size={20} /><p className="mt-2 text-xs">{uploading[task.id]} laddas upp</p></div></div> : null}
                          </div>
                        ) : null}

                        {!internal && canRespond ? (
                          <div className="mt-4 print:hidden">
                            <label className={`inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-800 ${isBusy || Boolean(uploading[task.id]) ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-gray-50'}`}>
                              <ImagePlus size={15} /> Lägg till åtgärdsbilder
                              <input type="file" accept="image/*" multiple disabled={isBusy || Boolean(uploading[task.id])} className="sr-only" onChange={(event) => void uploadImages(task.id, event)} />
                            </label>
                            <p className="mt-1 text-xs text-gray-500">Max 15 bilder åt gången och 15 MB per bild. Uppladdningen sker i bakgrunden.</p>
                          </div>
                        ) : null}

                        <details className="mt-4 border-t border-gray-200 pt-3 print:open">
                          <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-semibold text-gray-700 print:hidden"><MessageSquareText size={15} /> Kommentarer och historik ({events.length}) <ChevronDown size={14} /></summary>
                          <div className="mt-3 space-y-2">
                            {events.length === 0 ? <p className="text-xs text-gray-500">Ingen historik ännu.</p> : events.map((event) => <div key={event.id} className="border-l-2 border-gray-200 pl-3 text-xs"><div className="flex flex-wrap gap-x-2 text-gray-500"><span className="font-semibold text-gray-700">{event.actorName ?? event.actorEmail ?? 'System'}</span><span>{formatDateTime(event.createdAt)}</span></div><p className="mt-1 text-gray-700">{event.eventType === 'comment' ? event.message : event.eventType === 'task_created' ? 'Åtgärdsuppgiften skapades.' : event.eventType === 'assigned' ? 'Tilldelningen ändrades.' : event.eventType === 'photo_added' ? 'En åtgärdsbild lades till.' : event.fromStatus && event.toStatus ? `Status ändrades från ${statusLabel(event.fromStatus)} till ${statusLabel(event.toStatus)}.` : 'Uppgiften uppdaterades.'}</p></div>)}
                          </div>
                          {!isReadOnly ? <div className="mt-3 flex gap-2 print:hidden"><input value={comments[task.id] ?? ''} onChange={(event) => setComments((current) => ({ ...current, [task.id]: event.target.value }))} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (!busyKeyRef.current) void addComment(task.id) } }} disabled={isBusy} placeholder="Skriv en kommentar" className={inputClassName()} /><button type="button" onClick={() => void addComment(task.id)} disabled={isBusy} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-gray-900 text-white disabled:cursor-not-allowed disabled:opacity-50" aria-label="Skicka kommentar" title="Skicka kommentar">{busyKey === `comment-${task.id}` ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}</button></div> : null}
                        </details>
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>

        <p className="pb-8 text-xs leading-5 text-gray-500 print:pb-0">Denna portal är en operativ åtgärdslista. Utlåtandet och dess låsta innehåll ändras inte av kommentarer, bilder, tilldelningar eller statusar här. Formell kontroll sker vid besiktning.</p>
      </div>
    </main>
  )
}
