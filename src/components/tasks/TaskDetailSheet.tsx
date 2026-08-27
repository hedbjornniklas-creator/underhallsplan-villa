'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import {
  ArrowRight,
  Camera,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Clock3,
  CornerDownRight,
  FileText,
  Link2,
  Mic,
  Paperclip,
  Plus,
  RotateCcw,
  Send,
  ShieldCheck,
  Square,
  Trash2,
  UserRound,
  X,
  XCircle,
} from 'lucide-react'
import type {
  TaskAiSuggestionView,
  TaskStatus,
  TaskView,
  TaskWorkspace,
} from '@/lib/tasks/contracts'
import {
  addTaskDateInputDays,
  formatTaskDateTime,
  normalizeTaskTimeZone,
  taskDateTimeInputToIso,
  taskIsoToDateTimeInput,
  taskTimeZoneLabel,
  taskTodayDateInput,
} from '@/lib/tasks/dateTime'
import TaskAttachmentDropZone from './TaskAttachmentDropZone'
import TaskConversationCard from './TaskConversationCard'
import TaskHistoryDisclosure from './TaskHistoryDisclosure'
import { SigneCheckIcon } from './SigneMark'
import { TaskRiskDot, TaskStatusBadge, taskStatusLabel } from './TaskStatusBadge'

type Props = {
  task: TaskView | null
  workspace: TaskWorkspace
  busy: boolean
  onClose: () => void
  onAction: (action: string, payload: Record<string, unknown>) => Promise<void>
  onUpload: (taskId: string, formData: FormData, transcribe?: boolean) => Promise<void>
  onCreateSubtask: (task: TaskView, suggestion?: TaskAiSuggestionView) => void
  onSelectTask: (taskId: string) => void
}

const smallInput =
  'min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-100'
const TASK_ATTACHMENT_ACCEPT =
  'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,application/pdf,.pdf,.doc,.docx,.xls,.xlsx,.txt,text/plain'

function isImageAttachmentFile(file: File) {
  return file.type.toLowerCase().startsWith('image/') || /\.(jpe?g|png|webp|hei[cf])$/i.test(file.name)
}

function completionEvidenceSatisfied(
  type: TaskView['evidenceRequirements'][number],
  task: TaskView
) {
  return task.attachments.some(
    (attachment) =>
      attachment.isCompletionEvidence &&
      (attachment.type === type ||
        (type === 'text' && attachment.type === 'audio' && Boolean(attachment.transcriptText?.trim())))
  )
}

function matchesCompletionEvidenceRequirement(
  task: TaskView,
  type: TaskView['evidenceRequirements'][number]
) {
  if (task.evidenceRequirements.length > 0) return task.evidenceRequirements.includes(type)
  return task.evidenceRequirement === 'any' || task.evidenceRequirement === type
}

export default function TaskDetailSheet({
  task,
  workspace,
  busy,
  onClose,
  onAction,
  onUpload,
  onCreateSubtask,
  onSelectTask,
}: Props) {
  const effectiveTimeZone = normalizeTaskTimeZone(task ? task.dueTimeZone : workspace.timeZone)
  const todayInput = taskTodayDateInput(effectiveTimeZone)
  const [panel, setPanel] = useState<'none' | 'waiting' | 'return' | 'extension' | 'cancel'>('none')
  const [message, setMessage] = useState('')
  const [comment, setComment] = useState('')
  const [date, setDate] = useState(addTaskDateInputDays(todayInput, 2))
  const [time, setTime] = useState('09:00')
  const [dateTimeError, setDateTimeError] = useState<string | null>(null)
  const [evidenceText, setEvidenceText] = useState('')
  const [evidencePanelOpen, setEvidencePanelOpen] = useState(false)
  const [dropUploadBusy, setDropUploadBusy] = useState(false)
  const [recording, setRecording] = useState(false)
  const [mediaError, setMediaError] = useState<string | null>(null)
  const [rejectingSuggestionId, setRejectingSuggestionId] = useState<string | null>(null)
  const [suggestionRejectReason, setSuggestionRejectReason] = useState('')
  const [suggestionFormError, setSuggestionFormError] = useState<string | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recordingStartedAtRef = useRef<number | null>(null)
  const evidenceSectionRef = useRef<HTMLElement>(null)
  const documentInputRef = useRef<HTMLInputElement>(null)
  const deleteDialogRef = useRef<HTMLElement>(null)
  const deleteCancelButtonRef = useRef<HTMLButtonElement>(null)
  const deleteTriggerButtonRef = useRef<HTMLButtonElement>(null)
  const deleteBusy = busy || deleteSubmitting
  const taskId = task?.id ?? null

  const markMessagesRead = useCallback(async (throughEventId: string) => {
    if (!taskId) return
    await onAction('mark_messages_read', { taskId, throughEventId })
  }, [onAction, taskId])

  useEffect(() => {
    if (!task) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (deleteDialogOpen && event.key === 'Tab') {
        const focusableElements = deleteDialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
        )
        if (!focusableElements?.length) {
          event.preventDefault()
          deleteDialogRef.current?.focus()
          return
        }

        const first = focusableElements[0]
        const last = focusableElements[focusableElements.length - 1]
        const active = document.activeElement
        if (!deleteDialogRef.current?.contains(active)) {
          event.preventDefault()
          const focusTarget = event.shiftKey ? last : first
          focusTarget.focus()
        } else if (event.shiftKey && active === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && active === last) {
          event.preventDefault()
          first.focus()
        }
        return
      }

      if (event.key !== 'Escape') return
      if (deleteDialogOpen) {
        event.preventDefault()
        if (!deleteBusy) setDeleteDialogOpen(false)
        return
      }
      if (!busy) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [busy, deleteBusy, deleteDialogOpen, onClose, task])

  useEffect(() => {
    if (!deleteDialogOpen) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    const timer = window.setTimeout(() => deleteCancelButtonRef.current?.focus(), 20)
    return () => {
      window.clearTimeout(timer)
      if (previouslyFocused && document.body.contains(previouslyFocused)) previouslyFocused.focus()
    }
  }, [deleteDialogOpen])

  useEffect(() => {
    return () => {
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
      streamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  const children = useMemo(
    () => (task ? workspace.tasks.filter((candidate) => candidate.parentTaskId === task.id) : []),
    [task, workspace.tasks]
  )

  if (!task) return null

  const currentId = workspace.currentUser.id
  const isTaskIssuer = task.issuerId === currentId
  const evidenceChecklist = task.evidenceRequirements.map((type) => ({
    type,
    complete: completionEvidenceSatisfied(type, task),
  }))
  const canActAsAssignee = task.assignee.kind === 'profile' && task.assignee.id === currentId
  const canActAsIssuer = workspace.currentUser.isOrgAdmin || isTaskIssuer
  const conversationPartnerName = canActAsAssignee ? task.issuerName : task.assignee.name
  const canCreateChild =
    !['approved', 'cancelled'].includes(task.status) &&
    task.depth < workspace.limits.maxDepth &&
    task.openChildCount < workspace.limits.maxOpenChildren &&
    (canActAsAssignee || canActAsIssuer)
  const canRequestSigneSuggestions =
    canActAsIssuer &&
    !['approved', 'cancelled'].includes(task.status) &&
    task.depth < workspace.limits.maxDepth
  const prestartRequirements = task.requirements.filter((requirement) =>
    ['written_quote', 'written_client_approval', 'warranty_basis'].includes(requirement.key)
  )
  const prestartBlocked = prestartRequirements.some(
    (requirement) =>
      requirement.required &&
      !['verified', 'not_required', 'waived'].includes(requirement.status)
  )
  const pendingDeadlineRequests = task.deadlineRequests.filter((request) => request.status === 'pending')
  const ballText =
    task.ballHolder === 'issuer'
      ? task.issuerName
      : task.ballHolder === 'assignee'
        ? task.assignee.name
        : 'Ingen – uppgiften är avslutad'
  const dueInput = taskIsoToDateTimeInput(task.dueAt, effectiveTimeZone)
  const waitingMaxTime = dueInput && date === dueInput.date ? dueInput.time : undefined
  const extensionMinDate = dueInput?.date && dueInput.date > todayInput ? dueInput.date : todayInput
  const extensionMinTime = dueInput && date === dueInput.date ? dueInput.time : undefined

  const openPanel = (nextPanel: typeof panel) => {
    setDateTimeError(null)
    if (nextPanel === 'waiting') {
      const suggestedDate = addTaskDateInputDays(todayInput, 2)
      const nextDate = dueInput && suggestedDate > dueInput.date ? dueInput.date : suggestedDate
      setDate(nextDate)
      setTime(dueInput && nextDate === dueInput.date && '09:00' > dueInput.time ? dueInput.time : '09:00')
    } else if (nextPanel === 'extension') {
      setDate(addTaskDateInputDays(extensionMinDate, 1))
      setTime(dueInput?.time ?? '16:00')
    }
    setPanel(nextPanel)
  }

  const transition = async (status: TaskStatus, extra: Record<string, unknown> = {}) => {
    await onAction('transition', { taskId: task.id, status, version: task.version, ...extra })
    setPanel('none')
    setMessage('')
  }

  const submitTimedPanel = async () => {
    if (panel !== 'waiting' && panel !== 'extension') return
    const selectedAt = taskDateTimeInputToIso(date, time, effectiveTimeZone)
    if (!selectedAt) {
      setDateTimeError('Kontrollera datum och klockslag. Den valda tiden måste finnas i angiven tidszon.')
      return
    }
    if (panel === 'waiting') {
      if (Date.parse(selectedAt) < Date.now() || Date.parse(selectedAt) > Date.parse(task.dueAt)) {
        setDateTimeError('Signe måste följa upp framåt i tiden och senast när uppdraget ska vara klart.')
        return
      }
      setDateTimeError(null)
      await transition('waiting', { message: message.trim(), nextFollowupAt: selectedAt })
      return
    }
    if (Date.parse(selectedAt) <= Math.max(Date.parse(task.dueAt), Date.now())) {
      setDateTimeError('Den önskade nya sluttiden måste ligga framåt i tiden och efter nuvarande sluttid.')
      return
    }
    setDateTimeError(null)
    await onAction('request_deadline_change', {
      taskId: task.id,
      reason: message.trim(),
      requestedDueAt: selectedAt,
    })
    setPanel('none')
    setMessage('')
  }

  const submitComment = async (event: FormEvent) => {
    event.preventDefault()
    if (!comment.trim()) return
    await onAction('comment', { taskId: task.id, message: comment.trim() })
    setComment('')
  }

  const rejectSuggestion = async (suggestionId: string) => {
    const reason = suggestionRejectReason.trim()
    if (reason.length < 3) {
      setSuggestionFormError('Beskriv kort varför förslaget inte ska användas.')
      return
    }
    setSuggestionFormError(null)
    await onAction('reject_signe_suggestion', {
      taskId: task.id,
      suggestionId,
      reason,
    })
    setRejectingSuggestionId(null)
    setSuggestionRejectReason('')
  }

  const archiveTask = async () => {
    if (deleteBusy || task.childCount > 0) return
    setDeleteError(null)
    setDeleteSubmitting(true)
    try {
      await onAction('archive_task', { taskId: task.id, version: task.version })
      setDeleteDialogOpen(false)
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Kunde inte radera uppdraget. Försök igen.')
    } finally {
      setDeleteSubmitting(false)
    }
  }

  const uploadFile = async (
    event: ChangeEvent<HTMLInputElement>,
    completionEvidenceOverride?: boolean
  ) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const form = new FormData()
    form.append('file', file)
    const evidenceType = isImageAttachmentFile(file) ? 'photo' : 'document'
    form.append(
      'completionEvidence',
      String(
        completionEvidenceOverride ??
          matchesCompletionEvidenceRequirement(task, evidenceType)
      )
    )
    await onUpload(task.id, form)
  }

  const uploadDroppedFiles = async (files: File[]) => {
    setDropUploadBusy(true)
    try {
      for (const file of files) {
        const form = new FormData()
        form.append('file', file)
        const evidenceType = isImageAttachmentFile(file) ? 'photo' : 'document'
        const completionEvidence = isTaskIssuer
          ? false
          : matchesCompletionEvidenceRequirement(task, evidenceType)
        form.append('completionEvidence', String(completionEvidence))
        await onUpload(task.id, form)
      }
    } finally {
      setDropUploadBusy(false)
    }
  }

  const submitTextEvidence = async () => {
    if (!evidenceText.trim()) return
    const form = new FormData()
    form.append('text', evidenceText.trim())
    form.append(
      'completionEvidence',
      String(matchesCompletionEvidenceRequirement(task, 'text'))
    )
    await onUpload(task.id, form)
    setEvidenceText('')
    setEvidencePanelOpen(false)
  }

  const startRecording = async () => {
    setMediaError(null)
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setMediaError('Röstinspelning stöds inte i den här webbläsaren.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const preferredTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
      const mimeType = preferredTypes.find((type) => MediaRecorder.isTypeSupported(type))
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      recorderRef.current = recorder
      chunksRef.current = []
      recordingStartedAtRef.current = Date.now()
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onstop = () => {
        const actualType = recorder.mimeType || 'audio/webm'
        const extension = actualType.includes('mp4') ? 'm4a' : actualType.includes('ogg') ? 'ogg' : 'webm'
        const blob = new Blob(chunksRef.current, { type: actualType })
        const durationSeconds = recordingStartedAtRef.current
          ? Math.max(0, Math.round((Date.now() - recordingStartedAtRef.current) / 1000))
          : 0
        stream.getTracks().forEach((track) => track.stop())
        streamRef.current = null
        recorderRef.current = null
        recordingStartedAtRef.current = null
        setRecording(false)
        if (blob.size <= 0) {
          setMediaError('Inspelningen blev tom. Försök igen.')
          return
        }
        const form = new FormData()
        form.append('audio', new File([blob], `rostmeddelande.${extension}`, { type: actualType }))
        form.append('durationSeconds', String(durationSeconds))
        form.append(
          'completionEvidence',
          String(matchesCompletionEvidenceRequirement(task, 'text'))
        )
        void onUpload(task.id, form, true).catch(() => undefined)
      }
      recorder.start(500)
      setRecording(true)
    } catch {
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      setMediaError('Mikrofonen kunde inte startas. Kontrollera webbläsarens behörighet.')
    }
  }

  const stopRecording = () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end bg-slate-950/45 backdrop-blur-[2px] lg:items-stretch lg:justify-end">
      <button className="absolute inset-0 cursor-default" aria-label="Stäng" onClick={busy ? undefined : onClose} />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-detail-title"
        className="relative flex max-h-[95dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-slate-50 shadow-2xl lg:h-full lg:max-h-none lg:max-w-2xl lg:rounded-none lg:rounded-l-3xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <TaskRiskDot risk={task.risk} />
              <TaskStatusBadge status={task.status} />
              {task.contextLabel ? (
                <span className="truncate text-xs font-medium text-slate-500">{task.contextLabel}</span>
              ) : null}
            </div>
            <h2 id="task-detail-title" className="mt-3 text-xl font-semibold leading-tight text-slate-950 sm:text-2xl">
              {task.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 disabled:opacity-50"
            aria-label="Stäng"
          >
            <X size={22} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-5 sm:px-6 lg:pb-8">
          {task.description ? <p className="whitespace-pre-wrap text-sm leading-7 text-slate-700">{task.description}</p> : null}

          <dl className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-3.5">
              <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <ShieldCheck size={14} /> Uppdragsansvarig
              </dt>
              <dd className="mt-2 text-sm font-semibold text-slate-900">{task.issuerName}</dd>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-3.5">
              <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <UserRound size={14} /> Mottagare
              </dt>
              <dd className="mt-2 text-sm font-semibold text-slate-900">{task.assignee.name}</dd>
              {task.assignee.companyName ? <dd className="mt-0.5 text-xs text-slate-500">{task.assignee.companyName}</dd> : null}
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-3.5">
              <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <CircleDashed size={14} /> Bollen hos
              </dt>
              <dd className="mt-2 text-sm font-semibold text-slate-900">{ballText}</dd>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-3.5">
              <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <CalendarClock size={14} /> Ska vara klart
              </dt>
              <dd className="mt-2 text-sm font-semibold leading-5 text-slate-900">
                {formatTaskDateTime(task.dueAt, effectiveTimeZone)}
              </dd>
              <dd className="mt-1 text-xs text-slate-500">{taskTimeZoneLabel(effectiveTimeZone)}</dd>
            </div>
            {isTaskIssuer ? (
              <div className="col-span-2 rounded-2xl border border-slate-200 bg-white p-3.5">
                <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <Clock3 size={14} /> Signe följer upp internt
                </dt>
                <dd className="mt-2 text-sm font-semibold text-slate-900">
                  {formatTaskDateTime(task.nextFollowupAt, effectiveTimeZone)}
                </dd>
              </div>
            ) : null}
          </dl>

          {(canActAsAssignee || (canActAsIssuer && task.status === 'ready_for_review')) ? (
            <section className="mt-4 rounded-2xl border border-indigo-200 bg-indigo-50 p-4" aria-labelledby="task-next-step-heading">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-indigo-700">Ditt nästa steg</p>
              {canActAsIssuer && task.status === 'ready_for_review' ? (
                <>
                  <h3 id="task-next-step-heading" className="mt-2 text-base font-semibold text-indigo-950">Kontrollera mottagarens underlag</h3>
                  <p className="mt-1 text-sm leading-6 text-indigo-900">Granska bilagor och kommentarer. Godkänn uppgiften eller begär rättning längst ned.</p>
                  <button
                    type="button"
                    onClick={() => evidenceSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                    className="mt-3 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-indigo-700 px-4 text-sm font-semibold text-white hover:bg-indigo-800"
                  >
                    <FileText size={17} /> Granska underlaget
                  </button>
                </>
              ) : ['assigned', 'waiting', 'returned'].includes(task.status) && prestartBlocked ? (
                <>
                  <h3 id="task-next-step-heading" className="mt-2 text-base font-semibold text-indigo-950">Ladda upp efterfrågat underlag</h3>
                  <p className="mt-1 text-sm leading-6 text-indigo-900">Skicka in offert eller annat efterfrågat dokument. Uppdragsansvarig kontrollerar det innan arbetet får starta.</p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => documentInputRef.current?.click()}
                    className="mt-3 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-indigo-700 px-4 text-sm font-semibold text-white hover:bg-indigo-800 disabled:opacity-50"
                  >
                    <Paperclip size={17} /> Ladda upp offert eller dokument
                  </button>
                </>
              ) : ['assigned', 'waiting', 'returned'].includes(task.status) ? (
                <>
                  <h3 id="task-next-step-heading" className="mt-2 text-base font-semibold text-indigo-950">{task.status === 'waiting' ? 'Återuppta uppdraget' : 'Bekräfta att du börjar'}</h3>
                  <p className="mt-1 text-sm leading-6 text-indigo-900">Då ser uppdragsansvarig att uppgiften är omhändertagen.</p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => transition('in_progress')}
                    className="mt-3 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-indigo-700 px-4 text-sm font-semibold text-white hover:bg-indigo-800 disabled:opacity-50"
                  >
                    <ArrowRight size={17} /> {task.status === 'waiting' ? 'Återuppta uppdraget' : 'Starta uppdraget'}
                  </button>
                </>
              ) : task.status === 'in_progress' ? (
                <>
                  <h3 id="task-next-step-heading" className="mt-2 text-base font-semibold text-indigo-950">Dokumentera det som är gjort</h3>
                  <p className="mt-1 text-sm leading-6 text-indigo-900">Lägg till foto, dokument, text eller röstmeddelande och skicka sedan uppgiften för kontroll.</p>
                  <button
                    type="button"
                    onClick={() => evidenceSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                    className="mt-3 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-indigo-700 px-4 text-sm font-semibold text-white hover:bg-indigo-800"
                  >
                    <Camera size={17} /> Lägg till underlag
                  </button>
                </>
              ) : null}
            </section>
          ) : task.status === 'ready_for_review' ? (
            <section className="mt-4 rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-indigo-700">Nästa steg</p>
              <p className="mt-2 text-sm font-semibold text-indigo-950">Uppgiften väntar på kontroll från {task.issuerName}.</p>
            </section>
          ) : null}

          {task.initialDispatchPending && canActAsIssuer ? (
            <div className="mt-3 flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-amber-950">Utskicket väntar</p>
                <p className="mt-0.5 text-xs leading-5 text-amber-900">
                  Lägg till eventuella återstående underlag nedan. Mottagaren meddelas först när du väljer att skicka uppdraget.
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  onAction(
                    task.assignee.kind === 'contact' ? 'issue_access_link' : 'dispatch_assignment',
                    task.assignee.kind === 'contact'
                      ? { taskId: task.id, sendEmail: true }
                      : { taskId: task.id }
                  )
                }
                className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-amber-700 px-4 text-sm font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
              >
                <Send size={17} /> Skicka uppdraget
              </button>
            </div>
          ) : null}

          {task.assignee.kind === 'contact' && canActAsIssuer && !task.initialDispatchPending ? (
            <div className="mt-3 flex flex-col gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-blue-950">Extern mottagare</p>
                <p className="mt-0.5 text-xs leading-5 text-blue-800">
                  Skicka en ny personlig länk som öppnar just det här uppdraget utan inloggning.
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => onAction('issue_access_link', { taskId: task.id, sendEmail: true })}
                className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-blue-700 px-4 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
              >
                <Link2 size={17} /> Skicka uppdragslänk
              </button>
            </div>
          ) : null}

          {pendingDeadlineRequests.length > 0 ? (
            <section className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <h3 className="text-sm font-semibold text-amber-950">Begärd förlängning</h3>
              {pendingDeadlineRequests.map((request) => (
                <div key={request.id} className="mt-3 border-t border-amber-200 pt-3 first:mt-2 first:border-0 first:pt-0">
                  <p className="text-sm text-amber-950">
                    Ny önskad sluttid: <strong>{formatTaskDateTime(request.requestedDueAt, effectiveTimeZone)}</strong>
                  </p>
                  <p className="mt-1 text-sm text-amber-800">{request.reason}</p>
                  {canActAsIssuer ? (
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onAction('decide_deadline_change', { taskId: task.id, requestId: request.id, decision: 'approved', version: task.version })}
                        className="min-h-10 rounded-xl bg-emerald-700 px-3 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                      >
                        Godkänn
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onAction('decide_deadline_change', { taskId: task.id, requestId: request.id, decision: 'rejected', version: task.version })}
                        className="min-h-10 rounded-xl border border-amber-300 bg-white px-3 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                      >
                        Avslå
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </section>
          ) : null}

          <div className="mt-6">
            <TaskConversationCard
              headingId={`task-conversation-${task.id}`}
              messages={task.events}
              value={comment}
              onChange={setComment}
              onSubmit={submitComment}
              submitting={busy}
              recipientLabel={conversationPartnerName}
              placeholder={`Skriv till ${conversationPartnerName}…`}
              unreadCount={task.unreadMessageCount}
              latestIncomingMessageEventId={task.latestIncomingMessageEventId}
              onMarkRead={markMessagesRead}
            />
          </div>

          {task.requirements.length > 0 ? (
            <section className="mt-6">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-slate-950">Kontrollpunkter</h3>
                <span className="text-xs text-slate-500">
                  {task.requirements.filter((item) => ['verified', 'not_required', 'waived'].includes(item.status)).length}/{task.requirements.length}
                </span>
              </div>
              <div className="mt-2 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                {task.requirements.map((requirement) => {
                  const done = ['verified', 'not_required', 'waived'].includes(requirement.status)
                  return (
                    <div key={requirement.id} className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-0">
                      {done ? <CheckCircle2 className="shrink-0 text-emerald-600" size={20} /> : <CircleDashed className="shrink-0 text-slate-400" size={20} />}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-800">{requirement.label}</p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {requirement.status === 'verified'
                            ? `Verifierad${requirement.verifiedByName ? ` av ${requirement.verifiedByName}` : ''}`
                            : requirement.status === 'waived'
                              ? 'Undantag beslutat'
                              : requirement.status === 'not_required'
                                ? 'Ej tillämplig'
                                : 'Återstår'}
                        </p>
                      </div>
                      {canActAsIssuer ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            onAction('verify_requirement', {
                              taskId: task.id,
                              requirementId: requirement.id,
                              status: done ? 'pending' : 'verified',
                              version: task.version,
                            })
                          }
                          className="min-h-10 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          {done ? 'Återställ' : 'Verifiera'}
                        </button>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </section>
          ) : null}

          <section className="mt-6 rounded-2xl border border-violet-200 bg-violet-50/70 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-violet-950">
                  <SigneCheckIcon size={19} /> Signe · förslag på nästa steg
                </h3>
                <p className="mt-1 text-xs leading-5 text-violet-800">
                  Signe kan föreslå högst tre underuppgifter. Förslagen skapar inget och skickar inget förrän du själv väljer hur du vill gå vidare.
                </p>
              </div>
              {canRequestSigneSuggestions ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onAction('request_signe_suggestions', { taskId: task.id })}
                  className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-violet-700 px-4 text-sm font-semibold text-white hover:bg-violet-800 disabled:opacity-50"
                >
                  <SigneCheckIcon size={18} /> Be Signe föreslå nästa steg
                </button>
              ) : null}
            </div>

            {task.aiSuggestions.length > 0 ? (
              <div className="mt-4 space-y-3">
                {task.aiSuggestions.map((suggestion) => {
                  const rejecting = rejectingSuggestionId === suggestion.id
                  return (
                    <article key={suggestion.id} className="rounded-2xl border border-violet-200 bg-white p-4 shadow-sm">
                      <div className="flex items-start gap-3">
                        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
                          <SigneCheckIcon size={19} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-600">
                            Väntande AI-förslag · ingen uppgift skapad
                          </p>
                          <h4 className="mt-1 text-sm font-semibold text-slate-950">{suggestion.title}</h4>
                          {suggestion.description ? (
                            <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                              {suggestion.description}
                            </p>
                          ) : null}
                          {suggestion.rationale ? (
                            <p className="mt-2 rounded-xl bg-violet-50 px-3 py-2 text-xs leading-5 text-violet-900">
                              Varför Signe föreslår detta: {suggestion.rationale}
                            </p>
                          ) : null}
                        </div>
                      </div>

                      {canActAsIssuer ? (
                        rejecting ? (
                          <div className="mt-3 border-t border-violet-100 pt-3">
                            <label className="block text-xs font-semibold text-slate-700">
                              Varför ska förslaget avvisas?
                              <textarea
                                value={suggestionRejectReason}
                                onChange={(event) => {
                                  setSuggestionRejectReason(event.target.value)
                                  setSuggestionFormError(null)
                                }}
                                rows={2}
                                maxLength={1000}
                                className={`${smallInput} mt-1.5`}
                                placeholder="Exempel: detta ingår redan i ett befintligt underuppdrag."
                              />
                            </label>
                            {suggestionFormError ? (
                              <p className="mt-1.5 text-xs font-medium text-red-700">{suggestionFormError}</p>
                            ) : null}
                            <div className="mt-3 flex gap-2">
                              <button
                                type="button"
                                disabled={busy || suggestionRejectReason.trim().length < 3}
                                onClick={() => void rejectSuggestion(suggestion.id)}
                                className="min-h-10 rounded-xl bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                              >
                                Avvisa med anledning
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                  setRejectingSuggestionId(null)
                                  setSuggestionRejectReason('')
                                  setSuggestionFormError(null)
                                }}
                                className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700"
                              >
                                Avbryt
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="mt-3 flex flex-wrap gap-2 border-t border-violet-100 pt-3">
                            {canCreateChild ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => onCreateSubtask(task, suggestion)}
                                className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-violet-700 px-3 text-xs font-semibold text-white hover:bg-violet-800 disabled:opacity-50"
                              >
                                <Plus size={15} /> Skapa underuppgift manuellt
                              </button>
                            ) : null}
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                setRejectingSuggestionId(suggestion.id)
                                setSuggestionRejectReason('')
                                setSuggestionFormError(null)
                              }}
                              className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                            >
                              <XCircle size={15} /> Avvisa
                            </button>
                          </div>
                        )
                      ) : null}
                    </article>
                  )
                })}
              </div>
            ) : (
              <p className="mt-3 rounded-xl border border-dashed border-violet-200 bg-white/60 px-4 py-3 text-xs leading-5 text-violet-800">
                Inga väntande Signe-förslag för uppgiften.
              </p>
            )}
          </section>

          <section className="mt-6">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-950">Underuppgifter</h3>
              {canCreateChild ? (
                <button
                  type="button"
                  onClick={() => onCreateSubtask(task)}
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Plus size={15} /> Lägg till
                </button>
              ) : null}
            </div>
            {children.length > 0 ? (
              <div className="mt-2 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                {children.map((child) => (
                  <button
                    type="button"
                    key={child.id}
                    onClick={() => onSelectTask(child.id)}
                    className="flex min-h-14 w-full items-center gap-3 border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50 last:border-0"
                  >
                    <CornerDownRight className="shrink-0 text-slate-400" size={17} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900">{child.title}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{child.assignee.name} · {taskStatusLabel(child.status)}</p>
                    </div>
                    <TaskRiskDot risk={child.risk} />
                    <ChevronRight className="shrink-0 text-slate-400" size={18} />
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-2 rounded-2xl border border-dashed border-slate-200 bg-white/60 px-4 py-5 text-center text-sm text-slate-500">
                Inga underuppgifter.
              </p>
            )}
          </section>

          <section ref={evidenceSectionRef} className="mt-6 scroll-mt-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-950">Underlag och färdigbevis</h3>
              <span className="text-xs text-slate-500">{task.attachments.length} bilagor</span>
            </div>
            {evidenceChecklist.length > 0 ? (
              <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-amber-800">Färdigbevis som krävs</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  {evidenceChecklist.map(({ type, complete }) => (
                    <div key={type} className="flex min-h-10 items-center gap-2 rounded-xl bg-white px-3 text-xs font-semibold text-slate-800">
                      {complete ? (
                        <CheckCircle2 className="shrink-0 text-emerald-600" size={17} />
                      ) : (
                        <CircleDashed className="shrink-0 text-amber-500" size={17} />
                      )}
                      {type === 'photo' ? 'Foto' : type === 'document' ? 'Dokument' : 'Textredovisning'}
                      <span className="text-slate-500">{complete ? 'klart' : 'saknas'}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="mt-2">
              <TaskAttachmentDropZone
                accept={TASK_ATTACHMENT_ACCEPT}
                title={
                  isTaskIssuer
                    ? 'Dra och släpp underlag till mottagaren här'
                    : 'Dra och släpp foto eller dokument här'
                }
                activeTitle="Släpp för att ladda upp filerna"
                description={
                  isTaskIssuer
                    ? 'Filerna visas som underlag för mottagaren. Max 25 MB per fil.'
                    : 'Filer som motsvarar beviskravet registreras som färdigbevis. Max 25 MB per fil.'
                }
                disabled={busy || ['ready_for_review', 'approved', 'cancelled'].includes(task.status)}
                busy={dropUploadBusy}
                onFiles={uploadDroppedFiles}
              />
            </div>
            {canActAsIssuer ? (
              <label className="mt-2 inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 text-xs font-semibold text-amber-900 hover:bg-amber-100">
                <Paperclip size={17} /> Lägg till underlag som mottagaren ska se
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,application/pdf,.doc,.docx,.xls,.xlsx,text/plain"
                  disabled={busy}
                  onChange={(event) => void uploadFile(event, false)}
                  className="sr-only"
                />
              </label>
            ) : null}
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <label className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                <Camera size={17} /> Foto
                <input
                  ref={documentInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  disabled={busy}
                  onChange={(event) => void uploadFile(event)}
                  className="sr-only"
                />
              </label>
              <label className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                <Paperclip size={17} /> Dokument
                <input
                  type="file"
                  accept="application/pdf,.doc,.docx,.xls,.xlsx,text/plain"
                  disabled={busy}
                  onChange={(event) => void uploadFile(event)}
                  className="sr-only"
                />
              </label>
              <button
                type="button"
                disabled={busy}
                onClick={() => setEvidencePanelOpen((value) => !value)}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <FileText size={17} /> Text
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={recording ? stopRecording : startRecording}
                className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-xs font-semibold disabled:opacity-50 ${
                  recording ? 'bg-rose-600 text-white' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {recording ? <Square size={15} fill="currentColor" /> : <Mic size={17} />}
                {recording ? 'Stoppa' : 'Röst'}
              </button>
            </div>
            {mediaError ? <p className="mt-2 text-xs font-medium text-rose-700">{mediaError}</p> : null}
            {recording ? (
              <p className="mt-2 flex items-center gap-2 text-xs font-semibold text-rose-700">
                <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" /> Inspelning pågår…
              </p>
            ) : null}
            {evidencePanelOpen ? (
              <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3">
                <textarea
                  value={evidenceText}
                  onChange={(event) => setEvidenceText(event.target.value)}
                  rows={3}
                  placeholder="Beskriv vad som har utförts och hur det kontrollerats."
                  className={smallInput}
                />
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={busy || !evidenceText.trim()}
                    onClick={() => void submitTextEvidence()}
                    className="min-h-10 rounded-xl bg-slate-900 px-4 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    Spara som färdigbevis
                  </button>
                  <button type="button" onClick={() => setEvidencePanelOpen(false)} className="min-h-10 rounded-xl px-3 text-xs font-semibold text-slate-600">
                    Avbryt
                  </button>
                </div>
              </div>
            ) : null}

            {task.attachments.length > 0 ? (
              <div className="mt-3 space-y-2">
                {task.attachments.map((attachment) => (
                  <article key={attachment.id} className="rounded-2xl border border-slate-200 bg-white p-3.5">
                    <div className="flex items-start gap-3">
                      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                        {attachment.type === 'photo' ? <Camera size={17} /> : attachment.type === 'audio' ? <Mic size={17} /> : <FileText size={17} />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-900">
                          {attachment.title || attachment.fileName || (attachment.type === 'text' ? 'Textredovisning' : 'Bilaga')}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {formatTaskDateTime(attachment.createdAt, effectiveTimeZone, 'compact')} · {attachment.isCompletionEvidence ? 'Färdigbevis' : 'Underlag'}
                        </p>
                      </div>
                      {attachment.fileName ? (
                        <a
                          href={`/api/tasks/${task.id}/attachments/${attachment.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex min-h-10 items-center rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Öppna
                        </a>
                      ) : null}
                    </div>
                    {attachment.textContent ? <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{attachment.textContent}</p> : null}
                    {attachment.transcriptText ? (
                      <div className="mt-3 rounded-xl bg-slate-50 p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Transkribering</p>
                        <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">{attachment.transcriptText}</p>
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : (
              <p className="mt-3 rounded-2xl border border-dashed border-slate-200 bg-white/60 px-4 py-5 text-center text-sm text-slate-500">
                Inget underlag uppladdat ännu.
              </p>
            )}
          </section>

          <div className="mt-4">
            <TaskHistoryDisclosure events={task.events} />
          </div>

          {task.canDelete ? (
            <section className="mt-8 rounded-2xl border border-rose-200 bg-rose-50 p-4 sm:p-5" aria-labelledby="task-delete-heading">
              <div className="flex items-start gap-3">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-rose-700 ring-1 ring-rose-200">
                  <Trash2 size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 id="task-delete-heading" className="text-sm font-semibold text-rose-950">Radera uppdrag</h3>
                  <p className="mt-1 text-xs leading-5 text-rose-900">
                    {task.childCount > 0
                      ? 'Underuppgifterna måste raderas först. Därefter kan du radera detta uppdrag.'
                      : 'Uppdraget tas bort från arbetsvyerna. Historik och bilagor sparas för spårbarhet.'}
                  </p>
                </div>
              </div>
              <button
                ref={deleteTriggerButtonRef}
                type="button"
                disabled={deleteBusy || task.childCount > 0}
                onClick={() => {
                  setDeleteError(null)
                  setDeleteDialogOpen(true)
                }}
                title={task.childCount > 0 ? 'Radera underuppgifterna först.' : 'Radera uppdrag'}
                className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-rose-300 bg-white px-4 text-sm font-semibold text-rose-800 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 size={18} /> Radera uppdrag
              </button>
            </section>
          ) : null}
        </div>

        {!['approved', 'cancelled'].includes(task.status) ? (
          <footer className="absolute inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:px-6 lg:static lg:shrink-0">
            {panel !== 'none' ? (
              <div className="mb-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <label className="block text-xs font-semibold text-slate-700">
                  {panel === 'waiting'
                    ? 'Vad väntar uppgiften på?'
                    : panel === 'return'
                      ? 'Vad behöver rättas?'
                      : panel === 'cancel'
                        ? 'Varför ska uppgiften avslutas utan godkännande?'
                        : 'Varför behövs mer tid?'}
                  <textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={2} className={`${smallInput} mt-1.5`} />
                </label>
                {panel === 'waiting' || panel === 'extension' ? (
                  <fieldset className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
                    <legend className="px-1 text-xs font-semibold text-slate-700">
                      {panel === 'waiting' ? 'När ska Signe följa upp internt?' : 'Önskad ny sluttid'}
                    </legend>
                    <div className="mt-1 grid gap-2 min-[420px]:grid-cols-[minmax(0,1fr)_8.5rem]">
                      <label className="block text-xs font-semibold text-slate-600">
                        Datum
                        <input
                          required
                          type="date"
                          min={panel === 'extension' ? extensionMinDate : todayInput}
                          max={panel === 'waiting' ? dueInput?.date : undefined}
                          value={date}
                          onChange={(event) => {
                            setDate(event.target.value)
                            setDateTimeError(null)
                          }}
                          className={`${smallInput} mt-1.5`}
                        />
                      </label>
                      <label className="block text-xs font-semibold text-slate-600">
                        Klockslag
                        <input
                          required
                          type="time"
                          step={60}
                          min={panel === 'extension' ? extensionMinTime : undefined}
                          max={panel === 'waiting' ? waitingMaxTime : undefined}
                          value={time}
                          onChange={(event) => {
                            setTime(event.target.value)
                            setDateTimeError(null)
                          }}
                          className={`${smallInput} mt-1.5`}
                        />
                      </label>
                    </div>
                    <p className="mt-2 text-[11px] font-medium text-slate-500">{taskTimeZoneLabel(effectiveTimeZone)}</p>
                  </fieldset>
                ) : null}
                {dateTimeError ? <p role="alert" className="mt-2 text-xs font-medium text-rose-700">{dateTimeError}</p> : null}
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    disabled={busy || !message.trim() || ((panel === 'waiting' || panel === 'extension') && (!date || !time))}
                    onClick={() => {
                      if (panel === 'waiting' || panel === 'extension') void submitTimedPanel()
                      if (panel === 'return') void transition('returned', { message: message.trim() })
                      if (panel === 'cancel') void transition('cancelled', { message: message.trim() })
                    }}
                    className="min-h-10 flex-1 rounded-xl bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    Bekräfta
                  </button>
                  <button type="button" onClick={() => setPanel('none')} className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700">
                    Avbryt
                  </button>
                </div>
              </div>
            ) : null}

            {canActAsAssignee && prestartBlocked && ['assigned', 'waiting', 'returned'].includes(task.status) ? (
              <p className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-900">
                Arbetet kan startas när uppdragsansvarig har kontrollerat offert, beställargodkännande eller garantiunderlag.
              </p>
            ) : null}

            <div className="flex gap-2 overflow-x-auto">
              {canActAsAssignee && ['assigned', 'waiting', 'returned'].includes(task.status) ? (
                <button
                  type="button"
                  disabled={busy || prestartBlocked}
                  onClick={() => transition('in_progress')}
                  className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-indigo-700 px-4 text-sm font-semibold text-white hover:bg-indigo-800 disabled:opacity-50"
                >
                  <ArrowRight size={17} /> {task.status === 'waiting' ? 'Återuppta' : 'Starta'}
                </button>
              ) : null}
              {canActAsAssignee && ['assigned', 'in_progress', 'waiting', 'returned'].includes(task.status) ? (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => transition('ready_for_review')}
                    className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                  >
                    <Check size={17} /> Klar för kontroll
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => openPanel('waiting')}
                    className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <Clock3 size={17} /> Väntar
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => openPanel('extension')}
                    className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <CalendarClock size={17} /> Begär mer tid
                  </button>
                </>
              ) : null}
              {canActAsIssuer && task.status === 'ready_for_review' ? (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => transition('approved')}
                    className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                  >
                    <CheckCircle2 size={17} /> Godkänn
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => openPanel('return')}
                    className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-orange-200 bg-orange-50 px-4 text-sm font-semibold text-orange-800 hover:bg-orange-100 disabled:opacity-50"
                  >
                    <RotateCcw size={17} /> Begär rättning
                  </button>
                </>
              ) : null}
              {canCreateChild ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onCreateSubtask(task)}
                  className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  <Plus size={17} /> Underuppgift
                </button>
              ) : null}
              {canActAsIssuer ? (
                <button
                  type="button"
                  disabled={busy || task.openChildCount > 0}
                  onClick={() => openPanel('cancel')}
                  title={task.openChildCount > 0 ? 'Avsluta eller godkänn underuppgifterna först.' : undefined}
                  className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 text-sm font-semibold text-rose-800 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <XCircle size={17} /> Avbryt uppdrag
                </button>
              ) : null}
            </div>
          </footer>
        ) : null}
      </section>

      {deleteDialogOpen ? (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center sm:justify-center sm:p-6">
          <button
            type="button"
            aria-label="Stäng bekräftelsen"
            disabled={deleteBusy}
            onClick={() => setDeleteDialogOpen(false)}
            className="absolute inset-0 cursor-default bg-slate-950/60 backdrop-blur-[2px] disabled:cursor-wait"
          />
          <section
            ref={deleteDialogRef}
            role="alertdialog"
            aria-modal="true"
            aria-busy={deleteBusy}
            aria-labelledby="task-delete-dialog-title"
            aria-describedby="task-delete-dialog-description"
            tabIndex={-1}
            className="relative w-full overflow-hidden rounded-t-3xl bg-white px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-5 shadow-2xl sm:max-w-md sm:rounded-3xl sm:p-6"
          >
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-rose-100 text-rose-700">
              <Trash2 size={21} />
            </span>
            <h2 id="task-delete-dialog-title" className="mt-4 text-xl font-semibold tracking-tight text-slate-950">
              Radera uppdraget?
            </h2>
            <p className="mt-2 break-words text-sm font-semibold text-slate-800">{task.title}</p>
            <p id="task-delete-dialog-description" className="mt-2 text-sm leading-6 text-slate-600">
              Uppdraget försvinner från arbetsvyerna. Signe slutar påminna och mottagaren förlorar åtkomsten. Historik och bilagor sparas för spårbarhet.
            </p>

            {deleteError ? (
              <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">
                {deleteError}
              </p>
            ) : null}

            <div className="mt-6 grid gap-2 sm:grid-cols-2">
              <button
                ref={deleteCancelButtonRef}
                type="button"
                disabled={deleteBusy}
                onClick={() => setDeleteDialogOpen(false)}
                className="inline-flex min-h-12 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Behåll uppdraget
              </button>
              <button
                type="button"
                disabled={deleteBusy}
                onClick={() => void archiveTask()}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-rose-700 px-4 text-sm font-semibold text-white transition hover:bg-rose-800 disabled:cursor-wait disabled:opacity-60"
              >
                <Trash2 size={18} /> {deleteSubmitting ? 'Raderar…' : 'Radera uppdrag'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}
