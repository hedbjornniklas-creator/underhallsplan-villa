'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  Camera,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  Clock3,
  Copy,
  FileText,
  Image as ImageIcon,
  Link2Off,
  Loader2,
  MessageSquareText,
  Mic,
  Paperclip,
  Send,
  Square,
  UserPlus,
  X,
} from 'lucide-react'
import { useToast } from '@/components/ui/AppToastProvider'
import type { TaskChannel, TaskCompletionEvidenceType } from '@/lib/tasks/contracts'
import {
  addTaskDateInputDays,
  formatTaskDateTime,
  normalizeTaskTimeZone,
  taskDateTimeInputToIso,
  taskIsoToDateTimeInput,
  taskTimeZoneLabel,
  taskTodayDateInput,
} from '@/lib/tasks/dateTime'
import type { ExternalTaskWorkspace } from '@/lib/tasks/external'
import RecipientAccountAction from './RecipientAccountAction'
import TaskAttachmentDropZone from './TaskAttachmentDropZone'
import TaskConversationCard from './TaskConversationCard'
import TaskHistoryDisclosure from './TaskHistoryDisclosure'
import TaskTimeProgress from './TaskTimeProgress'
import { SigneMark } from './SigneMark'
import { TaskStatusBadge } from './TaskStatusBadge'

type Props = {
  initialWorkspace: ExternalTaskWorkspace
  endpoint: string
  backHref?: string
  backLabel?: string
  showRecipientAccountAction?: boolean
}

type ApiResponse = {
  workspace?: ExternalTaskWorkspace
  notice?: string
  warning?: string | null
  accessUrl?: string
  transcript?: string
  error?: string
}

type ActionPanel = 'waiting' | 'deadline' | 'delegate' | null

const inputClassName =
  'min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-amber-400 focus:ring-4 focus:ring-amber-100 disabled:bg-slate-100 disabled:text-slate-500'

const maxAttachmentBytes = 25 * 1024 * 1024
const taskAttachmentAccept =
  'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,application/pdf,.pdf,.doc,.docx,.xls,.xlsx,.txt,text/plain'

function isImageAttachmentFile(file: File) {
  return file.type.toLowerCase().startsWith('image/') || /\.(jpe?g|png|webp|hei[cf])$/i.test(file.name)
}

function attachmentTypeLabel(type: ExternalTaskWorkspace['task']['attachments'][number]['type']) {
  if (type === 'photo') return 'Foto'
  if (type === 'document') return 'Dokument'
  if (type === 'audio') return 'Röstmeddelande'
  return 'Textunderlag'
}

function completionEvidenceSatisfied(
  type: TaskCompletionEvidenceType,
  attachments: ExternalTaskWorkspace['task']['attachments']
) {
  return attachments.some(
    (attachment) =>
      attachment.isCompletionEvidence &&
      (attachment.type === type ||
        (type === 'text' && attachment.type === 'audio' && Boolean(attachment.transcriptText?.trim())))
  )
}

function matchesCompletionEvidenceRequirement(
  task: ExternalTaskWorkspace['task'],
  type: TaskCompletionEvidenceType
) {
  if (task.evidenceRequirements.length > 0) return task.evidenceRequirements.includes(type)
  return task.evidenceRequirement === 'any' || task.evidenceRequirement === type
}

function recordingExtension(contentType: string) {
  if (contentType.includes('mp4')) return 'm4a'
  if (contentType.includes('ogg')) return 'ogg'
  if (contentType.includes('mpeg')) return 'mp3'
  if (contentType.includes('wav')) return 'wav'
  return 'webm'
}

function requirementState(status: string, key?: string) {
  if (status === 'verified') return { done: true, label: 'Verifierad' }
  if (status === 'not_required') return { done: true, label: 'Inte tillämplig' }
  if (status === 'waived') return { done: true, label: 'Undantag godkänt' }
  if (status === 'evidence_detected' && key === 'completion_evidence') {
    return { done: true, label: 'Underlag mottaget – klart att skicka för kontroll' }
  }
  if (status === 'evidence_detected') return { done: false, label: 'Underlag mottaget – väntar på kontroll' }
  return { done: false, label: 'Återstår' }
}

function deadlineRequestLabel(status: string) {
  if (status === 'approved') return 'Godkänd'
  if (status === 'rejected') return 'Avslagen'
  if (status === 'cancelled') return 'Återkallad'
  return 'Väntar på beslut'
}

function accessClosedCopy(state: 'expired' | 'revoked') {
  return state === 'expired'
    ? {
        title: 'Länken har gått ut',
        text: 'Be uppdragsansvarig skicka en ny personlig länk om du fortfarande ska hantera uppgiften.',
      }
    : {
        title: 'Länken har återkallats',
        text: 'Den här länken kan inte längre användas. Kontakta uppdragsansvarig om du behöver fortsatt åtkomst.',
      }
}

export default function TaskRecipientClient({
  initialWorkspace,
  endpoint,
  backHref,
  backLabel = 'Mina uppdrag',
  showRecipientAccountAction = false,
}: Props) {
  const {
    success: showSuccessToast,
    error: showErrorToast,
    warning: showWarningToast,
  } = useToast()
  const [workspace, setWorkspace] = useState(initialWorkspace)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [panel, setPanel] = useState<ActionPanel>(null)
  const [waitingReason, setWaitingReason] = useState('')
  const [waitingDate, setWaitingDate] = useState('')
  const [waitingTime, setWaitingTime] = useState('')
  const [deadlineReason, setDeadlineReason] = useState('')
  const [requestedDueDate, setRequestedDueDate] = useState('')
  const [requestedDueTime, setRequestedDueTime] = useState('')
  const [delegateTitle, setDelegateTitle] = useState('')
  const [delegateDescription, setDelegateDescription] = useState('')
  const [delegateName, setDelegateName] = useState('')
  const [delegateEmail, setDelegateEmail] = useState('')
  const [delegatePhone, setDelegatePhone] = useState('')
  const [delegateDueDate, setDelegateDueDate] = useState('')
  const [delegateDueTime, setDelegateDueTime] = useState('')
  const [delegateFollowupDate, setDelegateFollowupDate] = useState('')
  const [delegateFollowupTime, setDelegateFollowupTime] = useState('')
  const [delegatePrimaryChannel, setDelegatePrimaryChannel] = useState<TaskChannel>('email')
  const [delegateFallbackChannel, setDelegateFallbackChannel] = useState<TaskChannel | ''>('whatsapp')
  const [delegateEvidenceRequirements, setDelegateEvidenceRequirements] = useState<TaskCompletionEvidenceType[]>([])
  const [evidenceText, setEvidenceText] = useState('')
  const [delegatedAccessUrl, setDelegatedAccessUrl] = useState<string | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const documentInputRef = useRef<HTMLInputElement>(null)
  const evidenceSectionRef = useRef<HTMLElement>(null)
  const commentInputRef = useRef<HTMLTextAreaElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const recordingChunksRef = useRef<Blob[]>([])
  const recordingStartedAtRef = useRef<number | null>(null)

  const task = workspace.task
  const effectiveTimeZone = normalizeTaskTimeZone(task.dueTimeZone)
  const creationTimeZone = normalizeTaskTimeZone(workspace.timeZone)
  const markMessagesRead = useCallback(async (throughEventId: string) => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'mark_messages_read',
        payload: { throughEventId },
      }),
    })
    if (!response.ok) throw new Error('TASK_MESSAGES_READ_FAILED')
  }, [endpoint])
  const todayInput = taskTodayDateInput(effectiveTimeZone)
  const creationTodayInput = taskTodayDateInput(creationTimeZone)
  const dueInput = useMemo(
    () => taskIsoToDateTimeInput(task.dueAt, effectiveTimeZone),
    [effectiveTimeZone, task.dueAt]
  )
  const parentDueInCreationZone = useMemo(
    () => taskIsoToDateTimeInput(task.dueAt, creationTimeZone),
    [creationTimeZone, task.dueAt]
  )
  const dueDateInput = dueInput?.date ?? ''
  const waitingWindowOpen = Number.isFinite(Date.parse(task.dueAt)) && Date.parse(task.dueAt) >= Date.now()
  const deadlineMinDate = dueInput?.date && dueInput.date > todayInput ? dueInput.date : todayInput
  const waitingMaxTime = dueInput && waitingDate === dueInput.date ? dueInput.time : undefined
  const requestedDueMinTime = dueInput && requestedDueDate === dueInput.date ? dueInput.time : undefined
  const delegateDueMaxTime = parentDueInCreationZone && delegateDueDate === parentDueInCreationZone.date
    ? parentDueInCreationZone.time
    : undefined
  const delegateFollowupMaxTime = delegateFollowupDate === delegateDueDate ? delegateDueTime : undefined
  const pendingDeadlineRequest = task.deadlineRequests.find((request) => request.status === 'pending') ?? null
  const evidenceChecklist = task.evidenceRequirements.map((type) => ({
    type,
    complete: completionEvidenceSatisfied(type, task.attachments),
  }))
  const requirementsComplete = task.requirements.every((requirement) => requirementState(requirement.status, requirement.key).done)
  const prestartBlocked = task.requirements.some(
    (requirement) =>
      ['written_quote', 'written_client_approval', 'warranty_basis'].includes(requirement.key) &&
      !requirementState(requirement.status, requirement.key).done
  )
  const childrenComplete = workspace.children.every((child) => ['approved', 'cancelled'].includes(child.status))
  const readyForReviewBlocked = !requirementsComplete || !childrenComplete
  const isBusy = busyAction !== null
  const conversationCanSend =
    workspace.accessState === 'open' && !['approved', 'cancelled'].includes(task.status)

  useEffect(() => {
    if (!panel) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isBusy) setPanel(null)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [isBusy, panel])

  useEffect(() => {
    if (!isRecording) return
    const timer = window.setInterval(() => {
      const startedAt = recordingStartedAtRef.current
      if (startedAt) setRecordingSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)))
    }, 500)
    return () => window.clearInterval(timer)
  }, [isRecording])

  useEffect(() => {
    return () => {
      const recorder = mediaRecorderRef.current
      if (recorder?.state === 'recording') {
        recorder.ondataavailable = null
        recorder.onstop = null
        recorder.stop()
      }
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  const runAction = async (
    action: 'start' | 'waiting' | 'ready_for_review' | 'comment' | 'request_deadline_change' | 'create_subtask',
    payload: Record<string, unknown>,
    successMessage: string
  ) => {
    if (isBusy || workspace.accessState !== 'open') return false
    setBusyAction(action)
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, payload }),
      })
      const body = (await response.json().catch(() => ({}))) as ApiResponse
      if (!response.ok) throw new Error(body.error || 'Kunde inte uppdatera uppgiften.')
      if (body.workspace) setWorkspace(body.workspace)
      if (body.accessUrl) {
        setDelegatedAccessUrl(body.accessUrl)
        try {
          await navigator.clipboard.writeText(body.accessUrl)
        } catch {
          // Länken visas i sidan om webbläsaren inte ger urklippsåtkomst.
        }
      }
      if (body.warning) showWarningToast(body.warning)
      else showSuccessToast(body.notice || successMessage)
      return true
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : 'Kunde inte uppdatera uppgiften.')
      return false
    } finally {
      setBusyAction(null)
    }
  }

  const uploadEvidence = async (
    action: 'attachment' | 'transcribe',
    url: string,
    formData: FormData,
    successMessage: string
  ) => {
    if (isBusy || workspace.accessState !== 'open') return false
    setBusyAction(action)
    try {
      const response = await fetch(url, { method: 'POST', body: formData })
      const body = (await response.json().catch(() => ({}))) as ApiResponse
      if (!response.ok) throw new Error(body.error || 'Kunde inte spara underlaget.')
      if (body.workspace) setWorkspace(body.workspace)
      showSuccessToast(body.notice || successMessage)
      return true
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : 'Kunde inte spara underlaget.')
      return false
    } finally {
      setBusyAction(null)
    }
  }

  const submitTextEvidence = async (event: FormEvent) => {
    event.preventDefault()
    const text = evidenceText.trim()
    if (!text) return
    const formData = new FormData()
    formData.append('text', text)
    formData.append(
      'completionEvidence',
      String(matchesCompletionEvidenceRequirement(task, 'text'))
    )
    const ok = await uploadEvidence('attachment', `${endpoint}/attachments`, formData, 'Textunderlaget sparades.')
    if (ok) setEvidenceText('')
  }

  const uploadFileEvidence = async (file: File) => {
    if (file.size > maxAttachmentBytes) {
      showErrorToast('Filen är för stor. Maximal storlek är 25 MB.')
      return false
    }
    const formData = new FormData()
    formData.append('file', file)
    const evidenceType = isImageAttachmentFile(file) ? 'photo' : 'document'
    formData.append(
      'completionEvidence',
      String(
        matchesCompletionEvidenceRequirement(task, evidenceType)
      )
    )
    return uploadEvidence('attachment', `${endpoint}/attachments`, formData, 'Underlaget sparades.')
  }

  const submitFileEvidence = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (file) await uploadFileEvidence(file)
  }

  const submitDroppedEvidence = async (files: File[]) => {
    for (const file of files) {
      const uploaded = await uploadFileEvidence(file)
      if (!uploaded) break
    }
  }

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current
    if (recorder?.state === 'recording') recorder.stop()
  }

  const startRecording = async () => {
    if (isBusy || isRecording) return
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      showErrorToast('Röstinspelning stöds inte i den här webbläsaren.')
      return
    }

    setBusyAction('microphone')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const preferredType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) =>
        MediaRecorder.isTypeSupported(type)
      )
      const recorder = preferredType
        ? new MediaRecorder(stream, { mimeType: preferredType })
        : new MediaRecorder(stream)

      mediaStreamRef.current = stream
      mediaRecorderRef.current = recorder
      recordingChunksRef.current = []
      recordingStartedAtRef.current = Date.now()
      setRecordingSeconds(0)

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordingChunksRef.current.push(event.data)
      }
      recorder.onerror = () => {
        stream.getTracks().forEach((track) => track.stop())
        mediaStreamRef.current = null
        mediaRecorderRef.current = null
        setIsRecording(false)
        setBusyAction(null)
        showErrorToast('Inspelningen avbröts. Försök igen.')
      }
      recorder.onstop = () => {
        const durationSeconds = Math.max(
          1,
          Math.round((Date.now() - (recordingStartedAtRef.current ?? Date.now())) / 1000)
        )
        const contentType = recorder.mimeType || recordingChunksRef.current[0]?.type || 'audio/webm'
        const audio = new Blob(recordingChunksRef.current, { type: contentType })
        stream.getTracks().forEach((track) => track.stop())
        mediaStreamRef.current = null
        mediaRecorderRef.current = null
        recordingStartedAtRef.current = null
        recordingChunksRef.current = []
        setIsRecording(false)

        if (audio.size <= 0) {
          showErrorToast('Inspelningen blev tom. Försök igen.')
          return
        }
        if (audio.size > maxAttachmentBytes) {
          showErrorToast('Inspelningen är för stor. Spela in ett kortare meddelande.')
          return
        }

        const formData = new FormData()
        formData.append(
          'audio',
          new File([audio], `rostmeddelande.${recordingExtension(contentType)}`, { type: contentType })
        )
        formData.append('durationSeconds', String(durationSeconds))
        formData.append(
          'completionEvidence',
          String(matchesCompletionEvidenceRequirement(task, 'text'))
        )
        void uploadEvidence(
          'transcribe',
          `${endpoint}/transcribe`,
          formData,
          'Röstmeddelandet transkriberades.'
        )
      }

      recorder.start()
      setIsRecording(true)
      setBusyAction('recording')
    } catch (error) {
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
      mediaRecorderRef.current = null
      setBusyAction(null)
      const permissionDenied = error instanceof DOMException && ['NotAllowedError', 'SecurityError'].includes(error.name)
      showErrorToast(
        permissionDenied
          ? 'Tillåt mikrofonen i webbläsaren för att spela in ett röstmeddelande.'
          : 'Kunde inte starta mikrofonen.'
      )
    }
  }

  const openPanel = (nextPanel: Exclude<ActionPanel, null>) => {
    if (nextPanel === 'waiting') {
      const suggestedDate = addTaskDateInputDays(todayInput, 1)
      const suggestedTime = '09:00'
      const suggestedAt = taskDateTimeInputToIso(suggestedDate, suggestedTime, effectiveTimeZone)
      const boundedByDue = dueInput && suggestedAt && Date.parse(suggestedAt) > Date.parse(task.dueAt)
      setWaitingDate(boundedByDue ? dueInput.date : suggestedDate)
      setWaitingTime(boundedByDue ? dueInput.time : suggestedTime)
      setWaitingReason('')
    } else if (nextPanel === 'deadline') {
      const baseDate = dueInput?.date && dueInput.date > todayInput ? dueInput.date : todayInput
      setRequestedDueDate(addTaskDateInputDays(baseDate, 1))
      setRequestedDueTime(dueInput?.time ?? '16:00')
      setDeadlineReason('')
    } else {
      const suggestedDueDate = addTaskDateInputDays(creationTodayInput, 7)
      const suggestedDueTime = '16:00'
      const suggestedDueAt = taskDateTimeInputToIso(suggestedDueDate, suggestedDueTime, creationTimeZone)
      const boundedDue = parentDueInCreationZone && suggestedDueAt && Date.parse(suggestedDueAt) > Date.parse(task.dueAt)
        ? parentDueInCreationZone
        : { date: suggestedDueDate, time: suggestedDueTime }
      const suggestedFollowupDate = addTaskDateInputDays(creationTodayInput, 2)
      const suggestedFollowupTime = '09:00'
      const suggestedFollowupAt = taskDateTimeInputToIso(
        suggestedFollowupDate,
        suggestedFollowupTime,
        creationTimeZone
      )
      const boundedDueAt = taskDateTimeInputToIso(boundedDue.date, boundedDue.time, creationTimeZone)
      const boundedFollowup = suggestedFollowupAt && boundedDueAt && Date.parse(suggestedFollowupAt) > Date.parse(boundedDueAt)
        ? boundedDue
        : { date: suggestedFollowupDate, time: suggestedFollowupTime }
      setDelegateTitle('')
      setDelegateDescription('')
      setDelegateName('')
      setDelegateEmail('')
      setDelegatePhone('')
      setDelegateDueDate(boundedDue.date)
      setDelegateDueTime(boundedDue.time)
      setDelegateFollowupDate(boundedFollowup.date)
      setDelegateFollowupTime(boundedFollowup.time)
      setDelegatePrimaryChannel('email')
      setDelegateFallbackChannel('whatsapp')
      setDelegateEvidenceRequirements([])
    }
    setPanel(nextPanel)
  }

  const submitComment = async (event: FormEvent) => {
    event.preventDefault()
    const message = comment.trim()
    if (!message) return
    const ok = await runAction('comment', { taskId: task.id, message }, 'Kommentaren har skickats.')
    if (ok) setComment('')
  }

  const submitWaiting = async (event: FormEvent) => {
    event.preventDefault()
    if (!waitingReason.trim() || !waitingDate || !waitingTime || !waitingWindowOpen) return
    const nextFollowupAt = taskDateTimeInputToIso(waitingDate, waitingTime, effectiveTimeZone)
    if (!nextFollowupAt) {
      showErrorToast('Kontrollera datum och klockslag. Den valda tiden måste finnas i angiven tidszon.')
      return
    }
    if (Date.parse(nextFollowupAt) < Date.now() || Date.parse(nextFollowupAt) > Date.parse(task.dueAt)) {
      showErrorToast('Uppföljningen måste ligga framåt i tiden och senast vid uppdragets sluttid.')
      return
    }
    const ok = await runAction(
      'waiting',
      {
        taskId: task.id,
        message: waitingReason.trim(),
        nextFollowupAt,
        version: task.version,
      },
      'Uppgiften är markerad som väntande.'
    )
    if (ok) setPanel(null)
  }

  const submitDeadlineRequest = async (event: FormEvent) => {
    event.preventDefault()
    if (!deadlineReason.trim() || !requestedDueDate || !requestedDueTime) return
    const requestedDueAt = taskDateTimeInputToIso(requestedDueDate, requestedDueTime, effectiveTimeZone)
    if (!requestedDueAt) {
      showErrorToast('Kontrollera datum och klockslag. Den valda tiden måste finnas i angiven tidszon.')
      return
    }
    if (Date.parse(requestedDueAt) <= Math.max(Date.parse(task.dueAt), Date.now())) {
      showErrorToast('Den önskade sluttiden måste ligga framåt i tiden och efter uppdragets nuvarande sluttid.')
      return
    }
    const ok = await runAction(
      'request_deadline_change',
      {
        taskId: task.id,
        reason: deadlineReason.trim(),
        requestedDueAt,
      },
      'Din begäran har skickats till uppdragsansvarig.'
    )
    if (ok) setPanel(null)
  }

  const submitDelegation = async (event: FormEvent) => {
    event.preventDefault()
    const title = delegateTitle.trim()
    const name = delegateName.trim()
    const email = delegateEmail.trim()
    const phone = delegatePhone.trim()
    if (
      !title
      || !name
      || !delegateDueDate
      || !delegateDueTime
      || !delegateFollowupDate
      || !delegateFollowupTime
    ) return
    if (!email) {
      showErrorToast('E-post krävs för mottagarens Mina uppdrag-konto.')
      return
    }
    if (delegatePrimaryChannel === 'email' && !email) {
      showErrorToast('E-post krävs när huvudkanalen är e-post.')
      return
    }
    if (delegatePrimaryChannel === 'whatsapp' && !phone) {
      showErrorToast('Telefonnummer krävs när huvudkanalen är WhatsApp.')
      return
    }
    if (delegateFallbackChannel === delegatePrimaryChannel) {
      showErrorToast('Reservkanalen måste skilja sig från huvudkanalen.')
      return
    }
    if (delegateFallbackChannel === 'email' && !email) {
      showErrorToast('E-post krävs för att använda e-post som reservkanal.')
      return
    }
    if (delegateFallbackChannel === 'whatsapp' && !phone) {
      showErrorToast('Telefonnummer krävs för att använda WhatsApp som reservkanal.')
      return
    }

    const delegateDueAt = taskDateTimeInputToIso(delegateDueDate, delegateDueTime, creationTimeZone)
    const delegateFollowupAt = taskDateTimeInputToIso(
      delegateFollowupDate,
      delegateFollowupTime,
      creationTimeZone
    )
    if (!delegateDueAt || !delegateFollowupAt) {
      showErrorToast('Kontrollera datum och klockslag. Den valda tiden måste finnas i angiven tidszon.')
      return
    }
    if (
      Date.parse(delegateDueAt) <= Date.now()
      || Date.parse(delegateDueAt) > Date.parse(task.dueAt)
      || Date.parse(delegateFollowupAt) < Date.now()
      || Date.parse(delegateFollowupAt) > Date.parse(delegateDueAt)
    ) {
      showErrorToast('Tiderna måste ligga framåt i tiden och senast vid föräldrauppgiftens sluttid.')
      return
    }

    const ok = await runAction(
      'create_subtask',
      {
        parentTaskId: task.id,
        title,
        description: delegateDescription.trim(),
        assignee: {
          name,
          ...(email ? { email } : {}),
          ...(phone ? { phone } : {}),
        },
        dueAt: delegateDueAt,
        nextFollowupAt: delegateFollowupAt,
        primaryChannel: delegatePrimaryChannel,
        fallbackChannel: delegateFallbackChannel || null,
        evidenceRequirements: delegateEvidenceRequirements,
        version: task.version,
      },
      'Underuppgiften skapades och tilldelades.'
    )
    if (ok) setPanel(null)
  }

  if (workspace.accessState !== 'open') {
    const copy = accessClosedCopy(workspace.accessState)
    return (
      <main className="flex min-h-dvh items-center bg-[#f6f4ef] px-4 py-10 text-slate-950">
        <section className="mx-auto w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-900/5 sm:p-8">
          <SigneMark />
          <div className="mt-6 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-700">
            <Link2Off size={23} aria-hidden="true" />
          </div>
          <p className="mt-5 text-xs font-bold uppercase tracking-[0.2em] text-amber-700">Gizmo</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{copy.title}</h1>
          <p className="mt-3 text-sm leading-7 text-slate-600">{copy.text}</p>
        </section>
      </main>
    )
  }

  const activeForAssignee = ['assigned', 'in_progress', 'waiting', 'returned'].includes(task.status)
  const canStart = ['assigned', 'waiting', 'returned'].includes(task.status)
  const canMarkWaiting = ['assigned', 'in_progress', 'returned'].includes(task.status)
  const showActionBar = activeForAssignee
  const delegateHasContact = Boolean(delegateEmail.trim())
  const delegateChannelsCovered =
    (delegatePrimaryChannel !== 'email' || Boolean(delegateEmail.trim())) &&
    (delegatePrimaryChannel !== 'whatsapp' || Boolean(delegatePhone.trim())) &&
    (delegateFallbackChannel !== 'email' || Boolean(delegateEmail.trim())) &&
    (delegateFallbackChannel !== 'whatsapp' || Boolean(delegatePhone.trim())) &&
    delegateFallbackChannel !== delegatePrimaryChannel
  const delegateDueCandidate = taskDateTimeInputToIso(delegateDueDate, delegateDueTime, creationTimeZone)
  const delegateFollowupCandidate = taskDateTimeInputToIso(
    delegateFollowupDate,
    delegateFollowupTime,
    creationTimeZone
  )
  const delegateDueEpoch = delegateDueCandidate ? Date.parse(delegateDueCandidate) : Number.NaN
  const delegateFollowupEpoch = delegateFollowupCandidate
    ? Date.parse(delegateFollowupCandidate)
    : Number.NaN
  const delegateDatesValid = Boolean(
    delegateDueCandidate
    && delegateFollowupCandidate
    && delegateDueEpoch <= Date.parse(task.dueAt)
    && delegateFollowupEpoch <= delegateDueEpoch
  )
  const canSubmitDelegation = Boolean(
    delegateTitle.trim() &&
    delegateName.trim() &&
    delegateHasContact &&
    delegateChannelsCovered &&
    delegateDatesValid
  )

  const scrollToEvidence = () => {
    evidenceSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const scrollToComment = () => {
    commentInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    window.setTimeout(() => commentInputRef.current?.focus(), 350)
  }

  return (
    <main className={`min-h-dvh bg-[#f6f4ef] text-slate-950 ${showActionBar ? 'pb-[calc(6.5rem+env(safe-area-inset-bottom))]' : 'pb-8'}`}>
      <header className="border-b border-amber-200/70 bg-white/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-xl items-center gap-3 px-4 py-4 sm:px-6">
          {backHref ? (
            <Link
              href={backHref}
              className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
              aria-label={`Tillbaka till ${backLabel}`}
            >
              <ChevronLeft size={18} aria-hidden="true" />
              <span className="hidden sm:inline">{backLabel}</span>
            </Link>
          ) : null}
          <SigneMark />
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-700">Gizmo följer upp</p>
            <p className="mt-0.5 truncate text-sm text-slate-600">Hej {workspace.recipientName}</p>
          </div>
          {showRecipientAccountAction ? (
            <RecipientAccountAction
              account={workspace.recipientAccount}
              endpoint={endpoint}
              recipientName={workspace.recipientName}
            />
          ) : null}
        </div>
      </header>

      <div className="mx-auto w-full max-w-xl px-4 py-5 sm:px-6 sm:py-7">
        <TaskTimeProgress startedAt={task.createdAt} dueAt={task.dueAt} timeZone={effectiveTimeZone} />

        <section className="mt-3 overflow-hidden rounded-3xl border border-amber-200/80 bg-white shadow-xl shadow-amber-950/5">
          <div className="bg-gradient-to-br from-amber-50 via-white to-orange-50 px-5 py-5 sm:px-6">
            <div className="flex flex-wrap items-center gap-2">
              <TaskStatusBadge status={task.status} />
              {task.contextLabel ? <span className="text-xs font-semibold text-slate-500">{task.contextLabel}</span> : null}
            </div>
            <h1 className="mt-4 text-2xl font-semibold leading-tight tracking-tight text-slate-950 sm:text-3xl">{task.title}</h1>
            {task.description ? <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-700">{task.description}</p> : null}
          </div>

          <dl className="grid grid-cols-2 gap-px bg-slate-200">
            <div className="min-w-0 bg-white p-4">
              <dt className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500"><CalendarClock size={14} /> Ska vara klart</dt>
              <dd className="mt-2 text-sm font-semibold leading-5 text-slate-900">{formatTaskDateTime(task.dueAt, effectiveTimeZone)}</dd>
              <dd className="mt-1 text-xs text-slate-500">{taskTimeZoneLabel(effectiveTimeZone)}</dd>
            </div>
            <div className="min-w-0 bg-white p-4">
              <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Uppdragsansvarig</dt>
              <dd className="mt-2 break-words text-sm font-semibold text-slate-900">{task.issuerName}</dd>
            </div>
          </dl>
        </section>

        <section className="mt-4 rounded-3xl border border-indigo-200 bg-indigo-50 p-5 shadow-sm" aria-labelledby="recipient-next-step-heading">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-700">Ditt nästa steg</p>
          {activeForAssignee ? (
            <>
              <h2 id="recipient-next-step-heading" className="mt-2 text-lg font-semibold text-indigo-950">
                {prestartBlocked
                  ? 'Skicka in underlaget som behövs'
                  : canStart
                    ? task.status === 'waiting'
                      ? 'Återuppta uppdraget när du kan fortsätta'
                      : 'Bekräfta att du börjar med uppdraget'
                    : 'Dokumentera arbetet och skicka det för kontroll'}
              </h2>
              <p className="mt-2 text-sm leading-6 text-indigo-900">
                {prestartBlocked
                  ? 'Ladda upp offert eller annat efterfrågat dokument. Uppdragsansvarig kontrollerar underlaget innan arbetet får starta.'
                  : canStart
                    ? 'När du startar ser uppdragsansvarig att uppgiften är omhändertagen. Du kan fortfarande lägga till bilder, dokument och kommentarer.'
                    : 'Lägg till foto, dokument, text eller röstmeddelande. Välj sedan Klar för kontroll när uppgiften är färdig.'}
              </p>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                {prestartBlocked ? (
                  <button
                    type="button"
                    disabled={isBusy || isRecording}
                    onClick={() => documentInputRef.current?.click()}
                    className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-indigo-700 px-4 text-sm font-semibold text-white hover:bg-indigo-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Paperclip size={18} aria-hidden="true" /> Ladda upp offert eller dokument
                  </button>
                ) : canStart ? (
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void runAction('start', { taskId: task.id, version: task.version }, task.status === 'waiting' ? 'Uppgiften är återupptagen.' : 'Uppgiften är startad.')}
                    className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-indigo-700 px-4 text-sm font-semibold text-white hover:bg-indigo-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busyAction === 'start' ? <Loader2 className="animate-spin" size={18} /> : <ArrowRight size={18} />}
                    {task.status === 'waiting' ? 'Återuppta uppdraget' : 'Starta uppdraget'}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={isBusy || isRecording}
                    onClick={scrollToEvidence}
                    className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-indigo-700 px-4 text-sm font-semibold text-white hover:bg-indigo-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Camera size={18} aria-hidden="true" /> Lägg till underlag
                  </button>
                )}
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={scrollToComment}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-indigo-200 bg-white px-4 text-sm font-semibold text-indigo-900 hover:bg-indigo-100 disabled:opacity-50"
                >
                  <MessageSquareText size={18} aria-hidden="true" /> Skriv ett meddelande
                </button>
              </div>
            </>
          ) : (
            <>
              <h2 id="recipient-next-step-heading" className="mt-2 text-lg font-semibold text-indigo-950">
                {task.status === 'ready_for_review'
                  ? 'Uppgiften väntar på kontroll'
                  : task.status === 'approved'
                    ? 'Uppgiften är godkänd och klar'
                    : 'Uppgiften är avslutad'}
              </h2>
              <p className="mt-2 text-sm leading-6 text-indigo-900">
                {task.status === 'ready_for_review'
                  ? 'Uppdragsansvarig har bollen nu. Du behöver inte göra något om du inte får en begäran om rättning.'
                  : task.status === 'approved'
                    ? 'Uppdragsansvarig har kontrollerat och godkänt uppgiften.'
                    : 'Uppdraget har återkallats och kan inte längre ändras.'}
              </p>
            </>
          )}
        </section>

        {pendingDeadlineRequest ? (
          <section className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-start gap-3">
              <CalendarClock className="mt-0.5 shrink-0 text-amber-700" size={20} />
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-amber-950">Förlängning begärd till {formatTaskDateTime(pendingDeadlineRequest.requestedDueAt, effectiveTimeZone)}</h2>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-amber-900">{pendingDeadlineRequest.reason}</p>
                <p className="mt-2 text-xs font-semibold text-amber-700">Väntar på beslut från uppdragsansvarig.</p>
              </div>
            </div>
          </section>
        ) : null}

        {delegatedAccessUrl ? (
          <section className="mt-4 rounded-2xl border border-amber-200 bg-white p-4 shadow-sm">
            <p className="text-sm font-semibold text-slate-900">Personlig länk till den nya mottagaren</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">Dela länken manuellt om Gizmo inte kunde skicka den i vald kanal.</p>
            <div className="mt-3 flex gap-2">
              <input
                readOnly
                value={delegatedAccessUrl}
                aria-label="Personlig uppdragslänk"
                className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs text-slate-700"
              />
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(delegatedAccessUrl)
                    showSuccessToast('Länken kopierades.')
                  } catch {
                    showErrorToast('Markera och kopiera länken manuellt.')
                  }
                }}
                className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-slate-900 px-3 text-xs font-semibold text-white"
              >
                <Copy size={16} /> Kopiera
              </button>
            </div>
          </section>
        ) : null}

        <div className="mt-6">
          <TaskConversationCard
            headingId={`recipient-conversation-${task.id}`}
            messages={task.events}
            value={comment}
            onChange={setComment}
            onSubmit={submitComment}
            submitting={busyAction === 'comment'}
            canSend={conversationCanSend && !isBusy}
            disabledReason={
              conversationCanSend
                ? null
                : 'Uppdraget är avslutat och kan inte ta emot fler meddelanden.'
            }
            recipientLabel={task.issuerName}
            placeholder="Skriv en status eller fråga…"
            unreadCount={task.unreadMessageCount}
            latestIncomingMessageEventId={task.latestIncomingMessageEventId}
            onMarkRead={markMessagesRead}
            composerRef={commentInputRef}
          />
        </div>

        {task.requirements.length > 0 ? (
          <section className="mt-6" aria-labelledby="recipient-requirements-heading">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-700">Innan uppgiften avslutas</p>
                <h2 id="recipient-requirements-heading" className="mt-1 text-lg font-semibold">Kontrollpunkter</h2>
              </div>
              <span className="text-xs font-semibold text-slate-500">
                {task.requirements.filter((item) => requirementState(item.status, item.key).done).length}/{task.requirements.length}
              </span>
            </div>
            <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              {task.requirements.map((requirement) => {
                const state = requirementState(requirement.status, requirement.key)
                return (
                  <div key={requirement.id} className="flex min-h-16 items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-0">
                    {state.done ? <CheckCircle2 className="shrink-0 text-emerald-600" size={21} /> : <CircleDashed className="shrink-0 text-amber-500" size={21} />}
                    <div className="min-w-0">
                      <p className="text-sm font-semibold leading-5 text-slate-800">{requirement.label}</p>
                      <p className="mt-1 text-xs text-slate-500">{state.label}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        ) : null}

        <section ref={evidenceSectionRef} className="mt-6 scroll-mt-4" aria-labelledby="recipient-evidence-heading">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-700">Underlag i uppdraget</p>
            <h2 id="recipient-evidence-heading" className="mt-1 text-lg font-semibold">Bilagor och färdigbevis</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              Här finns bilder och dokument från uppdragsansvarig. Du kan också lägga till underlag som visar vad som har gjorts.
            </p>
          </div>

          {evidenceChecklist.length > 0 ? (
            <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-amber-800">Färdigbevis som krävs</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {evidenceChecklist.map(({ type, complete }) => (
                  <div key={type} className="flex min-h-11 items-center gap-2 rounded-xl bg-white px-3 text-sm font-semibold text-slate-800">
                    {complete ? (
                      <CheckCircle2 className="shrink-0 text-emerald-600" size={19} />
                    ) : (
                      <CircleDashed className="shrink-0 text-amber-500" size={19} />
                    )}
                    <span>
                      {type === 'photo' ? 'Foto' : type === 'document' ? 'Dokument' : 'Textredovisning'}
                      <span className="ml-1 text-xs font-medium text-slate-500">{complete ? 'klart' : 'saknas'}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {activeForAssignee ? (
            <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
              <TaskAttachmentDropZone
                accept={taskAttachmentAccept}
                title="Dra och släpp foto eller dokument här"
                activeTitle="Släpp för att ladda upp filerna"
                description="Du kan släppa flera filer samtidigt. Max 25 MB per fil."
                disabled={isBusy || isRecording}
                busy={busyAction === 'attachment'}
                onFiles={submitDroppedEvidence}
              />
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={isBusy || isRecording}
                  onClick={() => photoInputRef.current?.click()}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Camera size={18} aria-hidden="true" /> Ta foto
                </button>
                <button
                  type="button"
                  disabled={isBusy || isRecording}
                  onClick={() => documentInputRef.current?.click()}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Paperclip size={18} aria-hidden="true" /> Välj fil
                </button>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(event) => void submitFileEvidence(event)}
                  className="sr-only"
                  tabIndex={-1}
                />
                <input
                  ref={documentInputRef}
                  type="file"
                  accept={taskAttachmentAccept}
                  onChange={(event) => void submitFileEvidence(event)}
                  className="sr-only"
                  tabIndex={-1}
                />
              </div>

              <button
                type="button"
                disabled={isBusy && !isRecording}
                onClick={isRecording ? stopRecording : () => void startRecording()}
                className={`mt-2 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  isRecording
                    ? 'bg-rose-700 text-white hover:bg-rose-800'
                    : 'bg-amber-100 text-amber-950 hover:bg-amber-200'
                }`}
              >
                {busyAction === 'microphone' ? (
                  <Loader2 className="animate-spin" size={18} aria-hidden="true" />
                ) : isRecording ? (
                  <Square size={17} fill="currentColor" aria-hidden="true" />
                ) : (
                  <Mic size={18} aria-hidden="true" />
                )}
                {isRecording
                  ? `Stoppa och skicka · ${String(Math.floor(recordingSeconds / 60)).padStart(2, '0')}:${String(recordingSeconds % 60).padStart(2, '0')}`
                  : 'Spela in röstmeddelande'}
              </button>
              {isRecording ? (
                <p className="mt-2 text-center text-xs font-semibold text-rose-700" role="status">Inspelning pågår. Tryck på knappen när du är klar.</p>
              ) : null}

              <form onSubmit={submitTextEvidence} className="mt-3 border-t border-slate-100 pt-3">
                <label htmlFor="recipient-evidence-text" className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                  <FileText size={15} aria-hidden="true" /> Beskriv underlaget
                </label>
                <textarea
                  id="recipient-evidence-text"
                  value={evidenceText}
                  onChange={(event) => setEvidenceText(event.target.value)}
                  rows={3}
                  placeholder="Exempel: Vattenutkastaren är monterad och provtryckt."
                  className={`${inputClassName} mt-2 resize-y`}
                  disabled={isBusy || isRecording}
                />
                <button
                  type="submit"
                  disabled={isBusy || isRecording || !evidenceText.trim()}
                  className="mt-2 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busyAction === 'attachment' ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
                  Spara textunderlag
                </button>
              </form>
              <p className="mt-3 text-center text-[11px] leading-4 text-slate-500">Maximal filstorlek är 25 MB.</p>
            </div>
          ) : null}

          {task.attachments.length > 0 ? (
            <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              {task.attachments.map((attachment) => {
                const content = (
                  <>
                    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
                      {attachment.type === 'photo' ? (
                        <ImageIcon size={19} aria-hidden="true" />
                      ) : attachment.type === 'audio' ? (
                        <Mic size={19} aria-hidden="true" />
                      ) : (
                        <FileText size={19} aria-hidden="true" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-sm font-semibold text-slate-900">
                        {attachment.title || attachment.fileName || attachmentTypeLabel(attachment.type)}
                      </span>
                      <span className="mt-1 block text-xs text-slate-500">
                        {attachmentTypeLabel(attachment.type)} · {formatTaskDateTime(attachment.createdAt, effectiveTimeZone, 'compact')}
                      </span>
                      {attachment.isCompletionEvidence ? (
                        <span className="mt-1.5 inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">Färdigbevis</span>
                      ) : (
                        <span className="mt-1.5 inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Underlag</span>
                      )}
                    </span>
                    {attachment.type !== 'text' ? <ChevronRight className="shrink-0 text-slate-400" size={18} aria-hidden="true" /> : null}
                  </>
                )

                return (
                  <article key={attachment.id} className="border-b border-slate-100 last:border-0">
                    {attachment.type === 'text' ? (
                      <div className="flex items-start gap-3 px-4 py-3">{content}</div>
                    ) : (
                      <a
                        href={`${endpoint}/attachments/${attachment.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-slate-50"
                      >
                        {content}
                      </a>
                    )}
                    {attachment.textContent ? (
                      <p className="whitespace-pre-wrap px-4 pb-4 text-sm leading-6 text-slate-700">{attachment.textContent}</p>
                    ) : null}
                    {attachment.transcriptText ? (
                      <div className="mx-4 mb-4 rounded-xl bg-slate-50 px-3 py-2.5 text-sm leading-6 text-slate-700">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Transkribering</p>
                        <p className="mt-1 whitespace-pre-wrap">{attachment.transcriptText}</p>
                      </div>
                    ) : null}
                  </article>
                )
              })}
            </div>
          ) : (
            <p className="mt-3 rounded-2xl border border-dashed border-slate-300 bg-white/60 px-4 py-5 text-center text-sm text-slate-500">Inget underlag har lagts till ännu.</p>
          )}
        </section>

        {workspace.children.length > 0 || workspace.canDelegate ? (
          <section className="mt-6" aria-labelledby="recipient-children-heading">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 id="recipient-children-heading" className="text-lg font-semibold">Underuppgifter</h2>
                {workspace.canDelegate ? <p className="mt-1 text-sm leading-5 text-slate-600">Skapa ett underuppdrag till en mottagare. Du blir uppdragsansvarig för underuppgiften.</p> : null}
              </div>
              {workspace.canDelegate && activeForAssignee ? (
                <button
                  type="button"
                  disabled={isBusy || isRecording || !waitingWindowOpen}
                  onClick={() => openPanel('delegate')}
                  title={!waitingWindowOpen ? 'Föräldrauppgiftens slutdatum har passerat. Begär mer tid först.' : undefined}
                  className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-amber-100 px-3 text-sm font-semibold text-amber-950 hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <UserPlus size={17} aria-hidden="true" /> Delegera
                </button>
              ) : null}
            </div>
            {workspace.children.length > 0 ? (
              <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                {workspace.children.map((child) => (
                  <div key={child.id} className="flex min-h-16 items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-0">
                    <ChevronRight className="shrink-0 text-slate-400" size={18} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900">{child.title}</p>
                      <p className="mt-1 truncate text-xs text-slate-500">{child.assigneeName} · {formatTaskDateTime(child.dueAt, child.dueTimeZone, 'compact')}</p>
                    </div>
                    <TaskStatusBadge status={child.status} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 rounded-2xl border border-dashed border-slate-300 bg-white/60 px-4 py-5 text-center text-sm text-slate-500">Inga underuppgifter ännu.</p>
            )}
          </section>
        ) : null}

        <div className="mt-4">
          <TaskHistoryDisclosure events={task.events} />
        </div>

        {task.deadlineRequests.some((request) => request.status !== 'pending') ? (
          <details className="mt-6 rounded-2xl border border-slate-200 bg-white px-4 py-3">
            <summary className="cursor-pointer text-sm font-semibold text-slate-700">Tidigare datumförfrågningar</summary>
            <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
              {task.deadlineRequests.filter((request) => request.status !== 'pending').map((request) => (
                <div key={request.id} className="text-sm text-slate-600">
                  <p><span className="font-semibold text-slate-800">{formatTaskDateTime(request.requestedDueAt, effectiveTimeZone)}</span> · {deadlineRequestLabel(request.status)}</p>
                  <p className="mt-1">{request.reason}</p>
                </div>
              ))}
            </div>
          </details>
        ) : null}

        {readyForReviewBlocked && activeForAssignee ? (
          <div className="mt-6 flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
            <AlertTriangle className="mt-0.5 shrink-0" size={19} />
            <p>
              {!requirementsComplete && !childrenComplete
                ? 'Kontrollpunkterna och underuppgifterna behöver bli klara innan uppgiften kan skickas för kontroll.'
                : !requirementsComplete
                  ? 'Kontrollpunkterna behöver bli klara innan uppgiften kan skickas för kontroll.'
                  : 'Underuppgifterna behöver bli klara innan uppgiften kan skickas för kontroll.'}
            </p>
          </div>
        ) : null}

        {prestartBlocked && canStart ? (
          <div className="mt-4 flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
            <AlertTriangle className="mt-0.5 shrink-0" size={19} />
            <p>
              Uppdragsansvarig behöver kontrollera offert, beställargodkännande eller garantiunderlag innan arbetet kan startas.
            </p>
          </div>
        ) : null}

        <p className="mt-8 text-center text-xs leading-5 text-slate-500">Gizmo är den digitala uppföljningsassistenten för det här uppdraget.</p>
      </div>

      {showActionBar ? (
        <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-amber-200 bg-white/95 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 shadow-[0_-10px_30px_rgba(15,23,42,0.08)] backdrop-blur">
          <div className="mx-auto flex w-full max-w-xl gap-2 overflow-x-auto px-4 sm:px-6">
            {canStart ? (
              <button
                type="button"
                disabled={isBusy || prestartBlocked}
                onClick={() => void runAction('start', { taskId: task.id, version: task.version }, 'Uppgiften är startad.')}
                title={prestartBlocked ? 'Förberedande kontrollpunkter återstår.' : undefined}
                className="inline-flex min-h-12 shrink-0 items-center gap-2 rounded-2xl bg-indigo-700 px-4 text-sm font-semibold text-white hover:bg-indigo-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {busyAction === 'start' ? <Loader2 className="animate-spin" size={18} /> : <ArrowRight size={18} />}
                {task.status === 'waiting' ? 'Återuppta' : 'Starta'}
              </button>
            ) : null}
            <button
              type="button"
              disabled={isBusy || readyForReviewBlocked}
              onClick={() => void runAction('ready_for_review', { taskId: task.id, version: task.version }, 'Uppgiften har skickats för kontroll.')}
              title={readyForReviewBlocked ? 'Kontrollpunkter eller underuppgifter återstår.' : undefined}
              className="inline-flex min-h-12 shrink-0 items-center gap-2 rounded-2xl bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {busyAction === 'ready_for_review' ? <Loader2 className="animate-spin" size={18} /> : <Check size={18} />}
              Klar för kontroll
            </button>
            {canMarkWaiting ? (
              <button
                type="button"
                disabled={isBusy || !waitingWindowOpen}
                onClick={() => openPanel('waiting')}
                title={!waitingWindowOpen ? 'Slutdatumet har passerat. Begär mer tid först.' : undefined}
                className="inline-flex min-h-12 shrink-0 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Clock3 size={18} /> Väntar
              </button>
            ) : null}
            <button
              type="button"
              disabled={isBusy || Boolean(pendingDeadlineRequest)}
              onClick={() => openPanel('deadline')}
              className="inline-flex min-h-12 shrink-0 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <CalendarClock size={18} /> Begär mer tid
            </button>
          </div>
        </footer>
      ) : null}

      {panel ? (
        <div className="fixed inset-0 z-50 flex items-end bg-slate-950/55 p-0 backdrop-blur-[2px] sm:items-center sm:justify-center sm:p-4">
          <button type="button" className="absolute inset-0 cursor-default" onClick={isBusy ? undefined : () => setPanel(null)} aria-label="Stäng dialog" />
          <section role="dialog" aria-modal="true" aria-labelledby="recipient-action-title" className="relative max-h-[88dvh] w-full overflow-y-auto rounded-t-3xl bg-white px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-5 shadow-2xl sm:max-w-md sm:rounded-3xl sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-700">
                  {panel === 'delegate' ? 'Gizmo tilldelar vidare' : 'Gizmo meddelar uppdragsansvarig'}
                </p>
                <h2 id="recipient-action-title" className="mt-2 text-xl font-semibold">
                  {panel === 'waiting'
                    ? 'Vad väntar uppgiften på?'
                    : panel === 'deadline'
                      ? 'Begär nytt slutdatum'
                      : 'Delegera en underuppgift'}
                </h2>
              </div>
              <button type="button" onClick={() => setPanel(null)} disabled={isBusy} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 disabled:opacity-50" aria-label="Stäng">
                <X size={21} />
              </button>
            </div>

            {panel === 'waiting' ? (
              <form onSubmit={submitWaiting} className="mt-5 space-y-4">
                <label className="block text-sm font-semibold text-slate-700">
                  Orsak
                  <textarea value={waitingReason} onChange={(event) => setWaitingReason(event.target.value)} rows={3} placeholder="Exempel: väntar på materialleverans" className={`${inputClassName} mt-2 resize-y`} />
                </label>
                <fieldset className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5">
                  <legend className="px-1 text-sm font-semibold text-slate-700">När ska Gizmo följa upp igen?</legend>
                  <div className="mt-1 grid gap-3 min-[420px]:grid-cols-[minmax(0,1fr)_9rem]">
                    <label className="block min-w-0 text-sm font-semibold text-slate-700">
                      Datum
                      <input required type="date" min={todayInput} max={dueDateInput || undefined} value={waitingDate} onChange={(event) => setWaitingDate(event.target.value)} className={`${inputClassName} mt-2`} />
                    </label>
                    <label className="block min-w-0 text-sm font-semibold text-slate-700">
                      Klockslag
                      <input required type="time" step={60} max={waitingMaxTime} value={waitingTime} onChange={(event) => setWaitingTime(event.target.value)} className={`${inputClassName} mt-2`} />
                    </label>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">{taskTimeZoneLabel(effectiveTimeZone)}</p>
                </fieldset>
                {!waitingWindowOpen ? <p className="text-sm text-rose-700">Slutdatumet har passerat. Begär ett nytt slutdatum först.</p> : null}
                <button type="submit" disabled={isBusy || !waitingReason.trim() || !waitingDate || !waitingTime || !waitingWindowOpen} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
                  {busyAction === 'waiting' ? <Loader2 className="animate-spin" size={18} /> : <Clock3 size={18} />}
                  Spara vänteläge
                </button>
              </form>
            ) : panel === 'deadline' ? (
              <form onSubmit={submitDeadlineRequest} className="mt-5 space-y-4">
                <fieldset className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5">
                  <legend className="px-1 text-sm font-semibold text-slate-700">Önskad ny sluttid</legend>
                  <div className="mt-1 grid gap-3 min-[420px]:grid-cols-[minmax(0,1fr)_9rem]">
                    <label className="block min-w-0 text-sm font-semibold text-slate-700">
                      Datum
                      <input required type="date" min={deadlineMinDate} value={requestedDueDate} onChange={(event) => setRequestedDueDate(event.target.value)} className={`${inputClassName} mt-2`} />
                    </label>
                    <label className="block min-w-0 text-sm font-semibold text-slate-700">
                      Klockslag
                      <input required type="time" step={60} min={requestedDueMinTime} value={requestedDueTime} onChange={(event) => setRequestedDueTime(event.target.value)} className={`${inputClassName} mt-2`} />
                    </label>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">{taskTimeZoneLabel(effectiveTimeZone)}</p>
                </fieldset>
                <label className="block text-sm font-semibold text-slate-700">
                  Varför behövs mer tid?
                  <textarea value={deadlineReason} onChange={(event) => setDeadlineReason(event.target.value)} rows={3} placeholder="Beskriv orsaken kort" className={`${inputClassName} mt-2 resize-y`} />
                </label>
                <p className="text-xs leading-5 text-slate-500">Slutdatumet ändras först när {task.issuerName} har godkänt begäran.</p>
                <button type="submit" disabled={isBusy || !deadlineReason.trim() || !requestedDueDate || !requestedDueTime} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
                  {busyAction === 'request_deadline_change' ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
                  Skicka begäran
                </button>
              </form>
            ) : (
              <form onSubmit={submitDelegation} className="mt-5 space-y-4">
                <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-900">
                  Den nya mottagaren får en egen personlig länk. Du blir uppdragsansvarig för underuppgiften. Föräldrauppgiftens sluttid är {formatTaskDateTime(task.dueAt, effectiveTimeZone)} ({taskTimeZoneLabel(effectiveTimeZone)}); underuppgiften kan inte gå förbi samma tidpunkt.
                </p>

                <label className="block text-sm font-semibold text-slate-700">
                  Vad ska göras?
                  <input
                    autoFocus
                    required
                    value={delegateTitle}
                    onChange={(event) => setDelegateTitle(event.target.value)}
                    placeholder="Exempel: Ta fram skriftlig offert"
                    className={`${inputClassName} mt-2`}
                  />
                </label>
                <label className="block text-sm font-semibold text-slate-700">
                  Beskrivning, frivilligt
                  <textarea
                    value={delegateDescription}
                    onChange={(event) => setDelegateDescription(event.target.value)}
                    rows={3}
                    placeholder="Beskriv önskat resultat och viktig bakgrund."
                    className={`${inputClassName} mt-2 resize-y`}
                  />
                </label>

                <fieldset className="rounded-2xl border border-slate-200 p-3">
                  <legend className="px-1 text-sm font-semibold text-slate-700">Ny extern mottagare</legend>
                  <div className="mt-2 space-y-3">
                    <label className="block text-sm font-semibold text-slate-700">
                      Namn
                      <input
                        required
                        value={delegateName}
                        onChange={(event) => setDelegateName(event.target.value)}
                        autoComplete="name"
                        className={`${inputClassName} mt-2`}
                      />
                    </label>
                    <label className="block text-sm font-semibold text-slate-700">
                      E-post
                      <input
                        type="email"
                        value={delegateEmail}
                        onChange={(event) => setDelegateEmail(event.target.value)}
                        autoComplete="email"
                        inputMode="email"
                        placeholder="namn@foretag.se"
                        className={`${inputClassName} mt-2`}
                      />
                    </label>
                    <label className="block text-sm font-semibold text-slate-700">
                      Telefon / WhatsApp
                      <input
                        type="tel"
                        value={delegatePhone}
                        onChange={(event) => setDelegatePhone(event.target.value)}
                        autoComplete="tel"
                        inputMode="tel"
                        placeholder="+46 70 123 45 67"
                        className={`${inputClassName} mt-2`}
                      />
                    </label>
                    {!delegateHasContact ? (
                      <p className="text-xs text-slate-500">E-post krävs för mottagarens Mina uppdrag-konto.</p>
                    ) : (
                      <p className="text-xs text-slate-500">Första kontoaktiveringen skickas alltid via e-post.</p>
                    )}
                  </div>
                </fieldset>

                <div className="grid gap-3">
                  <fieldset className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5">
                    <legend className="px-1 text-sm font-semibold text-slate-700">Underuppgiften ska vara klar</legend>
                    <div className="mt-1 grid gap-3 min-[420px]:grid-cols-[minmax(0,1fr)_9rem]">
                      <label className="block min-w-0 text-sm font-semibold text-slate-700">
                        Datum
                        <input
                          required
                          type="date"
                          min={creationTodayInput}
                          max={parentDueInCreationZone?.date}
                          value={delegateDueDate}
                          onChange={(event) => {
                            const nextDate = event.target.value
                            const nextTime = parentDueInCreationZone
                              && nextDate === parentDueInCreationZone.date
                              && delegateDueTime > parentDueInCreationZone.time
                              ? parentDueInCreationZone.time
                              : delegateDueTime
                            setDelegateDueDate(nextDate)
                            setDelegateDueTime(nextTime)
                            if (
                              delegateFollowupDate > nextDate
                              || (delegateFollowupDate === nextDate && delegateFollowupTime > nextTime)
                            ) {
                              setDelegateFollowupDate(nextDate)
                              setDelegateFollowupTime(nextTime)
                            }
                          }}
                          className={`${inputClassName} mt-2 px-3`}
                        />
                      </label>
                      <label className="block min-w-0 text-sm font-semibold text-slate-700">
                        Klockslag
                        <input
                          required
                          type="time"
                          step={60}
                          max={delegateDueMaxTime}
                          value={delegateDueTime}
                          onChange={(event) => {
                            const nextTime = event.target.value
                            setDelegateDueTime(nextTime)
                            if (delegateFollowupDate === delegateDueDate && delegateFollowupTime > nextTime) {
                              setDelegateFollowupTime(nextTime)
                            }
                          }}
                          className={`${inputClassName} mt-2 px-3`}
                        />
                      </label>
                    </div>
                  </fieldset>

                  <fieldset className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5">
                    <legend className="px-1 text-sm font-semibold text-slate-700">Gizmo följer upp underuppgiften</legend>
                    <div className="mt-1 grid gap-3 min-[420px]:grid-cols-[minmax(0,1fr)_9rem]">
                      <label className="block min-w-0 text-sm font-semibold text-slate-700">
                        Datum
                        <input
                          required
                          type="date"
                          min={creationTodayInput}
                          max={delegateDueDate || parentDueInCreationZone?.date}
                          value={delegateFollowupDate}
                          onChange={(event) => setDelegateFollowupDate(event.target.value)}
                          className={`${inputClassName} mt-2 px-3`}
                        />
                      </label>
                      <label className="block min-w-0 text-sm font-semibold text-slate-700">
                        Klockslag
                        <input
                          required
                          type="time"
                          step={60}
                          max={delegateFollowupMaxTime}
                          value={delegateFollowupTime}
                          onChange={(event) => setDelegateFollowupTime(event.target.value)}
                          className={`${inputClassName} mt-2 px-3`}
                        />
                      </label>
                    </div>
                  </fieldset>
                  <p className="text-xs text-slate-500">Underuppgiftens tider anges i {taskTimeZoneLabel(creationTimeZone)}.</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block min-w-0 text-sm font-semibold text-slate-700">
                    Huvudkanal
                    <select
                      value={delegatePrimaryChannel}
                      onChange={(event) => {
                        const channel = event.target.value as TaskChannel
                        setDelegatePrimaryChannel(channel)
                        if (delegateFallbackChannel === channel) setDelegateFallbackChannel('')
                      }}
                      className={`${inputClassName} mt-2 px-3`}
                    >
                      <option value="email">E-post</option>
                      <option value="whatsapp">WhatsApp</option>
                    </select>
                  </label>
                  <label className="block min-w-0 text-sm font-semibold text-slate-700">
                    Reservkanal
                    <select
                      value={delegateFallbackChannel}
                      onChange={(event) => setDelegateFallbackChannel(event.target.value as TaskChannel | '')}
                      className={`${inputClassName} mt-2 px-3`}
                    >
                      <option value="">Ingen</option>
                      {delegatePrimaryChannel !== 'email' ? <option value="email">E-post</option> : null}
                      {delegatePrimaryChannel !== 'whatsapp' ? <option value="whatsapp">WhatsApp</option> : null}
                    </select>
                  </label>
                </div>

                <fieldset className="rounded-2xl border border-slate-200 bg-white p-4">
                  <legend className="px-1 text-sm font-semibold text-slate-700">Krav på färdigbevis</legend>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    Markera allt som den nya mottagaren måste lämna. Tomt innebär frivilligt.
                  </p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    {([
                      ['photo', 'Foto'],
                      ['document', 'Dokument'],
                      ['text', 'Textredovisning'],
                    ] as const).map(([value, label]) => {
                      const checked = delegateEvidenceRequirements.includes(value)
                      return (
                        <label
                          key={value}
                          className={`flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold ${
                            checked
                              ? 'border-amber-400 bg-amber-50 text-amber-950'
                              : 'border-slate-200 bg-slate-50 text-slate-700'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setDelegateEvidenceRequirements((current) =>
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

                {!delegateChannelsCovered && delegateHasContact ? (
                  <p className="text-sm leading-5 text-rose-700">Kontaktuppgifterna måste stödja valda kommunikationskanaler.</p>
                ) : null}
                <button
                  type="submit"
                  disabled={isBusy || !canSubmitDelegation}
                  className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busyAction === 'create_subtask' ? <Loader2 className="animate-spin" size={18} /> : <UserPlus size={18} />}
                  {busyAction === 'create_subtask' ? 'Skapar underuppgift…' : 'Skapa och tilldela'}
                </button>
              </form>
            )}
          </section>
        </div>
      ) : null}
    </main>
  )
}
