'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import {
  AlertTriangle,
  CalendarClock,
  Camera,
  ChevronDown,
  FileText,
  Image as ImageIcon,
  Loader2,
  Mail,
  Paperclip,
  Plus,
  Repeat2,
  Sparkles,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react'
import type {
  TaskChannel,
  TaskAiSuggestionView,
  TaskCompletionEvidenceType,
  TaskKind,
  TaskPerson,
  TaskRecurrenceInterval,
  TaskView,
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
import {
  TASK_EMAIL_PDF_MAX_BYTES,
  TASK_EMAIL_PDF_MAX_MEGABYTES,
  TASK_EMAIL_PDF_MAX_SUBTASKS,
  type TaskEmailPdfAnalysis,
} from '@/lib/tasks/emailPdfAnalysisContracts'
import TaskAttachmentDropZone from './TaskAttachmentDropZone'

type EmailPdfSubtaskDraft = TaskEmailPdfAnalysis['subtasks'][number] & {
  id: string
  included: boolean
}

type CreationMode = 'manual' | 'email_pdf'

type MainTaskDraftSnapshot = {
  title: string
  description: string
  contextLabel: string
  taskKind: TaskKind
  evidenceRequirements: TaskCompletionEvidenceType[]
}

type CreatePayload = {
  parentTaskId: string | null
  parentVersion: number | null
  sourceAiSuggestionId: string | null
  title: string
  description: string
  contextLabel: string
  taskKind: TaskKind
  assigneeRef: string
  newContact: {
    name: string
    companyName: string
    email: string
    phone: string
  } | null
  dueAt: string
  nextFollowupAt: string
  primaryChannel: TaskChannel
  fallbackChannel: TaskChannel | ''
  recurrenceInterval: TaskRecurrenceInterval | ''
  evidenceRequirements: TaskCompletionEvidenceType[]
  attachments: File[]
  aiSubtasks: Array<{
    title: string
    description: string
  }>
}

type Props = {
  open: boolean
  parentTask: TaskView | null
  suggestion: TaskAiSuggestionView | null
  people: TaskPerson[]
  currentUserId: string
  timeZone?: string | null
  busy: boolean
  onClose: () => void
  onCreate: (payload: CreatePayload) => Promise<void>
}

const inputClass =
  'min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-amber-400 focus:ring-4 focus:ring-amber-100'

const MAX_INITIAL_ATTACHMENTS = 10
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
const MAX_INITIAL_ATTACHMENT_TOTAL_BYTES = 100 * 1024 * 1024
const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif'
const DOCUMENT_ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain'
const INITIAL_ATTACHMENT_ACCEPT = `${IMAGE_ACCEPT},${DOCUMENT_ACCEPT}`

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} kB`
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
}

function fileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`
}

function draftId() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function isPdfFile(file: File) {
  const type = file.type.toLowerCase()
  return /\.pdf$/i.test(file.name)
    && (!type || type === 'application/pdf' || type === 'application/octet-stream')
}

function supportedInitialAttachment(file: File) {
  const type = file.type.toLowerCase()
  if (['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(type)) return true
  if (
    [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain',
    ].includes(type)
  ) return true
  return /\.(jpe?g|png|webp|hei[cf]|pdf|docx?|xlsx?|txt)$/i.test(file.name)
}

export default function TaskComposerSheet({
  open,
  parentTask,
  suggestion,
  people,
  currentUserId,
  timeZone,
  busy,
  onClose,
  onCreate,
}: Props) {
  const effectiveTimeZone = normalizeTaskTimeZone(timeZone)
  const todayInput = taskTodayDateInput(effectiveTimeZone)
  const parentDueInCreationZone = parentTask
    ? taskIsoToDateTimeInput(parentTask.dueAt, effectiveTimeZone)
    : null
  const defaultAssignee = useMemo(() => {
    const current = people.find((person) => person.kind === 'profile' && person.id === currentUserId)
    const firstInternal = people.find((person) => person.kind === 'profile' && person.isActive)
    return current ?? firstInternal ?? people.find((person) => person.isActive) ?? null
  }, [currentUserId, people])
  const initialDueDate = parentDueInCreationZone?.date || addTaskDateInputDays(todayInput, 7)
  const initialDueTime = parentDueInCreationZone?.time || '16:00'
  const suggestedFollowupDate = addTaskDateInputDays(todayInput, 2)
  const initialFollowupDate = suggestedFollowupDate > initialDueDate ? initialDueDate : suggestedFollowupDate
  const initialFollowupTime = initialFollowupDate === initialDueDate && '09:00' > initialDueTime
    ? initialDueTime
    : '09:00'
  const [initialDraft] = useState(() => ({
    title: suggestion?.title ?? '',
    description: suggestion?.description ?? '',
    contextLabel: parentTask?.contextLabel ?? '',
    taskKind: (parentTask?.taskKind ?? 'simple') as TaskKind,
    assigneeRef: defaultAssignee
      ? `${defaultAssignee.kind}:${defaultAssignee.id}`
      : 'new_contact',
    dueDate: initialDueDate,
    dueTime: initialDueTime,
    followupDate: initialFollowupDate,
    followupTime: initialFollowupTime,
    primaryChannel: 'email' as TaskChannel,
    fallbackChannel: 'whatsapp' as TaskChannel | '',
    recurrenceInterval: '' as TaskRecurrenceInterval | '',
  }))
  const [title, setTitle] = useState(initialDraft.title)
  const [description, setDescription] = useState(initialDraft.description)
  const [contextLabel, setContextLabel] = useState(initialDraft.contextLabel)
  const [taskKind, setTaskKind] = useState<TaskKind>(initialDraft.taskKind)
  const [assigneeRef, setAssigneeRef] = useState(initialDraft.assigneeRef)
  const [contactName, setContactName] = useState('')
  const [contactCompany, setContactCompany] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [dueDate, setDueDate] = useState(initialDraft.dueDate)
  const [dueTime, setDueTime] = useState(initialDraft.dueTime)
  const [followupDate, setFollowupDate] = useState(initialDraft.followupDate)
  const [followupTime, setFollowupTime] = useState(initialDraft.followupTime)
  const [primaryChannel, setPrimaryChannel] = useState<TaskChannel>(initialDraft.primaryChannel)
  const [fallbackChannel, setFallbackChannel] = useState<TaskChannel | ''>(initialDraft.fallbackChannel)
  const [recurrenceInterval, setRecurrenceInterval] = useState<TaskRecurrenceInterval | ''>(initialDraft.recurrenceInterval)
  const [evidenceRequirements, setEvidenceRequirements] = useState<TaskCompletionEvidenceType[]>([])
  const [attachments, setAttachments] = useState<File[]>([])
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [dateTimeError, setDateTimeError] = useState<string | null>(null)
  const [creationMode, setCreationMode] = useState<CreationMode>('manual')
  const [emailPdf, setEmailPdf] = useState<File | null>(null)
  const [emailPdfInstruction, setEmailPdfInstruction] = useState('')
  const [emailPdfAnalysis, setEmailPdfAnalysis] = useState<TaskEmailPdfAnalysis | null>(null)
  const [emailPdfSubtasks, setEmailPdfSubtasks] = useState<EmailPdfSubtaskDraft[]>([])
  const [emailPdfError, setEmailPdfError] = useState<string | null>(null)
  const [analyzingEmailPdf, setAnalyzingEmailPdf] = useState(false)
  const [lastAnalyzedInstruction, setLastAnalyzedInstruction] = useState<string | null>(null)
  const [mainTaskDraftSnapshot, setMainTaskDraftSnapshot] = useState<MainTaskDraftSnapshot | null>(null)
  const emailPdfAnalysisController = useRef<AbortController | null>(null)

  const hasEmailImportDraft = Boolean(
    !parentTask
    && !suggestion
    && creationMode === 'email_pdf'
    && (emailPdf || emailPdfInstruction.trim() || emailPdfAnalysis)
  )
  const hasUnsavedTaskDraft = Boolean(
    title !== initialDraft.title
    || description !== initialDraft.description
    || contextLabel !== initialDraft.contextLabel
    || taskKind !== initialDraft.taskKind
    || assigneeRef !== initialDraft.assigneeRef
    || contactName
    || contactCompany
    || contactEmail
    || contactPhone
    || dueDate !== initialDraft.dueDate
    || dueTime !== initialDraft.dueTime
    || followupDate !== initialDraft.followupDate
    || followupTime !== initialDraft.followupTime
    || primaryChannel !== initialDraft.primaryChannel
    || fallbackChannel !== initialDraft.fallbackChannel
    || recurrenceInterval !== initialDraft.recurrenceInterval
    || evidenceRequirements.length > 0
    || attachments.length > 0
    || hasEmailImportDraft
  )

  const requestClose = useCallback(() => {
    if (busy) return
    if (
      hasUnsavedTaskDraft
      && !window.confirm('Stäng utan att skapa uppdraget? Alla ändringar och bilagor i utkastet försvinner.')
    ) return
    emailPdfAnalysisController.current?.abort()
    onClose()
  }, [busy, hasUnsavedTaskDraft, onClose])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) requestClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [busy, open, requestClose])

  if (!open) return null

  const maxDueDate = parentDueInCreationZone?.date
  const maxDueTime = maxDueDate && dueDate === maxDueDate ? parentDueInCreationZone?.time : undefined
  const maxFollowupTime = followupDate === dueDate ? dueTime : undefined
  const isNewContact = assigneeRef === 'new_contact'
  const selectedExternal = assigneeRef.startsWith('contact:')
    ? people.find((person) => person.kind === 'contact' && `contact:${person.id}` === assigneeRef) ?? null
    : null
  const externalEmail = isNewContact ? contactEmail.trim() : selectedExternal?.email?.trim() ?? ''
  const externalPhone = isNewContact
    ? contactPhone.trim()
    : selectedExternal?.whatsappNumber?.trim() || selectedExternal?.phone?.trim() || ''
  const hasExternalAssignee = isNewContact || Boolean(selectedExternal)
  const externalChannelsCovered =
    !hasExternalAssignee ||
    Boolean(externalEmail) &&
      ((primaryChannel !== 'email' && fallbackChannel !== 'email') || Boolean(externalEmail)) &&
      ((primaryChannel !== 'whatsapp' && fallbackChannel !== 'whatsapp') || Boolean(externalPhone))
  const canUseEmailPdf = !parentTask && !suggestion
  const includedEmailPdfSubtasks = emailPdfSubtasks.filter(
    (subtask) => subtask.included && subtask.title.trim()
  )
  const initialAttachmentCount = attachments.length
    + (creationMode === 'email_pdf' && emailPdf ? 1 : 0)
  const interactionBusy = busy || analyzingEmailPdf
  const emailPdfInstructionIsCurrent =
    Boolean(emailPdfAnalysis)
    && lastAnalyzedInstruction === emailPdfInstruction.trim()
  const emailPdfReviewReady =
    creationMode !== 'email_pdf'
    || Boolean(emailPdf && emailPdfAnalysis && emailPdfInstructionIsCurrent)
  const hasIncompleteIncludedSubtask = emailPdfSubtasks.some(
    (subtask) => subtask.included && !subtask.title.trim()
  )

  const addAttachmentFiles = (selected: File[]) => {
    if (selected.length === 0) return

    const unsupported = selected.filter((file) => !supportedInitialAttachment(file))
    const empty = selected.filter((file) => file.size <= 0)
    const tooLarge = selected.filter((file) => file.size > MAX_ATTACHMENT_BYTES)
    const valid = selected.filter(
      (file) => supportedInitialAttachment(file) && file.size > 0 && file.size <= MAX_ATTACHMENT_BYTES
    )
    const existing = new Set([
      ...attachments,
      ...(creationMode === 'email_pdf' && emailPdf ? [emailPdf] : []),
    ].map(fileKey))
    const unique = valid.filter((file) => !existing.has(fileKey(file)))
    const reservedEmailPdf = creationMode === 'email_pdf' && emailPdf ? 1 : 0
    const available = Math.max(0, MAX_INITIAL_ATTACHMENTS - attachments.length - reservedEmailPdf)
    let totalBytes = attachments.reduce((sum, file) => sum + file.size, 0)
      + (reservedEmailPdf ? emailPdf?.size ?? 0 : 0)
    const accepted: File[] = []
    for (const file of unique.slice(0, available)) {
      if (totalBytes + file.size > MAX_INITIAL_ATTACHMENT_TOTAL_BYTES) continue
      accepted.push(file)
      totalBytes += file.size
    }
    setAttachments((current) => [...current, ...accepted])

    if (unsupported.length > 0) {
      setAttachmentError('Någon fil hade ett format som inte stöds.')
    } else if (empty.length > 0) {
      setAttachmentError('En tom fil kan inte laddas upp.')
    } else if (tooLarge.length > 0) {
      setAttachmentError('En fil får vara högst 25 MB.')
    } else if (unique.length > available) {
      setAttachmentError(`Du kan lägga till högst ${MAX_INITIAL_ATTACHMENTS} filer.`)
    } else if (accepted.length < unique.length) {
      setAttachmentError('Bilagorna får tillsammans vara högst 100 MB.')
    } else {
      setAttachmentError(null)
    }
  }

  const addAttachments = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? [])
    event.target.value = ''
    addAttachmentFiles(selected)
  }

  const clearEmailPdfAnalysis = (restoreMainTask: boolean) => {
    if (restoreMainTask && mainTaskDraftSnapshot) {
      setTitle(mainTaskDraftSnapshot.title)
      setDescription(mainTaskDraftSnapshot.description)
      setContextLabel(mainTaskDraftSnapshot.contextLabel)
      setTaskKind(mainTaskDraftSnapshot.taskKind)
      setEvidenceRequirements(mainTaskDraftSnapshot.evidenceRequirements)
    }
    setEmailPdfAnalysis(null)
    setEmailPdfSubtasks([])
    setLastAnalyzedInstruction(null)
    setMainTaskDraftSnapshot(null)
  }

  const switchToManualCreation = () => {
    if (
      hasEmailImportDraft
      && !window.confirm('Byt till manuellt läge och kasta PDF-underlaget och AI-förslaget?')
    ) return
    clearEmailPdfAnalysis(true)
    setEmailPdf(null)
    setEmailPdfInstruction('')
    setEmailPdfError(null)
    setCreationMode('manual')
  }

  const chooseEmailPdf = (selected: File[]) => {
    const file = selected[0]
    if (!file) return
    if (selected.length > 1) {
      setEmailPdfError('Välj en PDF åt gången för analys.')
      return
    }
    if (!isPdfFile(file)) {
      setEmailPdfError('Mejlet måste vara utskrivet som en PDF-fil.')
      return
    }
    if (file.size <= 0) {
      setEmailPdfError('PDF-filen är tom.')
      return
    }
    if (file.size > TASK_EMAIL_PDF_MAX_BYTES) {
      setEmailPdfError(
        `PDF-filen får vara högst ${TASK_EMAIL_PDF_MAX_MEGABYTES} MB för AI-analys.`
      )
      return
    }
    const selectedFileKey = fileKey(file)
    const remainingAttachments = attachments.filter(
      (attachment) => fileKey(attachment) !== selectedFileKey
    )
    if (remainingAttachments.length >= MAX_INITIAL_ATTACHMENTS) {
      setEmailPdfError(`Du kan lägga till högst ${MAX_INITIAL_ATTACHMENTS} filer totalt.`)
      return
    }
    const attachmentBytes = remainingAttachments.reduce(
      (sum, attachment) => sum + attachment.size,
      0
    )
    if (attachmentBytes + file.size > MAX_INITIAL_ATTACHMENT_TOTAL_BYTES) {
      setEmailPdfError('PDF-filen och övriga bilagor får tillsammans vara högst 100 MB.')
      return
    }
    if (
      emailPdfAnalysis
      && !window.confirm('Byt PDF och kasta det nuvarande AI-förslaget och dina ändringar i det?')
    ) return
    clearEmailPdfAnalysis(Boolean(emailPdfAnalysis))
    setAttachments(remainingAttachments)
    setEmailPdf(file)
    setEmailPdfError(null)
  }

  const removeEmailPdf = () => {
    if (
      emailPdfAnalysis
      && !window.confirm('Ta bort PDF-filen och kasta det nuvarande AI-förslaget?')
    ) return
    clearEmailPdfAnalysis(Boolean(emailPdfAnalysis))
    setEmailPdf(null)
    setEmailPdfError(null)
  }

  const analyzeEmailPdf = async () => {
    const instruction = emailPdfInstruction.trim()
    if (!emailPdf) {
      setEmailPdfError('Lägg till mejlet som PDF först.')
      return
    }
    if (!instruction) {
      setEmailPdfError('Beskriv kort vad Gizmo ska reda ut.')
      return
    }
    if (instruction.length < 5) {
      setEmailPdfError('Beskriv med några ord vad Gizmo ska reda ut.')
      return
    }
    if (
      emailPdfAnalysis
      && !window.confirm('Analysera igen och ersätt AI-förslaget och dina ändringar i det?')
    ) return

    emailPdfAnalysisController.current?.abort()
    const controller = new AbortController()
    emailPdfAnalysisController.current = controller
    if (emailPdfAnalysis) setLastAnalyzedInstruction(null)
    setAnalyzingEmailPdf(true)
    setEmailPdfError(null)
    try {
      const form = new FormData()
      form.append('file', emailPdf)
      form.append('instruction', instruction)
      const response = await fetch('/api/tasks/analyze-pdf', {
        method: 'POST',
        body: form,
        signal: controller.signal,
      })
      const body = (await response.json().catch(() => ({}))) as {
        analysis?: TaskEmailPdfAnalysis
        error?: string
      }
      if (!response.ok || !body.analysis) {
        throw new Error(body.error || 'Gizmo kunde inte analysera PDF-filen.')
      }

      const analysis = body.analysis
      if (!mainTaskDraftSnapshot) {
        setMainTaskDraftSnapshot({
          title,
          description,
          contextLabel,
          taskKind,
          evidenceRequirements,
        })
      }
      setEmailPdfAnalysis(analysis)
      setLastAnalyzedInstruction(instruction)
      setTitle(analysis.mainTask.title)
      setDescription(analysis.mainTask.description)
      setContextLabel(analysis.mainTask.contextLabel)
      setTaskKind(analysis.mainTask.taskKind)
      setEvidenceRequirements(analysis.mainTask.evidenceRequirements)
      setEmailPdfSubtasks(
        analysis.subtasks.map((subtask) => ({
          ...subtask,
          id: draftId(),
          included: true,
        }))
      )
    } catch (error) {
      if (controller.signal.aborted) return
      setEmailPdfError(
        error instanceof Error ? error.message : 'Gizmo kunde inte analysera PDF-filen.'
      )
    } finally {
      if (emailPdfAnalysisController.current === controller) {
        emailPdfAnalysisController.current = null
      }
      setAnalyzingEmailPdf(false)
    }
  }

  const addEmailPdfSubtask = () => {
    if (emailPdfSubtasks.length >= TASK_EMAIL_PDF_MAX_SUBTASKS) return
    setEmailPdfSubtasks((current) => [
      ...current,
      {
        id: draftId(),
        included: true,
        title: '',
        description: '',
        rationale: 'Tillagd manuellt i granskningen.',
        sourcePages: [],
      },
    ])
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const submittedAt = event.timeStamp > 1_000_000_000_000
      ? event.timeStamp
      : window.performance.timeOrigin + event.timeStamp
    if (
      analyzingEmailPdf ||
      !emailPdfReviewReady ||
      hasIncompleteIncludedSubtask ||
      !title.trim() ||
      !assigneeRef ||
      !dueDate ||
      !dueTime ||
      !followupDate ||
      !followupTime
    ) return
    const submissionAttachments =
      creationMode === 'email_pdf' && emailPdf
        ? [emailPdf, ...attachments.filter((file) => fileKey(file) !== fileKey(emailPdf))]
        : attachments
    if (submissionAttachments.length > MAX_INITIAL_ATTACHMENTS) {
      setAttachmentError(`Du kan lägga till högst ${MAX_INITIAL_ATTACHMENTS} filer totalt.`)
      return
    }
    if (
      submissionAttachments.reduce((sum, file) => sum + file.size, 0)
      > MAX_INITIAL_ATTACHMENT_TOTAL_BYTES
    ) {
      setAttachmentError('Bilagorna får tillsammans vara högst 100 MB.')
      return
    }
    setAttachmentError(null)
    const dueAt = taskDateTimeInputToIso(dueDate, dueTime, effectiveTimeZone)
    const nextFollowupAt = taskDateTimeInputToIso(followupDate, followupTime, effectiveTimeZone)
    if (!dueAt || !nextFollowupAt) {
      setDateTimeError('Kontrollera datum och klockslag. Den valda tiden måste finnas i angiven tidszon.')
      return
    }
    if (Date.parse(dueAt) <= submittedAt) {
      setDateTimeError('Sluttiden måste ligga framåt i tiden.')
      return
    }
    if (Date.parse(nextFollowupAt) < submittedAt) {
      setDateTimeError('Nästa uppföljning måste ligga framåt i tiden.')
      return
    }
    if (Date.parse(nextFollowupAt) > Date.parse(dueAt)) {
      setDateTimeError('Nästa uppföljning måste ske senast när uppdraget ska vara klart.')
      return
    }
    if (parentTask && Date.parse(dueAt) > Date.parse(parentTask.dueAt)) {
      setDateTimeError('Underuppgiften måste vara klar senast vid huvuduppgiftens sluttid.')
      return
    }
    setDateTimeError(null)
    await onCreate({
      parentTaskId: parentTask?.id ?? null,
      parentVersion: parentTask?.version ?? null,
      sourceAiSuggestionId: suggestion?.id ?? null,
      title: title.trim(),
      description: description.trim(),
      contextLabel: contextLabel.trim(),
      taskKind,
      assigneeRef,
      newContact: isNewContact
        ? {
            name: contactName.trim(),
            companyName: contactCompany.trim(),
            email: contactEmail.trim(),
            phone: contactPhone.trim(),
          }
        : null,
      dueAt,
      nextFollowupAt,
      primaryChannel,
      fallbackChannel,
      recurrenceInterval,
      evidenceRequirements,
      attachments: submissionAttachments,
      aiSubtasks:
        creationMode === 'email_pdf'
          ? includedEmailPdfSubtasks.map((subtask) => ({
              title: subtask.title.trim(),
              description: subtask.description.trim(),
            }))
          : [],
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-slate-950/45 backdrop-blur-[2px] sm:items-center sm:justify-center sm:p-6">
      <button
        className="absolute inset-0 cursor-default"
        aria-label="Stäng"
        tabIndex={-1}
        onClick={busy ? undefined : requestClose}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-composer-title"
        className="relative max-h-[94dvh] w-full overflow-hidden rounded-t-3xl bg-slate-50 shadow-2xl sm:max-w-2xl sm:rounded-3xl"
      >
        <header className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur sm:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">
              {parentTask ? 'Underuppgift' : 'Nytt uppdrag'}
            </p>
            <h2 id="task-composer-title" className="mt-1 text-xl font-semibold text-slate-950">
              {parentTask ? `Under ${parentTask.title}` : 'Vad ska bli gjort?'}
            </h2>
          </div>
          <button
            type="button"
            onClick={requestClose}
            disabled={busy}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 disabled:opacity-50"
            aria-label="Stäng"
          >
            <X size={22} />
          </button>
        </header>

        <form onSubmit={submit} className="max-h-[calc(94dvh-77px)] overflow-y-auto px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-5 sm:px-6">
          <fieldset disabled={interactionBusy} className="contents">
            <div className="space-y-5">
            {suggestion ? (
              <div className="rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm leading-6 text-violet-950">
                <p className="font-semibold">Utgår från ett Gizmo-förslag</p>
                <p className="mt-0.5 text-xs leading-5 text-violet-800">
                  Du kan ändra alla fält. Förslaget markeras som använt först när underuppgiften har skapats.
                </p>
              </div>
            ) : null}
            {canUseEmailPdf ? (
              <>
                <div
                  className="grid grid-cols-2 rounded-2xl border border-slate-200 bg-white p-1"
                  role="group"
                  aria-label="Välj hur uppdraget ska skapas"
                >
                  <button
                    type="button"
                    autoFocus
                    aria-pressed={creationMode === 'manual'}
                    onClick={switchToManualCreation}
                    disabled={interactionBusy}
                    className={`min-h-11 rounded-xl px-3 text-sm font-semibold transition ${
                      creationMode === 'manual'
                        ? 'bg-slate-950 text-white shadow-sm'
                        : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Skapa manuellt
                  </button>
                  <button
                    type="button"
                    aria-pressed={creationMode === 'email_pdf'}
                    onClick={() => setCreationMode('email_pdf')}
                    disabled={interactionBusy}
                    className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition ${
                      creationMode === 'email_pdf'
                        ? 'bg-violet-700 text-white shadow-sm'
                        : 'text-violet-800 hover:bg-violet-50'
                    }`}
                  >
                    <Sparkles size={17} aria-hidden="true" /> Tolka mejl-PDF
                  </button>
                </div>

                {creationMode === 'email_pdf' ? (
                  <section
                    className="rounded-2xl border border-violet-200 bg-violet-50/70 p-4"
                    aria-labelledby="email-pdf-analysis-title"
                  >
                    <div className="flex items-start gap-3">
                      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
                        <Mail size={20} aria-hidden="true" />
                      </span>
                      <div>
                        <h3 id="email-pdf-analysis-title" className="font-semibold text-violet-950">
                          Skapa utkast från ett mejl
                        </h3>
                        <p className="mt-1 text-xs leading-5 text-violet-800">
                          Dra in mejlet utskrivet som PDF och beskriv vad Gizmo ska reda ut. Inget skapas eller skickas innan du granskar formuläret.
                        </p>
                      </div>
                    </div>

                    <div className="mt-4">
                      {emailPdf ? (
                        <div className="flex min-w-0 items-center gap-3 rounded-xl border border-violet-200 bg-white px-3 py-2.5">
                          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
                            <FileText size={18} aria-hidden="true" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-slate-900">{emailPdf.name}</p>
                            <p className="mt-0.5 text-xs text-slate-500">{formatFileSize(emailPdf.size)}</p>
                          </div>
                          <label className="inline-flex min-h-10 cursor-pointer items-center rounded-lg px-3 text-xs font-semibold text-violet-700 hover:bg-violet-50">
                            Byt PDF
                            <input
                              type="file"
                              accept=".pdf,application/pdf"
                              className="sr-only"
                              disabled={interactionBusy}
                              onChange={(event) => {
                                chooseEmailPdf(Array.from(event.currentTarget.files ?? []))
                                event.currentTarget.value = ''
                              }}
                            />
                          </label>
                          <button
                            type="button"
                            onClick={removeEmailPdf}
                            disabled={interactionBusy}
                            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
                            aria-label={`Ta bort ${emailPdf.name}`}
                          >
                            <Trash2 size={17} />
                          </button>
                        </div>
                      ) : (
                        <TaskAttachmentDropZone
                          accept=".pdf,application/pdf"
                          title="Dra in mejlet som PDF"
                          activeTitle="Släpp PDF-filen för att lägga till den"
                          description={`Du kan även klicka och välja en PDF. Max ${TASK_EMAIL_PDF_MAX_MEGABYTES} MB.`}
                          disabled={interactionBusy}
                          multiple={false}
                          icon={<Mail className="text-violet-700" size={24} aria-hidden="true" />}
                          onFiles={chooseEmailPdf}
                        />
                      )}
                    </div>

                    <label className="mt-4 block">
                      <span className="mb-1.5 block text-sm font-semibold text-violet-950">
                        Vad vill du att Gizmo ska göra?
                      </span>
                      <textarea
                        value={emailPdfInstruction}
                        onChange={(event) => {
                          setEmailPdfInstruction(event.target.value)
                          setEmailPdfError(null)
                        }}
                        rows={3}
                        maxLength={1200}
                        disabled={interactionBusy}
                        placeholder="Exempel: Identifiera vad som behöver göras och dela upp arbetet i tydliga underuppgifter."
                        className={inputClass}
                      />
                      <span className="mt-1 block text-right text-[11px] text-violet-700">
                        {emailPdfInstruction.length}/1200
                      </span>
                    </label>

                    {emailPdfError ? (
                      <p role="alert" className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">
                        {emailPdfError}
                      </p>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => void analyzeEmailPdf()}
                      disabled={interactionBusy || !emailPdf || emailPdfInstruction.trim().length < 5}
                      className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-violet-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {analyzingEmailPdf ? (
                        <Loader2 className="animate-spin" size={18} aria-hidden="true" />
                      ) : (
                        <Sparkles size={18} aria-hidden="true" />
                      )}
                      {analyzingEmailPdf
                        ? 'Gizmo läser och tar fram ett förslag…'
                        : emailPdfAnalysis
                          ? 'Analysera igen'
                          : 'Analysera underlaget'}
                    </button>

                    <p className="sr-only" aria-live="polite" role="status">
                      {analyzingEmailPdf
                        ? 'Gizmo läser PDF-filen och tar fram ett förslag.'
                        : emailPdfAnalysis
                          ? 'Gizmos förslag är klart för granskning.'
                          : ''}
                    </p>
                    {emailPdfAnalysis && !emailPdfInstructionIsCurrent ? (
                      <p role="alert" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
                        Det visade förslaget är inte den senaste analysen. Analysera igen innan uppdraget kan skapas.
                      </p>
                    ) : null}
                    {emailPdfAnalysis ? (
                        <div className="mt-4 space-y-3 border-t border-violet-200 pt-4">
                          <div className="rounded-xl bg-white px-3.5 py-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">Gizmos sammanfattning</p>
                            <p className="mt-1 text-sm leading-6 text-slate-700">{emailPdfAnalysis.summary}</p>
                            {emailPdfAnalysis.mainTask.sourcePages.length > 0 ? (
                              <p className="mt-1 text-xs text-slate-500">
                                AI-förslagets källa: sida {emailPdfAnalysis.mainTask.sourcePages.join(', ')}
                              </p>
                            ) : null}
                          </div>

                          {[...emailPdfAnalysis.missingInformation, ...emailPdfAnalysis.warnings].length > 0 ? (
                            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3">
                              <p className="flex items-center gap-2 text-sm font-semibold text-amber-950">
                                <AlertTriangle size={16} aria-hidden="true" /> Kontrollera innan du skapar
                              </p>
                              <ul className="mt-2 space-y-1 text-xs leading-5 text-amber-900">
                                {[...emailPdfAnalysis.missingInformation, ...emailPdfAnalysis.warnings].map((item, index) => (
                                  <li key={`${index}:${item}`}>• {item}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}

                          <fieldset className="rounded-xl border border-violet-200 bg-white p-3.5">
                            <legend className="px-1 text-sm font-semibold text-slate-900">
                              Föreslagna underuppgifter ({includedEmailPdfSubtasks.length})
                            </legend>
                            <p className="mt-1 text-xs leading-5 text-slate-500">
                              De valda underuppgifterna ärver mottagare, projekt och sluttid från huvuduppdraget. Du kan ändra dem efter skapandet.
                            </p>
                            <div className="mt-3 space-y-3">
                              {emailPdfSubtasks.map((subtask, index) => (
                                <div
                                  key={subtask.id}
                                  className={`rounded-xl border p-3 transition ${
                                    subtask.included
                                      ? 'border-violet-200 bg-violet-50/50'
                                      : 'border-slate-200 bg-slate-50 opacity-70'
                                  }`}
                                >
                                  <div className="flex items-center gap-3">
                                    <label className="inline-flex min-h-10 flex-1 cursor-pointer items-center gap-2 text-sm font-semibold text-slate-800">
                                      <input
                                        type="checkbox"
                                        checked={subtask.included}
                                        onChange={(event) => {
                                          const included = event.target.checked
                                          setEmailPdfSubtasks((current) => current.map((item) =>
                                            item.id === subtask.id ? { ...item, included } : item
                                          ))
                                        }}
                                        className="h-5 w-5 rounded border-slate-300 accent-violet-700"
                                      />
                                      Ta med underuppgift {index + 1}
                                    </label>
                                    <button
                                      type="button"
                                      onClick={() => setEmailPdfSubtasks((current) => current.filter((item) => item.id !== subtask.id))}
                                      className="inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-500 hover:bg-rose-50 hover:text-rose-700"
                                      aria-label={`Ta bort underuppgift ${index + 1}`}
                                    >
                                      <Trash2 size={16} />
                                    </button>
                                  </div>
                                  <label className="mt-2 block">
                                    <span className="sr-only">Titel för underuppgift {index + 1}</span>
                                    <input
                                      value={subtask.title}
                                      maxLength={180}
                                      disabled={!subtask.included}
                                      onChange={(event) => {
                                        const title = event.target.value
                                        setEmailPdfSubtasks((current) => current.map((item) =>
                                          item.id === subtask.id
                                            ? { ...item, title, rationale: '', sourcePages: [] }
                                            : item
                                        ))
                                      }}
                                      className={inputClass}
                                      placeholder="Vad ska bli gjort?"
                                    />
                                  </label>
                                  <label className="mt-2 block">
                                    <span className="sr-only">Beskrivning för underuppgift {index + 1}</span>
                                    <textarea
                                      value={subtask.description}
                                      rows={2}
                                      maxLength={1200}
                                      disabled={!subtask.included}
                                      onChange={(event) => {
                                        const description = event.target.value
                                        setEmailPdfSubtasks((current) => current.map((item) =>
                                          item.id === subtask.id
                                            ? { ...item, description, rationale: '', sourcePages: [] }
                                            : item
                                        ))
                                      }}
                                      className={inputClass}
                                      placeholder="Beskriv önskat resultat."
                                    />
                                  </label>
                                  {subtask.rationale || subtask.sourcePages.length > 0 ? (
                                    <p className="mt-2 text-[11px] leading-5 text-slate-500">
                                      {subtask.rationale}
                                      {subtask.sourcePages.length > 0
                                        ? ` Källa: sida ${subtask.sourcePages.join(', ')}.`
                                        : ''}
                                    </p>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                            <button
                              type="button"
                              onClick={addEmailPdfSubtask}
                              disabled={emailPdfSubtasks.length >= TASK_EMAIL_PDF_MAX_SUBTASKS}
                              className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg border border-violet-200 px-3 text-xs font-semibold text-violet-800 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <Plus size={15} aria-hidden="true" /> Lägg till underuppgift
                            </button>
                            {hasIncompleteIncludedSubtask ? (
                              <p role="alert" className="mt-2 text-xs font-medium text-rose-700">
                                Fyll i en titel eller välj bort den tomma underuppgiften.
                              </p>
                            ) : null}
                            <p className="mt-2 text-[11px] text-slate-500">Högst {TASK_EMAIL_PDF_MAX_SUBTASKS} underuppgifter i version 1.</p>
                          </fieldset>
                        </div>
                    ) : null}
                  </section>
                ) : null}
              </>
            ) : null}
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-slate-800">Uppgift</span>
              <input
                autoFocus={!canUseEmailPdf}
                required
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Exempel: Montera vattenutkastare vid tvättstugan"
                className={inputClass}
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-slate-800">Beskrivning</span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={4}
                placeholder="Beskriv önskat resultat och viktig bakgrund."
                className={inputClass}
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-slate-800">Arbetsflöde</span>
                <span className="relative block">
                  <select
                    value={taskKind}
                    onChange={(event) => setTaskKind(event.target.value as TaskKind)}
                    className={`${inputClass} appearance-none pr-10`}
                  >
                    <option value="simple">Enkel uppgift</option>
                    <option value="general">Inget speciellt</option>
                    <option value="paid_external">Betalt externt arbete</option>
                    <option value="warranty">Garantiåtgärd</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-3 text-slate-400" size={18} />
                </span>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-slate-800">Projekt/plats, frivilligt</span>
                <input
                  value={contextLabel}
                  onChange={(event) => setContextLabel(event.target.value)}
                  placeholder="Exempel: BRF Eken"
                  className={inputClass}
                />
              </label>
            </div>

            <fieldset className="rounded-2xl border border-slate-200 bg-white p-4">
              <legend className="px-1 text-sm font-semibold text-slate-800">Mottagare</legend>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Du blir uppdragsansvarig. Mottagaren är den person som ska agera på uppdraget. Interna personer visas när de har åtkomst till Uppdrag.
              </p>
              <label className="mt-3 block">
                <span className="sr-only">Mottagare</span>
                <select
                  required
                  value={assigneeRef}
                  onChange={(event) => setAssigneeRef(event.target.value)}
                  className={inputClass}
                >
                  <optgroup label="Interna personer">
                    {people
                      .filter((person) => person.kind === 'profile' && person.isActive)
                      .map((person) => (
                        <option key={`profile:${person.id}`} value={`profile:${person.id}`}>
                          {person.id === currentUserId ? `(Jag) ${person.name}` : person.name}
                        </option>
                      ))}
                  </optgroup>
                  <optgroup label="Externa kontakter">
                    {people
                      .filter((person) => person.kind === 'contact' && person.isActive)
                      .map((person) => (
                        <option key={`contact:${person.id}`} value={`contact:${person.id}`}>
                          {person.name}{person.companyName ? ` – ${person.companyName}` : ''}{person.email ? ` · ${person.email}` : ''}
                        </option>
                      ))}
                  </optgroup>
                  <option value="new_contact">+ Ny extern kontakt</option>
                </select>
              </label>

              {isNewContact ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-slate-600">Namn</span>
                    <input required value={contactName} onChange={(event) => setContactName(event.target.value)} className={inputClass} />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-slate-600">Företag</span>
                    <input value={contactCompany} onChange={(event) => setContactCompany(event.target.value)} className={inputClass} />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-slate-600">E-post för Mina uppdrag</span>
                    <input type="email" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} className={inputClass} />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-slate-600">Telefon / WhatsApp</span>
                    <input type="tel" value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} className={inputClass} />
                  </label>
                  <p className="sm:col-span-2 text-xs leading-5 text-slate-500">
                    Med en personlig e-postadress kan mottagaren aktivera sitt konto och samla alla uppdrag på en sida. Delade adresser ger alla som kan läsa inkorgen samma portalåtkomst.
                  </p>
                </div>
              ) : null}
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-2">
              <fieldset className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5">
                <legend className="flex items-center gap-2 px-1 text-sm font-semibold text-slate-800">
                  <CalendarClock size={16} /> Ska vara klart
                </legend>
                <div className="mt-1 grid gap-3 min-[420px]:grid-cols-[minmax(0,1fr)_9rem] sm:grid-cols-1">
                  <label className="block min-w-0">
                    <span className="mb-1 block text-xs font-semibold text-slate-600">Datum</span>
                    <input
                      required
                      type="date"
                      min={todayInput}
                      max={maxDueDate}
                      value={dueDate}
                      onChange={(event) => {
                        const nextDate = event.target.value
                        const nextTime = parentDueInCreationZone && nextDate === parentDueInCreationZone.date && dueTime > parentDueInCreationZone.time
                          ? parentDueInCreationZone.time
                          : dueTime
                        setDueDate(nextDate)
                        setDueTime(nextTime)
                        setDateTimeError(null)
                        if (
                          followupDate > nextDate
                          || (followupDate === nextDate && followupTime > nextTime)
                        ) {
                          setFollowupDate(nextDate)
                          setFollowupTime(nextTime)
                        }
                      }}
                      className={inputClass}
                    />
                  </label>
                  <label className="block min-w-0">
                    <span className="mb-1 block text-xs font-semibold text-slate-600">Klockslag</span>
                    <input
                      required
                      type="time"
                      step={60}
                      max={maxDueTime}
                      value={dueTime}
                      onChange={(event) => {
                        const nextTime = event.target.value
                        setDueTime(nextTime)
                        setDateTimeError(null)
                        if (followupDate === dueDate && followupTime > nextTime) setFollowupTime(nextTime)
                      }}
                      className={inputClass}
                    />
                  </label>
                </div>
              </fieldset>

              <fieldset className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5">
                <legend className="flex items-center gap-2 px-1 text-sm font-semibold text-slate-800">
                  <CalendarClock size={16} /> Gizmo följer upp
                </legend>
                <div className="mt-1 grid gap-3 min-[420px]:grid-cols-[minmax(0,1fr)_9rem] sm:grid-cols-1">
                  <label className="block min-w-0">
                    <span className="mb-1 block text-xs font-semibold text-slate-600">Datum</span>
                    <input
                      required
                      type="date"
                      min={todayInput}
                      max={dueDate || maxDueDate}
                      value={followupDate}
                      onChange={(event) => {
                        setFollowupDate(event.target.value)
                        setDateTimeError(null)
                      }}
                      className={inputClass}
                    />
                  </label>
                  <label className="block min-w-0">
                    <span className="mb-1 block text-xs font-semibold text-slate-600">Klockslag</span>
                    <input
                      required
                      type="time"
                      step={60}
                      max={maxFollowupTime}
                      value={followupTime}
                      onChange={(event) => {
                        setFollowupTime(event.target.value)
                        setDateTimeError(null)
                      }}
                      className={inputClass}
                    />
                  </label>
                </div>
              </fieldset>
            </div>
            <div className="text-xs leading-5 text-slate-500">
              <p>Alla nya tider anges i {taskTimeZoneLabel(effectiveTimeZone)}. Mottagaren ser sluttiden; Gizmos uppföljning är intern.</p>
              {parentTask ? (
                <p>
                  Huvuduppgiftens sluttid är {formatTaskDateTime(parentTask.dueAt, parentTask.dueTimeZone)} ({taskTimeZoneLabel(parentTask.dueTimeZone)}). Underuppgiften kan inte gå förbi samma tidpunkt.
                </p>
              ) : null}
            </div>
            {!parentTask ? (
              <fieldset className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5">
                <legend className="flex items-center gap-2 px-1 text-sm font-semibold text-slate-800">
                  <Repeat2 size={16} /> Återkommande uppgift
                </legend>
                <label className="mt-1 block">
                  <span className="mb-1 block text-xs font-semibold text-slate-600">Intervall</span>
                  <select
                    value={recurrenceInterval}
                    onChange={(event) => setRecurrenceInterval(event.target.value as TaskRecurrenceInterval | '')}
                    className={inputClass}
                  >
                    <option value="">Inte återkommande</option>
                    <option value="weekly">Varje vecka</option>
                    <option value="monthly">Varje månad</option>
                    <option value="quarterly">Varje kvartal</option>
                    <option value="yearly">Varje år</option>
                  </select>
                </label>
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  Nästa tillfälle skapas när uppgiften godkänns. Mottagare, beskrivning,
                  kontrollpunkter och färdigbevis kopieras. Bilagor och underuppgifter kopieras inte.
                </p>
              </fieldset>
            ) : null}
            {dateTimeError ? (
              <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">
                {dateTimeError}
              </p>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-slate-800">Huvudkanal</span>
                <select
                  value={primaryChannel}
                  onChange={(event) => {
                    const channel = event.target.value as TaskChannel
                    setPrimaryChannel(channel)
                    if (fallbackChannel === channel) setFallbackChannel('')
                  }}
                  className={inputClass}
                >
                  <option value="email">E-post</option>
                  <option value="whatsapp">WhatsApp</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-slate-800">Reservkanal</span>
                <select value={fallbackChannel} onChange={(event) => setFallbackChannel(event.target.value as TaskChannel | '')} className={inputClass}>
                  <option value="">Ingen</option>
                  {primaryChannel !== 'email' ? <option value="email">E-post</option> : null}
                  {primaryChannel !== 'whatsapp' ? <option value="whatsapp">WhatsApp</option> : null}
                </select>
              </label>
            </div>

            {!externalChannelsCovered ? (
              <p className="text-sm leading-5 text-rose-700">
                En extern mottagare måste ha e-post för Mina uppdrag och kontaktuppgift för valda kanaler.
              </p>
            ) : null}

            {hasExternalAssignee && externalEmail ? (
              <p className="text-xs leading-5 text-slate-500">
                Första kontoaktiveringen skickas alltid till mottagarens e-post. När kontot är aktiverat använder Gizmo vald huvud- och reservkanal.
              </p>
            ) : null}

            <fieldset className="rounded-2xl border border-slate-200 bg-white p-4">
              <legend className="px-1 text-sm font-semibold text-slate-800">Krav på färdigbevis</legend>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Markera allt som mottagaren måste lämna. Om inget markeras är färdigbevis frivilligt.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {([
                  ['photo', 'Foto'],
                  ['document', 'Dokument'],
                  ['text', 'Textredovisning'],
                ] as const).map(([value, label]) => {
                  const checked = evidenceRequirements.includes(value)
                  return (
                    <label
                      key={value}
                      className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5 text-sm font-semibold transition ${
                        checked
                          ? 'border-amber-400 bg-amber-50 text-amber-950 ring-2 ring-amber-100'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-amber-300'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setEvidenceRequirements((current) =>
                            current.includes(value)
                              ? current.filter((item) => item !== value)
                              : [...current, value]
                          )
                        }
                        className="h-5 w-5 rounded border-slate-300 accent-amber-600"
                      />
                      {label}
                    </label>
                  )
                })}
              </div>
            </fieldset>

            <fieldset className="rounded-2xl border border-slate-200 bg-white p-4">
              <legend className="px-1 text-sm font-semibold text-slate-800">Bilder och dokument</legend>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Lägg till ritningar, foton, offerter eller andra underlag. Mottagaren kan öppna dem direkt i uppdraget.
              </p>
              <div className="mt-3">
                <TaskAttachmentDropZone
                  accept={INITIAL_ATTACHMENT_ACCEPT}
                  title="Dra och släpp bilder eller dokument här"
                  activeTitle="Släpp för att lägga till underlagen"
                  description="Du kan även klicka här och välja flera filer. Max 10 filer, 25 MB per fil."
                  disabled={interactionBusy}
                  onFiles={addAttachmentFiles}
                />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <label className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700 transition hover:border-amber-300 hover:bg-amber-50">
                  <Camera size={17} /> Bild eller foto
                  <input
                    type="file"
                    accept={IMAGE_ACCEPT}
                    multiple
                    className="sr-only"
                    onChange={addAttachments}
                  />
                </label>
                <label className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700 transition hover:border-amber-300 hover:bg-amber-50">
                  <Paperclip size={17} /> Dokument
                  <input
                    type="file"
                    accept={DOCUMENT_ACCEPT}
                    multiple
                    className="sr-only"
                    onChange={addAttachments}
                  />
                </label>
              </div>

              {attachmentError ? <p className="mt-2 text-xs leading-5 text-rose-700">{attachmentError}</p> : null}

              {attachments.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {attachments.map((file) => {
                    const key = fileKey(file)
                    const isImage = file.type.startsWith('image/') || /\.(jpe?g|png|webp|hei[cf])$/i.test(file.name)
                    return (
                      <div key={key} className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
                          {isImage ? <ImageIcon size={18} /> : <FileText size={18} />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-slate-800">{file.name}</p>
                          <p className="mt-0.5 text-xs text-slate-500">{formatFileSize(file.size)}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setAttachments((current) => current.filter((item) => fileKey(item) !== key))
                            setAttachmentError(null)
                          }}
                          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-rose-50 hover:text-rose-700"
                          aria-label={`Ta bort ${file.name}`}
                        >
                          <Trash2 size={17} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              ) : null}
              {initialAttachmentCount > 0 ? (
                <p className="mt-2 text-right text-xs text-slate-500">
                  {initialAttachmentCount} av {MAX_INITIAL_ATTACHMENTS} filer
                </p>
              ) : null}
            </fieldset>
            </div>
          </fieldset>

          <div className="sticky bottom-0 -mx-5 mt-6 border-t border-slate-200 bg-white/95 px-5 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:-mx-6 sm:px-6">
            <button
              type="submit"
              disabled={
                interactionBusy ||
                !emailPdfReviewReady ||
                hasIncompleteIncludedSubtask ||
                !title.trim() ||
                !assigneeRef ||
                !externalChannelsCovered
              }
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white shadow-lg shadow-slate-900/15 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <UserPlus size={18} />
              {busy
                ? 'Skapar…'
                : parentTask
                  ? 'Skapa underuppgift'
                  : creationMode === 'email_pdf' && emailPdfAnalysis
                    ? `Skapa huvuduppdrag${includedEmailPdfSubtasks.length > 0 ? ` + ${includedEmailPdfSubtasks.length} underuppgifter` : ''}`
                    : 'Skapa och tilldela'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
