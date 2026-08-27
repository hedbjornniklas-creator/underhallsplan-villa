'use client'

import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { CalendarClock, Camera, ChevronDown, FileText, Image as ImageIcon, Paperclip, Trash2, UserPlus, X } from 'lucide-react'
import type {
  TaskChannel,
  TaskAiSuggestionView,
  TaskCompletionEvidenceType,
  TaskKind,
  TaskPerson,
  TaskView,
} from '@/lib/tasks/contracts'
import TaskAttachmentDropZone from './TaskAttachmentDropZone'

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
  evidenceRequirements: TaskCompletionEvidenceType[]
  attachments: File[]
}

type Props = {
  open: boolean
  parentTask: TaskView | null
  suggestion: TaskAiSuggestionView | null
  people: TaskPerson[]
  currentUserId: string
  busy: boolean
  onClose: () => void
  onCreate: (payload: CreatePayload) => Promise<void>
}

function toDateInput(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function fromDateInput(value: string) {
  return new Date(`${value}T12:00:00`).toISOString()
}

function addDays(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return toDateInput(date)
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
  busy,
  onClose,
  onCreate,
}: Props) {
  const defaultAssignee = useMemo(() => {
    const current = people.find((person) => person.kind === 'profile' && person.id === currentUserId)
    const firstInternal = people.find((person) => person.kind === 'profile' && person.isActive)
    return current ?? firstInternal ?? people.find((person) => person.isActive) ?? null
  }, [currentUserId, people])
  const initialDueDate = parentTask ? toDateInput(new Date(parentTask.dueAt)) : addDays(7)
  const initialFollowupDate = addDays(2) > initialDueDate ? initialDueDate : addDays(2)
  const [title, setTitle] = useState(suggestion?.title ?? '')
  const [description, setDescription] = useState(suggestion?.description ?? '')
  const [contextLabel, setContextLabel] = useState(parentTask?.contextLabel ?? '')
  const [taskKind, setTaskKind] = useState<TaskKind>(parentTask?.taskKind ?? 'simple')
  const [assigneeRef, setAssigneeRef] = useState(
    defaultAssignee ? `${defaultAssignee.kind}:${defaultAssignee.id}` : 'new_contact'
  )
  const [contactName, setContactName] = useState('')
  const [contactCompany, setContactCompany] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [dueDate, setDueDate] = useState(initialDueDate)
  const [followupDate, setFollowupDate] = useState(initialFollowupDate)
  const [primaryChannel, setPrimaryChannel] = useState<TaskChannel>('email')
  const [fallbackChannel, setFallbackChannel] = useState<TaskChannel | ''>('whatsapp')
  const [evidenceRequirements, setEvidenceRequirements] = useState<TaskCompletionEvidenceType[]>([])
  const [attachments, setAttachments] = useState<File[]>([])
  const [attachmentError, setAttachmentError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [busy, onClose, open])

  if (!open) return null

  const maxDueDate = parentTask ? toDateInput(new Date(parentTask.dueAt)) : undefined
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

  const addAttachmentFiles = (selected: File[]) => {
    if (selected.length === 0) return

    const unsupported = selected.filter((file) => !supportedInitialAttachment(file))
    const empty = selected.filter((file) => file.size <= 0)
    const tooLarge = selected.filter((file) => file.size > MAX_ATTACHMENT_BYTES)
    const valid = selected.filter(
      (file) => supportedInitialAttachment(file) && file.size > 0 && file.size <= MAX_ATTACHMENT_BYTES
    )
    const existing = new Set(attachments.map(fileKey))
    const unique = valid.filter((file) => !existing.has(fileKey(file)))
    const available = Math.max(0, MAX_INITIAL_ATTACHMENTS - attachments.length)
    let totalBytes = attachments.reduce((sum, file) => sum + file.size, 0)
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

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim() || !assigneeRef || !dueDate || !followupDate) return
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
      dueAt: fromDateInput(dueDate),
      nextFollowupAt: fromDateInput(followupDate),
      primaryChannel,
      fallbackChannel,
      evidenceRequirements,
      attachments,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-slate-950/45 backdrop-blur-[2px] sm:items-center sm:justify-center sm:p-6">
      <button className="absolute inset-0 cursor-default" aria-label="Stäng" onClick={busy ? undefined : onClose} />
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
            onClick={onClose}
            disabled={busy}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 disabled:opacity-50"
            aria-label="Stäng"
          >
            <X size={22} />
          </button>
        </header>

        <form onSubmit={submit} className="max-h-[calc(94dvh-77px)] overflow-y-auto px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-5 sm:px-6">
          <div className="space-y-5">
            {suggestion ? (
              <div className="rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm leading-6 text-violet-950">
                <p className="font-semibold">Utgår från ett Signe-förslag</p>
                <p className="mt-0.5 text-xs leading-5 text-violet-800">
                  Du kan ändra alla fält. Förslaget markeras som använt först när underuppgiften har skapats.
                </p>
              </div>
            ) : null}
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-slate-800">Uppgift</span>
              <input
                autoFocus
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
              <label className="block">
                <span className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <CalendarClock size={16} /> Slutdatum
                </span>
                <input
                  required
                  type="date"
                  min={toDateInput(new Date())}
                  max={maxDueDate}
                  value={dueDate}
                  onChange={(event) => {
                    setDueDate(event.target.value)
                    if (followupDate > event.target.value) setFollowupDate(event.target.value)
                  }}
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <CalendarClock size={16} /> Nästa uppföljning
                </span>
                <input
                  required
                  type="date"
                  min={toDateInput(new Date())}
                  max={dueDate || maxDueDate}
                  value={followupDate}
                  onChange={(event) => setFollowupDate(event.target.value)}
                  className={inputClass}
                />
              </label>
            </div>

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
                Första kontoaktiveringen skickas alltid till mottagarens e-post. När kontot är aktiverat använder Signe vald huvud- och reservkanal.
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
                  disabled={busy}
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
                  <p className="text-right text-xs text-slate-500">{attachments.length} av {MAX_INITIAL_ATTACHMENTS} filer</p>
                </div>
              ) : null}
            </fieldset>
          </div>

          <div className="sticky bottom-0 -mx-5 mt-6 border-t border-slate-200 bg-white/95 px-5 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:-mx-6 sm:px-6">
            <button
              type="submit"
              disabled={busy || !title.trim() || !assigneeRef || !externalChannelsCovered}
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white shadow-lg shadow-slate-900/15 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <UserPlus size={18} />
              {busy ? 'Skapar…' : parentTask ? 'Skapa underuppgift' : 'Skapa och tilldela'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
