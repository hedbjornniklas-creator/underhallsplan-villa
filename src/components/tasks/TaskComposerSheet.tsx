'use client'

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { CalendarClock, ChevronDown, UserPlus, X } from 'lucide-react'
import type {
  TaskChannel,
  TaskAiSuggestionView,
  TaskEvidenceRequirement,
  TaskKind,
  TaskPerson,
  TaskView,
} from '@/lib/tasks/contracts'

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
  evidenceRequirement: TaskEvidenceRequirement
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
  const [evidenceRequirement, setEvidenceRequirement] = useState<TaskEvidenceRequirement>('optional')

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
    ((primaryChannel !== 'email' && fallbackChannel !== 'email') || Boolean(externalEmail)) &&
      ((primaryChannel !== 'whatsapp' && fallbackChannel !== 'whatsapp') || Boolean(externalPhone))

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
      evidenceRequirement,
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
                Du blir uppdragsansvarig. Mottagaren är den person som ska agera på uppdraget.
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
                          {person.name}
                        </option>
                      ))}
                  </optgroup>
                  <optgroup label="Externa kontakter">
                    {people
                      .filter((person) => person.kind === 'contact' && person.isActive)
                      .map((person) => (
                        <option key={`contact:${person.id}`} value={`contact:${person.id}`}>
                          {person.name}{person.companyName ? ` – ${person.companyName}` : ''}
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
                    <span className="mb-1 block text-xs font-semibold text-slate-600">E-post</span>
                    <input type="email" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} className={inputClass} />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-slate-600">Telefon / WhatsApp</span>
                    <input type="tel" value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} className={inputClass} />
                  </label>
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
                Den externa kontakten saknar uppgift för vald huvud- eller reservkanal.
              </p>
            ) : null}

            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-slate-800">Krav på färdigbevis</span>
              <select
                value={evidenceRequirement}
                onChange={(event) => setEvidenceRequirement(event.target.value as TaskEvidenceRequirement)}
                className={inputClass}
              >
                <option value="optional">Frivilligt</option>
                <option value="photo">Foto</option>
                <option value="document">Dokument</option>
                <option value="text">Textredovisning</option>
                <option value="any">Valfritt bevis krävs</option>
              </select>
            </label>
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
