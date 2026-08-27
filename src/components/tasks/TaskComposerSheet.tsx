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
  TASK_EMAIL_PDF_ANALYSIS_MODES,
  TASK_EMAIL_PDF_DOCUMENT_TYPE_HINTS,
  TASK_EMAIL_PDF_MAX_BYTES,
  TASK_EMAIL_PDF_MAX_MEGABYTES,
  TASK_EMAIL_PDF_MAX_SUBTASKS,
  type TaskEmailPdfAnalysis,
  type TaskEmailPdfAnalysisMode,
  type TaskEmailPdfDocumentType,
  type TaskEmailPdfDocumentTypeHint,
  type TaskEmailPdfSourceItem,
  type TaskEmailPdfTaskBasis,
} from '@/lib/tasks/emailPdfAnalysisContracts'
import TaskAttachmentDropZone from './TaskAttachmentDropZone'

type EmailPdfSubtaskDraft = Omit<TaskEmailPdfAnalysis['subtasks'][number], 'basis'> & {
  id: string
  included: boolean
  basis: TaskEmailPdfTaskBasis | 'manual'
}

type CreationMode = 'manual' | 'email_pdf'

const DEFAULT_DOCUMENT_INSTRUCTION =
  'Skapa en enkel och källtrogen lista över de uppgifter som dokumentet uttryckligen begär eller tilldelar. Behåll samtliga uttryckliga underpunkter, ansvariga, datum och platser. Lägg inte till egna analyser, lösningar eller arbetsmoment.'

const DOCUMENT_TYPE_LABELS: Record<TaskEmailPdfDocumentType, string> = {
  email: 'E-post eller meddelande',
  meeting_minutes: 'Mötesprotokoll',
  inspection_report: 'Besiktningsprotokoll',
  other: 'Annat dokument',
}

const DOCUMENT_TYPE_HINT_LABELS: Record<TaskEmailPdfDocumentTypeHint, string> = {
  auto: 'Identifiera automatiskt',
  ...DOCUMENT_TYPE_LABELS,
}

const ANALYSIS_MODE_LABELS: Record<TaskEmailPdfAnalysisMode, string> = {
  explicit: 'Endast uttryckliga uppgifter',
  recommended: 'Även rekommenderade åtgärder',
  exploratory: 'Föreslå möjliga nästa steg',
}

const ANALYSIS_MODE_HELP: Record<TaskEmailPdfAnalysisMode, string> = {
  explicit: 'Standard. Gizmo tar bara med sådant som dokumentet uttryckligen säger ska göras.',
  recommended: 'Tar även med åtgärder som uttryckligen rekommenderas i dokumentet.',
  exploratory: 'Gizmo får dessutom föreslå nästa steg. AI-förslag väljs inte automatiskt.',
}

const TASK_BASIS_LABELS: Record<TaskEmailPdfTaskBasis | 'manual', string> = {
  explicit: 'Uttrycklig uppgift',
  recommendation: 'Rekommenderat i dokumentet',
  ai_suggestion: 'Gizmos förslag',
  manual: 'Tillagd manuellt',
}

const DOCUMENT_TYPE_CONFIDENCE_LABELS: Record<
  TaskEmailPdfAnalysis['documentTypeConfidence'],
  string
> = {
  high: 'hög säkerhet',
  medium: 'medelhög säkerhet',
  low: 'låg säkerhet',
}

function analysisRequestKey(
  instruction: string,
  documentType: TaskEmailPdfDocumentTypeHint,
  analysisMode: TaskEmailPdfAnalysisMode
) {
  return JSON.stringify([instruction.trim(), documentType, analysisMode])
}

function taskDescriptionWithChecklist(
  description: string,
  checklist: string[],
  responsibleParty: string,
  dueText: string
) {
  const details = checklist.map((item) => item.trim()).filter(Boolean)
  const sourceAssignment = [
    responsibleParty.trim() ? `Angiven ansvarig i källan: ${responsibleParty.trim()}` : '',
    dueText.trim() ? `Angiven tid i källan: ${dueText.trim()}` : '',
  ].filter(Boolean)
  return [
    description.trim(),
    details.length > 0 ? details.map((item) => `- ${item}`).join('\n') : '',
    sourceAssignment.join('\n'),
  ]
    .filter(Boolean)
    .join('\n\n')
}

function sourceLabel(pages: number[]) {
  if (pages.length === 0) return 'Källa i dokumentet, sida inte angiven'
  return `Källa: ${pages.length === 1 ? 'sida' : 'sidor'} ${pages.join(', ')}`
}

function SourceItemSection({
  title,
  description,
  items,
}: {
  title: string
  description: string
  items: TaskEmailPdfSourceItem[]
}) {
  if (items.length === 0) return null
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3.5">
      <h4 className="text-sm font-semibold text-slate-900">{title} ({items.length})</h4>
      <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
      <ul className="mt-3 space-y-3">
        {items.map((item, index) => (
          <li key={`${title}:${index}:${item.text}`} className="rounded-lg bg-slate-50 px-3 py-2.5">
            <p className="text-sm leading-5 text-slate-800">{item.text}</p>
            {item.sourceExcerpt ? (
              <blockquote className="mt-2 border-l-2 border-slate-300 pl-2 text-xs italic leading-5 text-slate-600">
                “{item.sourceExcerpt}”
              </blockquote>
            ) : null}
            <p className="mt-1 text-[11px] text-slate-500">{sourceLabel(item.sourcePages)}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}

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
  const [emailPdfInstruction, setEmailPdfInstruction] = useState(DEFAULT_DOCUMENT_INSTRUCTION)
  const [emailPdfDocumentType, setEmailPdfDocumentType] = useState<TaskEmailPdfDocumentTypeHint>('auto')
  const [emailPdfAnalysisMode, setEmailPdfAnalysisMode] = useState<TaskEmailPdfAnalysisMode>('explicit')
  const [attachSourceDocument, setAttachSourceDocument] = useState(false)
  const [confirmedSharedAssignment, setConfirmedSharedAssignment] = useState(false)
  const [emailPdfAnalysis, setEmailPdfAnalysis] = useState<TaskEmailPdfAnalysis | null>(null)
  const [emailPdfSubtasks, setEmailPdfSubtasks] = useState<EmailPdfSubtaskDraft[]>([])
  const [emailPdfError, setEmailPdfError] = useState<string | null>(null)
  const [analyzingEmailPdf, setAnalyzingEmailPdf] = useState(false)
  const [lastAnalyzedRequestKey, setLastAnalyzedRequestKey] = useState<string | null>(null)
  const [mainTaskDraftSnapshot, setMainTaskDraftSnapshot] = useState<MainTaskDraftSnapshot | null>(null)
  const emailPdfAnalysisController = useRef<AbortController | null>(null)

  const hasEmailImportDraft = Boolean(
    !parentTask
    && !suggestion
    && creationMode === 'email_pdf'
    && (
      emailPdf
      || emailPdfInstruction.trim() !== DEFAULT_DOCUMENT_INSTRUCTION
      || emailPdfDocumentType !== 'auto'
      || emailPdfAnalysisMode !== 'explicit'
      || emailPdfAnalysis
    )
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
    + (creationMode === 'email_pdf' && emailPdf && attachSourceDocument ? 1 : 0)
  const interactionBusy = busy || analyzingEmailPdf
  const currentAnalysisRequestKey = analysisRequestKey(
    emailPdfInstruction,
    emailPdfDocumentType,
    emailPdfAnalysisMode
  )
  const emailPdfAnalysisIsCurrent =
    Boolean(emailPdfAnalysis)
    && lastAnalyzedRequestKey === currentAnalysisRequestKey
  const hasIncompleteIncludedSubtask = emailPdfSubtasks.some(
    (subtask) => subtask.included && !subtask.title.trim()
  )
  const responsibleParties = includedEmailPdfSubtasks
    .map((subtask) => subtask.responsibleParty.trim())
    .filter(Boolean)
  const dueTexts = includedEmailPdfSubtasks
    .map((subtask) => subtask.dueText.trim())
    .filter(Boolean)
  const hasDifferentTaskAssignments =
    new Set(responsibleParties).size > 1
    || (responsibleParties.length > 0 && responsibleParties.length < includedEmailPdfSubtasks.length)
    || new Set(dueTexts).size > 1
    || (dueTexts.length > 0 && dueTexts.length < includedEmailPdfSubtasks.length)
  const hasExtractedAssignmentDetails = responsibleParties.length > 0 || dueTexts.length > 0
  const emailPdfReviewReady =
    creationMode !== 'email_pdf'
    || Boolean(
      emailPdf
      && emailPdfAnalysis
      && emailPdfAnalysisIsCurrent
      && !emailPdfAnalysis.hasMoreActions
      && emailPdfAnalysis.subtasks.length > 0
      && includedEmailPdfSubtasks.length > 0
      && (!hasExtractedAssignmentDetails || confirmedSharedAssignment)
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
    const reservedEmailPdf = creationMode === 'email_pdf' && emailPdf && attachSourceDocument ? 1 : 0
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
    setLastAnalyzedRequestKey(null)
    setMainTaskDraftSnapshot(null)
    setConfirmedSharedAssignment(false)
  }

  const switchToManualCreation = () => {
    if (
      hasEmailImportDraft
      && !window.confirm('Byt till manuellt läge och kasta PDF-underlaget och AI-förslaget?')
    ) return
    clearEmailPdfAnalysis(true)
    setEmailPdf(null)
    setEmailPdfInstruction(DEFAULT_DOCUMENT_INSTRUCTION)
    setEmailPdfDocumentType('auto')
    setEmailPdfAnalysisMode('explicit')
    setAttachSourceDocument(false)
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
      setEmailPdfError('Dokumentet måste vara en PDF-fil.')
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
    if (attachSourceDocument && remainingAttachments.length >= MAX_INITIAL_ATTACHMENTS) {
      setEmailPdfError(`Du kan lägga till högst ${MAX_INITIAL_ATTACHMENTS} filer totalt.`)
      return
    }
    const attachmentBytes = remainingAttachments.reduce(
      (sum, attachment) => sum + attachment.size,
      0
    )
    if (
      attachSourceDocument
      && attachmentBytes + file.size > MAX_INITIAL_ATTACHMENT_TOTAL_BYTES
    ) {
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
    setAttachSourceDocument(false)
    setEmailPdfError(null)
  }

  const toggleAttachSourceDocument = (checked: boolean) => {
    if (!checked) {
      setAttachSourceDocument(false)
      setEmailPdfError(null)
      return
    }
    if (!emailPdf) return
    if (attachments.length >= MAX_INITIAL_ATTACHMENTS) {
      setEmailPdfError(`Du kan lägga till högst ${MAX_INITIAL_ATTACHMENTS} filer totalt.`)
      return
    }
    const attachmentBytes = attachments.reduce((sum, attachment) => sum + attachment.size, 0)
    if (attachmentBytes + emailPdf.size > MAX_INITIAL_ATTACHMENT_TOTAL_BYTES) {
      setEmailPdfError('PDF-filen och övriga bilagor får tillsammans vara högst 100 MB.')
      return
    }
    setAttachSourceDocument(true)
    setEmailPdfError(null)
  }

  const analyzeEmailPdf = async () => {
    const instruction = emailPdfInstruction.trim()
    const requestKey = analysisRequestKey(
      instruction,
      emailPdfDocumentType,
      emailPdfAnalysisMode
    )
    if (!emailPdf) {
      setEmailPdfError('Lägg till dokumentet som PDF först.')
      return
    }
    if (!instruction) {
      setEmailPdfError('Beskriv kort vad Gizmo ska göra.')
      return
    }
    if (instruction.length < 5) {
      setEmailPdfError('Beskriv med några ord vad Gizmo ska göra.')
      return
    }
    if (
      emailPdfAnalysis
      && !window.confirm('Analysera igen och ersätt AI-förslaget och dina ändringar i det?')
    ) return

    emailPdfAnalysisController.current?.abort()
    const controller = new AbortController()
    emailPdfAnalysisController.current = controller
    if (emailPdfAnalysis) setLastAnalyzedRequestKey(null)
    setAnalyzingEmailPdf(true)
    setConfirmedSharedAssignment(false)
    setEmailPdfError(null)
    try {
      const form = new FormData()
      form.append('file', emailPdf)
      form.append('instruction', instruction)
      form.append('documentType', emailPdfDocumentType)
      form.append('analysisMode', emailPdfAnalysisMode)
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
      setLastAnalyzedRequestKey(requestKey)
      setTitle(analysis.mainTask.title)
      setDescription(analysis.mainTask.description)
      setContextLabel(analysis.mainTask.contextLabel)
      setEmailPdfSubtasks(
        analysis.subtasks.map((subtask) => ({
          ...subtask,
          id: draftId(),
          included: subtask.basis !== 'ai_suggestion',
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
    setConfirmedSharedAssignment(false)
    setEmailPdfSubtasks((current) => [
      ...current,
      {
        id: draftId(),
        included: true,
        title: '',
        description: '',
        checklist: [],
        basis: 'manual',
        responsibleParty: '',
        dueText: '',
        sourceExcerpt: '',
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
      creationMode === 'email_pdf' && emailPdf && attachSourceDocument
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
              description: taskDescriptionWithChecklist(
                subtask.description,
                subtask.checklist,
                subtask.responsibleParty,
                subtask.dueText
              ),
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
        className="relative flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-slate-50 shadow-2xl sm:max-w-2xl sm:rounded-3xl"
      >
        <header className="z-10 flex shrink-0 items-start justify-between border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur sm:px-6">
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

        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-5 sm:px-6">
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
                    <Sparkles size={17} aria-hidden="true" /> Från dokument
                  </button>
                </div>

                {creationMode === 'email_pdf' ? (
                  <section
                    className="rounded-2xl border border-violet-200 bg-violet-50/70 p-4"
                    aria-labelledby="email-pdf-analysis-title"
                  >
                    <div className="flex items-start gap-3">
                      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
                        <FileText size={20} aria-hidden="true" />
                      </span>
                      <div>
                        <h3 id="email-pdf-analysis-title" className="font-semibold text-violet-950">
                          Skapa uppgifter från dokument
                        </h3>
                        <p className="mt-1 text-xs leading-5 text-violet-800">
                          Lägg till ett dokument i PDF-format. Gizmo strukturerar innehållet till ett redigerbart utkast. Inget skapas eller skickas innan du har granskat det.
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
                          title="Dra in dokumentet som PDF"
                          activeTitle="Släpp PDF-filen för att lägga till den"
                          description={`Du kan även klicka och välja en PDF. Max ${TASK_EMAIL_PDF_MAX_MEGABYTES} MB.`}
                          disabled={interactionBusy}
                          multiple={false}
                          icon={<FileText className="text-violet-700" size={24} aria-hidden="true" />}
                          onFiles={chooseEmailPdf}
                        />
                      )}
                    </div>

                    {emailPdf ? (
                      <div className="mt-3 rounded-xl border border-violet-200 bg-white px-3.5 py-3">
                        <label className="flex cursor-pointer items-start gap-3">
                          <input
                            type="checkbox"
                            checked={attachSourceDocument}
                            onChange={(event) => toggleAttachSourceDocument(event.target.checked)}
                            className="mt-0.5 h-5 w-5 shrink-0 rounded border-slate-300 accent-violet-700"
                          />
                          <span>
                            <span className="block text-sm font-semibold text-slate-800">
                              Bifoga även källdokumentet till uppdraget
                            </span>
                            <span className="mt-0.5 block text-xs leading-5 text-slate-500">
                              Av som standard. Utan detta val används PDF-filen bara för analys och delas inte som bilaga med mottagaren.
                            </span>
                          </span>
                        </label>
                      </div>
                    ) : null}

                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <label className="block">
                        <span className="mb-1.5 block text-sm font-semibold text-violet-950">
                          Dokumenttyp
                        </span>
                        <span className="relative block">
                          <select
                            value={emailPdfDocumentType}
                            onChange={(event) => {
                              setEmailPdfDocumentType(event.target.value as TaskEmailPdfDocumentTypeHint)
                              setConfirmedSharedAssignment(false)
                              setEmailPdfError(null)
                            }}
                            className={`${inputClass} appearance-none pr-10`}
                          >
                            {TASK_EMAIL_PDF_DOCUMENT_TYPE_HINTS.map((value) => (
                              <option key={value} value={value}>{DOCUMENT_TYPE_HINT_LABELS[value]}</option>
                            ))}
                          </select>
                          <ChevronDown className="pointer-events-none absolute right-3 top-3 text-slate-400" size={18} aria-hidden="true" />
                        </span>
                      </label>

                      <label className="block">
                        <span className="mb-1.5 block text-sm font-semibold text-violet-950">
                          Analysnivå
                        </span>
                        <span className="relative block">
                          <select
                            value={emailPdfAnalysisMode}
                            onChange={(event) => {
                              setEmailPdfAnalysisMode(event.target.value as TaskEmailPdfAnalysisMode)
                              setConfirmedSharedAssignment(false)
                              setEmailPdfError(null)
                            }}
                            className={`${inputClass} appearance-none pr-10`}
                          >
                            {TASK_EMAIL_PDF_ANALYSIS_MODES.map((value) => (
                              <option key={value} value={value}>{ANALYSIS_MODE_LABELS[value]}</option>
                            ))}
                          </select>
                          <ChevronDown className="pointer-events-none absolute right-3 top-3 text-slate-400" size={18} aria-hidden="true" />
                        </span>
                      </label>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-violet-800">
                      {ANALYSIS_MODE_HELP[emailPdfAnalysisMode]}
                    </p>

                    <p className="mt-2 rounded-lg bg-white/70 px-3 py-2 text-[11px] leading-5 text-violet-900">
                      PDF-filen skickas till OpenAI API för analys. Undvik personnummer, portkoder,
                      betaluppgifter och andra hemligheter som inte behövs för uppgiften.
                    </p>

                    <label className="mt-4 block">
                      <span className="mb-1.5 block text-sm font-semibold text-violet-950">
                        Vad vill du att Gizmo ska göra?
                      </span>
                      <textarea
                        value={emailPdfInstruction}
                        onChange={(event) => {
                          setEmailPdfInstruction(event.target.value)
                          setConfirmedSharedAssignment(false)
                          setEmailPdfError(null)
                        }}
                        rows={3}
                        maxLength={1200}
                        disabled={interactionBusy}
                        placeholder={DEFAULT_DOCUMENT_INSTRUCTION}
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
                        ? 'Gizmo läser dokumentet och tar fram ett förslag.'
                        : emailPdfAnalysis
                          ? 'Gizmos förslag är klart för granskning.'
                          : ''}
                    </p>
                    {emailPdfAnalysis && !emailPdfAnalysisIsCurrent ? (
                      <p role="alert" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
                        Instruktionen, dokumenttypen eller analysnivån har ändrats. Analysera igen innan uppgifterna kan skapas.
                      </p>
                    ) : null}
                    {emailPdfAnalysis ? (
                      <div className="mt-4 space-y-3 border-t border-violet-200 pt-4">
                        <div className="rounded-xl bg-white px-3.5 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">
                              Gizmos sammanfattning
                            </p>
                            <span className="rounded-full bg-violet-100 px-2 py-1 text-[11px] font-semibold text-violet-800">
                              Tolkat som: {DOCUMENT_TYPE_LABELS[emailPdfAnalysis.documentType]}
                            </span>
                            <span className="text-[11px] text-slate-500">
                              {DOCUMENT_TYPE_CONFIDENCE_LABELS[emailPdfAnalysis.documentTypeConfidence]}
                            </span>
                          </div>
                          <p className="mt-2 text-sm leading-6 text-slate-700">{emailPdfAnalysis.summary}</p>
                          {emailPdfAnalysis.mainTask.sourceExcerpt ? (
                            <blockquote className="mt-2 border-l-2 border-violet-200 pl-2 text-xs italic leading-5 text-slate-600">
                              “{emailPdfAnalysis.mainTask.sourceExcerpt}”
                            </blockquote>
                          ) : null}
                          {emailPdfAnalysis.mainTask.sourceExcerpt || emailPdfAnalysis.mainTask.sourcePages.length > 0 ? (
                            <p className="mt-1 text-[11px] text-slate-500">
                              {sourceLabel(emailPdfAnalysis.mainTask.sourcePages)}
                            </p>
                          ) : null}
                        </div>

                        {emailPdfAnalysis.hasMoreActions ? (
                          <div role="alert" className="rounded-xl border border-rose-300 bg-rose-50 px-3.5 py-3 text-rose-900">
                            <p className="flex items-center gap-2 text-sm font-semibold">
                              <AlertTriangle size={16} aria-hidden="true" /> Alla åtgärder fick inte plats
                            </p>
                            <p className="mt-1 text-xs leading-5">
                              Uppgifter kan inte skapas från ett ofullständigt urval. Avgränsa instruktionen och analysera dokumentet igen.
                            </p>
                          </div>
                        ) : null}

                        {emailPdfAnalysis.subtasks.length === 0 ? (
                          <div role="status" className="rounded-xl border border-slate-200 bg-white px-3.5 py-3">
                            <p className="text-sm font-semibold text-slate-900">Inga skapbara uppgifter hittades</p>
                            <p className="mt-1 text-xs leading-5 text-slate-600">
                              Ändra instruktionen eller analysnivån och analysera igen.
                            </p>
                          </div>
                        ) : null}

                        {emailPdfAnalysis.missingInformation.length > 0 ? (
                          <section className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3">
                            <h4 className="flex items-center gap-2 text-sm font-semibold text-amber-950">
                              <AlertTriangle size={16} aria-hidden="true" /> Saknade underlag eller uppgifter
                            </h4>
                            <p className="mt-1 text-xs leading-5 text-amber-900">
                              Dessa skapas inte som uppgifter.
                            </p>
                            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5 text-amber-900">
                              {emailPdfAnalysis.missingInformation.map((item, index) => (
                                <li key={`${index}:${item}`}>{item}</li>
                              ))}
                            </ul>
                          </section>
                        ) : null}

                        {emailPdfAnalysis.warnings.length > 0 ? (
                          <section className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3">
                            <h4 className="flex items-center gap-2 text-sm font-semibold text-amber-950">
                              <AlertTriangle size={16} aria-hidden="true" /> Kontrollera tolkningen
                            </h4>
                            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5 text-amber-900">
                              {emailPdfAnalysis.warnings.map((item, index) => (
                                <li key={`${index}:${item}`}>{item}</li>
                              ))}
                            </ul>
                          </section>
                        ) : null}

                        <SourceItemSection
                          title="Beslut i dokumentet"
                          description="Visas som information och skapas inte automatiskt som uppgifter."
                          items={emailPdfAnalysis.decisions}
                        />
                        <SourceItemSection
                          title="Observationer och bakgrund"
                          description="Visas som information och skapas inte automatiskt som uppgifter."
                          items={emailPdfAnalysis.observations}
                        />

                        <fieldset className="rounded-xl border border-violet-200 bg-white p-3.5">
                          <legend className="px-1 text-sm font-semibold text-slate-900">
                            Uppgifter att skapa ({includedEmailPdfSubtasks.length})
                          </legend>
                          <p className="mt-1 text-xs leading-5 text-slate-500">
                            De valda uppgifterna skapas som underuppgifter. I den här batchen får alla samma mottagare, projekt och sluttid som huvuduppdraget.
                          </p>
                          {hasExtractedAssignmentDetails ? (
                            <div role="alert" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-900">
                              <p className="font-semibold">
                                {hasDifferentTaskAssignments
                                  ? 'Dokumentet anger olika ansvariga eller tider för de valda uppgifterna.'
                                  : 'Dokumentet anger ansvarig eller tid för minst en vald uppgift.'}
                              </p>
                              <p className="mt-1">
                                Alla valda underuppgifter får mottagaren och sluttiden som väljs längre ned. Källans ansvar och tid sparas bara i beskrivningen och måste kontrolleras.
                              </p>
                              <label className="mt-2 flex cursor-pointer items-start gap-2 rounded-lg bg-white/70 px-2.5 py-2 font-semibold text-amber-950">
                                <input
                                  type="checkbox"
                                  checked={confirmedSharedAssignment}
                                  onChange={(event) => setConfirmedSharedAssignment(event.target.checked)}
                                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-amber-400 accent-amber-700"
                                />
                                <span>Jag vill skapa uppgifterna med den gemensamma mottagare och sluttid som jag väljer i formuläret.</span>
                              </label>
                            </div>
                          ) : null}
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
                                <div className="flex flex-wrap items-center gap-2">
                                  <label className="inline-flex min-h-10 flex-1 cursor-pointer items-center gap-2 text-sm font-semibold text-slate-800">
                                    <input
                                      type="checkbox"
                                      checked={subtask.included}
                                      onChange={(event) => {
                                        const included = event.target.checked
                                        setConfirmedSharedAssignment(false)
                                        setEmailPdfSubtasks((current) => current.map((item) =>
                                          item.id === subtask.id ? { ...item, included } : item
                                        ))
                                      }}
                                      className="h-5 w-5 rounded border-slate-300 accent-violet-700"
                                    />
                                    Ta med uppgift {index + 1}
                                  </label>
                                  <span className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-violet-800">
                                    {TASK_BASIS_LABELS[subtask.basis]}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setConfirmedSharedAssignment(false)
                                      setEmailPdfSubtasks((current) => current.filter((item) => item.id !== subtask.id))
                                    }}
                                    className="inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-500 hover:bg-rose-50 hover:text-rose-700"
                                    aria-label={`Ta bort uppgift ${index + 1}`}
                                  >
                                    <Trash2 size={16} aria-hidden="true" />
                                  </button>
                                </div>
                                <label className="mt-2 block">
                                  <span className="sr-only">Titel för uppgift {index + 1}</span>
                                  <input
                                    value={subtask.title}
                                    maxLength={180}
                                    disabled={!subtask.included}
                                    onChange={(event) => {
                                      const nextTitle = event.target.value
                                      setEmailPdfSubtasks((current) => current.map((item) =>
                                        item.id === subtask.id
                                          ? {
                                              ...item,
                                              title: nextTitle,
                                              basis: 'manual',
                                              sourceExcerpt: '',
                                              sourcePages: [],
                                            }
                                          : item
                                      ))
                                    }}
                                    className={inputClass}
                                    placeholder="Vad ska bli gjort?"
                                  />
                                </label>
                                <label className="mt-2 block">
                                  <span className="sr-only">Beskrivning för uppgift {index + 1}</span>
                                  <textarea
                                    value={subtask.description}
                                    rows={2}
                                    maxLength={1200}
                                    disabled={!subtask.included}
                                    onChange={(event) => {
                                      const nextDescription = event.target.value
                                      setEmailPdfSubtasks((current) => current.map((item) =>
                                        item.id === subtask.id
                                          ? {
                                              ...item,
                                              description: nextDescription,
                                              basis: 'manual',
                                              sourceExcerpt: '',
                                              sourcePages: [],
                                            }
                                          : item
                                      ))
                                    }}
                                    className={inputClass}
                                    placeholder="Beskriv önskat resultat."
                                  />
                                </label>

                                <div className="mt-3">
                                  <p className="text-xs font-semibold text-slate-700">Detaljer och checklista</p>
                                  <div className="mt-2 space-y-2">
                                    {subtask.checklist.map((checklistItem, checklistIndex) => (
                                      <div key={`${subtask.id}:checklist:${checklistIndex}`} className="flex items-center gap-2">
                                        <input
                                          value={checklistItem}
                                          maxLength={500}
                                          disabled={!subtask.included}
                                          onChange={(event) => {
                                            const nextChecklistItem = event.target.value
                                            setEmailPdfSubtasks((current) => current.map((item) =>
                                              item.id === subtask.id
                                                ? {
                                                    ...item,
                                                    checklist: item.checklist.map((value, itemIndex) =>
                                                      itemIndex === checklistIndex ? nextChecklistItem : value
                                                    ),
                                                    basis: 'manual',
                                                    sourceExcerpt: '',
                                                    sourcePages: [],
                                                  }
                                                : item
                                            ))
                                          }}
                                          className={inputClass}
                                          aria-label={`Checklistpunkt ${checklistIndex + 1} för uppgift ${index + 1}`}
                                        />
                                        <button
                                          type="button"
                                          disabled={!subtask.included}
                                          onClick={() => setEmailPdfSubtasks((current) => current.map((item) =>
                                            item.id === subtask.id
                                              ? {
                                                  ...item,
                                                  checklist: item.checklist.filter((_, itemIndex) => itemIndex !== checklistIndex),
                                                  basis: 'manual',
                                                  sourceExcerpt: '',
                                                  sourcePages: [],
                                                }
                                              : item
                                          ))}
                                          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
                                          aria-label={`Ta bort checklistpunkt ${checklistIndex + 1} från uppgift ${index + 1}`}
                                        >
                                          <Trash2 size={15} aria-hidden="true" />
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                  <button
                                    type="button"
                                    disabled={!subtask.included}
                                    onClick={() => setEmailPdfSubtasks((current) => current.map((item) =>
                                      item.id === subtask.id
                                        ? {
                                            ...item,
                                            checklist: [...item.checklist, ''],
                                            basis: 'manual',
                                            sourceExcerpt: '',
                                            sourcePages: [],
                                          }
                                        : item
                                    ))}
                                    className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                  >
                                    <Plus size={14} aria-hidden="true" /> Lägg till punkt
                                  </button>
                                </div>

                                {subtask.responsibleParty || subtask.dueText ? (
                                  <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                                    {subtask.responsibleParty ? (
                                      <div className="rounded-lg bg-white px-2.5 py-2">
                                        <dt className="font-semibold text-slate-500">Angiven ansvarig</dt>
                                        <dd className="mt-0.5 text-slate-800">{subtask.responsibleParty}</dd>
                                      </div>
                                    ) : null}
                                    {subtask.dueText ? (
                                      <div className="rounded-lg bg-white px-2.5 py-2">
                                        <dt className="font-semibold text-slate-500">Angiven tid</dt>
                                        <dd className="mt-0.5 text-slate-800">{subtask.dueText}</dd>
                                      </div>
                                    ) : null}
                                  </dl>
                                ) : null}
                                {subtask.sourceExcerpt ? (
                                  <blockquote className="mt-3 border-l-2 border-violet-200 pl-2 text-xs italic leading-5 text-slate-600">
                                    “{subtask.sourceExcerpt}”
                                  </blockquote>
                                ) : null}
                                {subtask.sourceExcerpt || subtask.sourcePages.length > 0 ? (
                                  <p className="mt-1 text-[11px] text-slate-500">{sourceLabel(subtask.sourcePages)}</p>
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
                            <Plus size={15} aria-hidden="true" /> Lägg till uppgift
                          </button>
                          {hasIncompleteIncludedSubtask ? (
                            <p role="alert" className="mt-2 text-xs font-medium text-rose-700">
                              Fyll i en titel eller välj bort den tomma uppgiften.
                            </p>
                          ) : null}
                          {emailPdfSubtasks.length > 0 && includedEmailPdfSubtasks.length === 0 ? (
                            <p role="alert" className="mt-2 text-xs font-medium text-rose-700">
                              Välj minst en uppgift att skapa.
                            </p>
                          ) : null}
                          <p className="mt-2 text-[11px] text-slate-500">Högst {TASK_EMAIL_PDF_MAX_SUBTASKS} uppgifter kan skapas samtidigt.</p>
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
                  onChange={(event) => {
                    setAssigneeRef(event.target.value)
                    setConfirmedSharedAssignment(false)
                  }}
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
                    <input required value={contactName} onChange={(event) => {
                      setContactName(event.target.value)
                      setConfirmedSharedAssignment(false)
                    }} className={inputClass} />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-slate-600">Företag</span>
                    <input value={contactCompany} onChange={(event) => {
                      setContactCompany(event.target.value)
                      setConfirmedSharedAssignment(false)
                    }} className={inputClass} />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-slate-600">E-post för Mina uppdrag</span>
                    <input type="email" value={contactEmail} onChange={(event) => {
                      setContactEmail(event.target.value)
                      setConfirmedSharedAssignment(false)
                    }} className={inputClass} />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-slate-600">Telefon / WhatsApp</span>
                    <input type="tel" value={contactPhone} onChange={(event) => {
                      setContactPhone(event.target.value)
                      setConfirmedSharedAssignment(false)
                    }} className={inputClass} />
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
                        setConfirmedSharedAssignment(false)
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
                        setConfirmedSharedAssignment(false)
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
          </div>

          <div className="z-20 shrink-0 border-t border-slate-200 bg-white/95 px-5 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:px-6">
            {creationMode === 'email_pdf' && hasExtractedAssignmentDetails && !confirmedSharedAssignment ? (
              <label className="mb-2 flex cursor-pointer items-start gap-2 rounded-lg bg-amber-50 px-2.5 py-2 text-xs font-semibold leading-5 text-amber-950">
                <input
                  type="checkbox"
                  checked={confirmedSharedAssignment}
                  disabled={interactionBusy}
                  onChange={(event) => setConfirmedSharedAssignment(event.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-amber-400 accent-amber-700"
                />
                <span>Bekräfta att alla valda uppgifter ska få formulärets gemensamma mottagare och sluttid.</span>
              </label>
            ) : null}
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
                    ? `Skapa huvuduppdrag${includedEmailPdfSubtasks.length > 0 ? ` + ${includedEmailPdfSubtasks.length} uppgifter` : ''}`
                    : 'Skapa och tilldela'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
