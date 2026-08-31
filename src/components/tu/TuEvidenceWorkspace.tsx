'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  Plus,
  Ruler,
  Search,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import TuFieldEntryComposer from '@/components/tu/TuFieldEntryComposer'
import type { TuFieldQueueController } from '@/hooks/useTuFieldQueue'
import type {
  TuEvidenceAiSuggestion,
  TuEvidenceResponse,
  TuMeasurement,
  TuObservation,
  TuObservationCertainty,
} from '@/lib/tu/evidence'

type EvidenceSection = {
  id: string
  key: string
  title: string
  text: string
}

export type TuEvidenceImage = {
  id: string
  sectionKey: 'bank' | 'appendix' | 'cover'
  publicUrl: string
  caption: string | null
}

type ObservationForm = {
  id: string | null
  location: string
  buildingComponent: string
  noteText: string
  transcriptText: string
  riskNote: string
  suggestedFollowUp: string
  certainty: TuObservationCertainty
  reviewStatus: 'draft' | 'reviewed'
  targetSectionId: string
  includeInReport: boolean
  imageIds: string[]
  audioStorageBucket: string
  audioStoragePath: string
  audioContentType: string
  audioDurationSeconds: number | null
}

type MeasurementForm = {
  measurementType: string
  valueText: string
  unit: string
  method: string
  instrument: string
  note: string
}

type ObservationFilter = 'needs_review' | 'reviewed' | 'all'

type Props = {
  inspectionId: string
  refreshToken?: number
  locked: boolean
  queue: TuFieldQueueController
  sections: EvidenceSection[]
  images: TuEvidenceImage[]
  imageBusy: boolean
  onUploadImages: (files: File[]) => Promise<string[]>
  onSetImageSection: (imageId: string, sectionKey: 'bank' | 'appendix' | 'cover') => Promise<void>
  onPreviewImage: (imageId: string) => void
  onApplySuggestion: (
    sectionId: string,
    text: string,
    mode: 'replace' | 'append'
  ) => Promise<void>
  onOpenReport: (sectionId?: string) => void
  onOpenAnalysis: () => void
  enableSectionAi?: boolean
}

const EMPTY_MEASUREMENT: MeasurementForm = {
  measurementType: '',
  valueText: '',
  unit: '',
  method: '',
  instrument: '',
  note: '',
}

const REVIEW_INVALIDATING_FIELDS = new Set<keyof ObservationForm>([
  'location',
  'buildingComponent',
  'noteText',
  'transcriptText',
  'imageIds',
])

function defaultSectionId(sections: EvidenceSection[]) {
  return (
    sections.find((section) => section.key === 'observed_execution')?.id ??
    sections.find((section) => !['assignment_parties', 'signature'].includes(section.key))?.id ??
    ''
  )
}

function defaultAiSectionId(sections: EvidenceSection[]) {
  return (
    sections.find((section) => section.key === 'technical_assessment')?.id ??
    defaultSectionId(sections)
  )
}

function createEmptyObservation(sections: EvidenceSection[]): ObservationForm {
  return {
    id: null,
    location: '',
    buildingComponent: '',
    noteText: '',
    transcriptText: '',
    riskNote: '',
    suggestedFollowUp: '',
    certainty: 'uncertain',
    reviewStatus: 'draft',
    targetSectionId: defaultSectionId(sections),
    includeInReport: true,
    imageIds: [],
    audioStorageBucket: '',
    audioStoragePath: '',
    audioContentType: '',
    audioDurationSeconds: null,
  }
}

function toObservationForm(observation: TuObservation): ObservationForm {
  return {
    id: observation.id,
    location: observation.location ?? '',
    buildingComponent: observation.buildingComponent ?? '',
    noteText: observation.noteText,
    transcriptText: observation.transcriptText ?? '',
    riskNote: observation.riskNote ?? '',
    suggestedFollowUp: observation.suggestedFollowUp ?? '',
    certainty: observation.certainty,
    reviewStatus: observation.reviewStatus,
    targetSectionId: observation.targetSectionId ?? '',
    includeInReport: observation.includeInReport,
    imageIds: observation.imageIds,
    audioStorageBucket: observation.audioStorageBucket ?? '',
    audioStoragePath: observation.audioStoragePath ?? '',
    audioContentType: observation.audioContentType ?? '',
    audioDurationSeconds: observation.audioDurationSeconds,
  }
}

function formatObservationTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('sv-SE', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function getObservationTitle(observation: TuObservation) {
  return observation.location || observation.buildingComponent || 'Fältpost utan plats'
}

function getObservationPreview(observation: TuObservation) {
  return observation.noteText || observation.transcriptText || 'Endast bilddokumentation'
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json().catch(() => ({}))) as T
}

export default function TuEvidenceWorkspace({
  inspectionId,
  refreshToken = 0,
  locked,
  queue,
  sections,
  images,
  imageBusy,
  onUploadImages,
  onSetImageSection,
  onPreviewImage,
  onApplySuggestion,
  onOpenReport,
  onOpenAnalysis,
  enableSectionAi = false,
}: Props) {
  const editableSections = useMemo(
    () => sections.filter((section) => !['assignment_parties', 'signature'].includes(section.key)),
    [sections]
  )
  const [observations, setObservations] = useState<TuObservation[]>([])
  const [form, setForm] = useState<ObservationForm>(() => createEmptyObservation(sections))
  const [measurementForm, setMeasurementForm] = useState<MeasurementForm>(EMPTY_MEASUREMENT)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [measurementBusy, setMeasurementBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedMessage, setSavedMessage] = useState<string | null>(null)
  const [aiSectionId, setAiSectionId] = useState(() => defaultAiSectionId(sections))
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [suggestion, setSuggestion] = useState<TuEvidenceAiSuggestion | null>(null)
  const [suggestionBusy, setSuggestionBusy] = useState(false)
  const [analysisApproved, setAnalysisApproved] = useState(false)
  const [imageSectionActionIds, setImageSectionActionIds] = useState<Set<string>>(() => new Set())
  const [observationFilter, setObservationFilter] = useState<ObservationFilter>('needs_review')
  const [observationSearch, setObservationSearch] = useState('')
  const [imagePickerOpen, setImagePickerOpen] = useState(false)
  const [fieldEntryDialogOpen, setFieldEntryDialogOpen] = useState(false)
  const [observationPanelOpen, setObservationPanelOpen] = useState(false)
  const imageInputRef = useRef<HTMLInputElement>(null)

  const loadObservations = useCallback(async (preferredId?: string | null) => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/tu/investigations/${inspectionId}/observations`)
      const payload = await readJson<TuEvidenceResponse>(response)
      if (!response.ok) throw new Error(payload.error ?? 'Kunde inte hämta besiktningsunderlaget.')
      const next = payload.observations ?? []
      setObservations(next)
      const selectedId = preferredId === undefined ? form.id : preferredId
      const selected =
        (selectedId ? next.find((observation) => observation.id === selectedId) : null)
        ?? next.find((observation) => observation.reviewStatus !== 'reviewed')
        ?? next[0]
        ?? null
      setForm(selected ? toObservationForm(selected) : createEmptyObservation(sections))
      return next
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Kunde inte hämta besiktningsunderlaget.')
    } finally {
      setLoading(false)
    }
  }, [form.id, inspectionId, sections])

  const refreshObservationList = useCallback(async () => {
    try {
      const response = await fetch(`/api/tu/investigations/${inspectionId}/observations`)
      const payload = await readJson<TuEvidenceResponse>(response)
      if (!response.ok) throw new Error(payload.error ?? 'Kunde inte uppdatera besiktningsunderlaget.')
      const next = payload.observations ?? []
      setObservations(next)
      setForm((current) => {
        if (current.id) return current
        const selected =
          next.find((observation) => observation.reviewStatus !== 'reviewed')
          ?? next[0]
          ?? null
        return selected ? toObservationForm(selected) : current
      })
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : 'Kunde inte uppdatera besiktningsunderlaget.'
      )
    }
  }, [inspectionId])

  useEffect(() => {
    void loadObservations(null)
    // The workspace owns its refresh lifecycle; form selection must not retrigger initial loading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspectionId])

  useEffect(() => {
    if (refreshToken <= 0) return
    void refreshObservationList()
  }, [refreshObservationList, refreshToken])

  useEffect(() => {
    if (!fieldEntryDialogOpen && !observationPanelOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusTimer = fieldEntryDialogOpen
      ? window.setTimeout(() => {
          document.getElementById('tu-evidence-field-entry-note')?.focus({ preventScroll: true })
        }, 50)
      : null
    return () => {
      if (focusTimer !== null) window.clearTimeout(focusTimer)
      document.body.style.overflow = previousOverflow
    }
  }, [fieldEntryDialogOpen, observationPanelOpen])

  useEffect(() => {
    let cancelled = false
    async function loadAnalysisStatus() {
      try {
        const response = await fetch(`/api/tu/investigations/${inspectionId}/analysis`, {
          cache: 'no-store',
        })
        if (!response.ok) return
        const payload = await readJson<{ workflow?: { status?: string } }>(response)
        if (!cancelled) setAnalysisApproved(payload.workflow?.status === 'analysis_approved')
      } catch {
        // Section drafting remains available without the optional holistic analysis.
      }
    }
    void loadAnalysisStatus()
    return () => {
      cancelled = true
    }
  }, [inspectionId, refreshToken])

  const selectedObservation = form.id
    ? observations.find((observation) => observation.id === form.id) ?? null
    : null
  const reviewedCount = observations.filter((observation) => observation.reviewStatus === 'reviewed').length
  const linkedImages = images.filter((image) => form.imageIds.includes(image.id))
  const needsReviewCount = observations.length - reviewedCount
  const nextUnreviewedObservation = observations.find(
    (observation) => observation.reviewStatus !== 'reviewed' && observation.id !== form.id
  ) ?? null
  const filteredObservations = useMemo(() => {
    const query = observationSearch.trim().toLocaleLowerCase('sv-SE')
    return observations.filter((observation) => {
      if (observationFilter === 'needs_review' && observation.reviewStatus === 'reviewed') return false
      if (observationFilter === 'reviewed' && observation.reviewStatus !== 'reviewed') return false
      if (!query) return true
      return [
        observation.location,
        observation.buildingComponent,
        observation.noteText,
        observation.transcriptText,
      ].some((value) => value?.toLocaleLowerCase('sv-SE').includes(query))
    })
  }, [observationFilter, observationSearch, observations])
  const formDirty = useMemo(() => {
    if (selectedObservation) {
      return JSON.stringify(form) !== JSON.stringify(toObservationForm(selectedObservation))
    }
    return Boolean(
      form.location.trim()
      || form.buildingComponent.trim()
      || form.noteText.trim()
      || form.transcriptText.trim()
      || form.riskNote.trim()
      || form.suggestedFollowUp.trim()
      || form.imageIds.length > 0
      || form.audioStoragePath
    )
  }, [form, selectedObservation])

  const updateForm = <K extends keyof ObservationForm>(key: K, value: ObservationForm[K]) => {
    setSavedMessage(null)
    setForm((current) => ({
      ...current,
      [key]: value,
      reviewStatus:
        current.id && current.reviewStatus === 'reviewed' && REVIEW_INVALIDATING_FIELDS.has(key)
          ? 'draft'
          : current.reviewStatus,
    }))
  }

  const selectObservation = (observation: TuObservation) => {
    if (formDirty && !window.confirm('Du har osparade ändringar. Vill du lämna fältposten utan att spara?')) return false
    setError(null)
    setSavedMessage(null)
    setSuggestion(null)
    setImagePickerOpen(false)
    setForm(toObservationForm(observation))
    return true
  }

  const openObservationPanel = (observation: TuObservation) => {
    if (!selectObservation(observation)) return
    setObservationPanelOpen(true)
  }

  const closeObservationPanel = useCallback(() => {
    if (saving) {
      setError('Vänta tills den pågående bearbetningen är klar.')
      return
    }
    if (formDirty && !window.confirm('Du har osparade ändringar. Vill du stänga utan att spara?')) return
    setObservationPanelOpen(false)
    setImagePickerOpen(false)
    setError(null)
    setSavedMessage(null)
  }, [formDirty, saving])

  useEffect(() => {
    if (!observationPanelOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeObservationPanel()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [closeObservationPanel, observationPanelOpen])

  const saveObservation = async (reviewAndNext = false) => {
    if (locked || saving) return false
    if (!form.noteText.trim() && !form.transcriptText.trim() && form.imageIds.length === 0) {
      setError('Lägg in en anteckning, en röstinmatning eller minst en bild.')
      return false
    }

    setSaving(true)
    setError(null)
    setSavedMessage(null)
    try {
      const response = await fetch(`/api/tu/investigations/${inspectionId}/observations`, {
        method: form.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          observationId: form.id,
          location: form.location,
          buildingComponent: form.buildingComponent,
          noteText: form.noteText,
          transcriptText: form.transcriptText,
          riskNote: form.riskNote,
          suggestedFollowUp: form.suggestedFollowUp,
          certainty: form.certainty,
          reviewStatus: reviewAndNext ? 'reviewed' : form.reviewStatus,
          targetSectionId: form.targetSectionId,
          includeInReport: form.includeInReport,
          imageIds: form.imageIds,
          audioStorageBucket: form.audioStorageBucket,
          audioStoragePath: form.audioStoragePath,
          audioContentType: form.audioContentType,
          audioDurationSeconds: form.audioDurationSeconds,
        }),
      })
      const payload = await readJson<TuEvidenceResponse>(response)
      if (!response.ok || !payload.observation) {
        throw new Error(payload.error ?? 'Kunde inte spara fältposten.')
      }
      const next = await loadObservations(reviewAndNext ? null : payload.observation.id)
      if (reviewAndNext) {
        const remaining = next?.filter((observation) => observation.reviewStatus !== 'reviewed') ?? []
        if (remaining.length === 0) {
          setObservationFilter('all')
          setObservationPanelOpen(false)
        }
        setSavedMessage(
          remaining.length > 0
            ? 'Källmaterialet är kontrollerat. Nästa fältpost har öppnats.'
            : 'Alla fältposter är kontrollerade.'
        )
      } else {
        setSavedMessage(form.id ? 'Ändringarna är sparade.' : 'Fältposten är sparad som utkast.')
      }
      return true
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Kunde inte spara fältposten.')
      return false
    } finally {
      setSaving(false)
    }
  }

  const deleteObservation = async () => {
    if (locked || saving || !form.id) return
    if (!window.confirm('Ta bort fältposten och dess mätvärden?')) return
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/tu/investigations/${inspectionId}/observations`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ observationId: form.id }),
      })
      const payload = await readJson<TuEvidenceResponse>(response)
      if (!response.ok) throw new Error(payload.error ?? 'Kunde inte ta bort fältposten.')
      setObservationPanelOpen(false)
      setForm(createEmptyObservation(sections))
      await loadObservations(null)
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Kunde inte ta bort fältposten.')
    } finally {
      setSaving(false)
    }
  }

  const toggleImage = (imageId: string) => {
    setForm((current) => ({
      ...current,
      reviewStatus: current.id && current.reviewStatus === 'reviewed' ? 'draft' : current.reviewStatus,
      imageIds: current.imageIds.includes(imageId)
        ? current.imageIds.filter((id) => id !== imageId)
        : [...current.imageIds, imageId],
    }))
  }

  const uploadAndLinkImages = async (files: File[]) => {
    const uploadedImageIds = await onUploadImages(files)
    if (uploadedImageIds.length === 0) return
    setForm((current) => ({
      ...current,
      reviewStatus: current.id && current.reviewStatus === 'reviewed' ? 'draft' : current.reviewStatus,
      imageIds: [...new Set([...current.imageIds, ...uploadedImageIds])],
    }))
    setSavedMessage('Bilden är uppladdad och kopplad. Spara fältposten för att behålla kopplingen.')
  }

  const setImageSectionWithFeedback = async (imageId: string, sectionKey: 'bank' | 'appendix' | 'cover') => {
    if (locked || imageBusy || imageSectionActionIds.has(imageId)) return
    setImageSectionActionIds((current) => {
      const next = new Set(current)
      next.add(imageId)
      return next
    })
    try {
      await onSetImageSection(imageId, sectionKey)
    } finally {
      setImageSectionActionIds((current) => {
        const next = new Set(current)
        next.delete(imageId)
        return next
      })
    }
  }

  const saveMeasurement = async () => {
    if (locked || measurementBusy || !form.id) return
    if (!measurementForm.measurementType.trim() || !measurementForm.valueText.trim()) {
      setError('Ange typ och mätvärde.')
      return
    }
    setMeasurementBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/tu/investigations/${inspectionId}/measurements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          observationId: form.id,
          location: form.location,
          ...measurementForm,
        }),
      })
      const payload = await readJson<{ measurement?: TuMeasurement; error?: string }>(response)
      if (!response.ok || !payload.measurement) {
        throw new Error(payload.error ?? 'Kunde inte spara mätvärdet.')
      }
      setMeasurementForm(EMPTY_MEASUREMENT)
      await loadObservations(form.id)
    } catch (measurementError) {
      setError(measurementError instanceof Error ? measurementError.message : 'Kunde inte spara mätvärdet.')
    } finally {
      setMeasurementBusy(false)
    }
  }

  const deleteMeasurement = async (measurementId: string) => {
    if (locked || measurementBusy || !form.id) return
    setMeasurementBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/tu/investigations/${inspectionId}/measurements`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ measurementId }),
      })
      const payload = await readJson<{ error?: string }>(response)
      if (!response.ok) throw new Error(payload.error ?? 'Kunde inte ta bort mätvärdet.')
      await loadObservations(form.id)
    } catch (measurementError) {
      setError(measurementError instanceof Error ? measurementError.message : 'Kunde inte ta bort mätvärdet.')
    } finally {
      setMeasurementBusy(false)
    }
  }

  const generateSuggestion = async () => {
    if (locked || aiBusy || !aiSectionId) return
    setAiBusy(true)
    setError(null)
    setAiError(null)
    setSuggestion(null)
    try {
      const response = await fetch(`/api/tu/investigations/${inspectionId}/evidence-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sectionId: aiSectionId }),
      })
      const payload = await readJson<TuEvidenceResponse>(response)
      if (!response.ok || !payload.suggestion) {
        throw new Error(payload.error ?? 'Kunde inte skapa textförslaget.')
      }
      setSuggestion(payload.suggestion)
    } catch (suggestionError) {
      setAiError(suggestionError instanceof Error ? suggestionError.message : 'Kunde inte skapa textförslaget.')
    } finally {
      setAiBusy(false)
    }
  }

  const reviewSuggestion = async (status: 'accepted' | 'rejected', mode: 'replace' | 'append' = 'replace') => {
    if (!suggestion || suggestionBusy || locked) return
    setSuggestionBusy(true)
    setError(null)
    let appliedToReport = false
    try {
      if (status === 'accepted') {
        await onApplySuggestion(suggestion.targetSectionId, suggestion.proposedText, mode)
        appliedToReport = true
      }
      const response = await fetch(`/api/tu/investigations/${inspectionId}/evidence-draft`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestionId: suggestion.id, status, mode: status === 'accepted' ? mode : null }),
      })
      const payload = await readJson<TuEvidenceResponse>(response)
      if (!response.ok) throw new Error(payload.error ?? 'Kunde inte uppdatera AI-förslaget.')
      setSuggestion(null)
      if (status === 'accepted') {
        setSavedMessage('Textförslaget är infogat i utlåtandet.')
        onOpenReport(suggestion.targetSectionId)
      }
    } catch (reviewError) {
      if (appliedToReport) {
        setSuggestion(null)
        setSavedMessage('Textförslaget är infogat i utlåtandet.')
        setError('Texten sparades, men AI-förslagets granskningsstatus kunde inte uppdateras.')
        onOpenReport(suggestion.targetSectionId)
        return
      }
      setError(reviewError instanceof Error ? reviewError.message : 'Kunde inte hantera AI-förslaget.')
    } finally {
      setSuggestionBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-violet-50 text-violet-700">
              <ClipboardList size={20} aria-hidden />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-gray-950">Granska underlag</h2>
              <p className="text-sm text-gray-600">
                {reviewedCount} av {observations.length} fältposter kontrollerade
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden w-40 sm:block" aria-label={`${reviewedCount} av ${observations.length} kontrollerade`}>
              <div className="h-1.5 overflow-hidden rounded-full bg-gray-200">
                <div
                  className="h-full rounded-full bg-violet-700 transition-[width]"
                  style={{ width: observations.length > 0 ? `${(reviewedCount / observations.length) * 100}%` : '0%' }}
                />
              </div>
            </div>
            <button
              type="button"
              onClick={() => setFieldEntryDialogOpen(true)}
              disabled={locked}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-gray-300 bg-white px-3 text-sm font-semibold text-gray-800 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400"
            >
              <Plus size={16} aria-hidden />
              Lägg till fältpost
            </button>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              className="hidden"
              onChange={(event) => {
                const files = Array.from(event.target.files ?? [])
                event.target.value = ''
                void uploadAndLinkImages(files)
              }}
            />
          </div>
        </div>

        {error ? (
          <div className="border-b border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
            {error}
          </div>
        ) : null}
        {savedMessage ? (
          <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800" aria-live="polite">
            {savedMessage}
          </div>
        ) : null}

        <div className="min-h-[420px]">
          <div>
            <div className="flex flex-col gap-3 border-b border-gray-200 bg-gray-50/70 p-3 sm:flex-row sm:items-center sm:justify-between">
              <label className="relative block w-full sm:max-w-md">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden />
                <span className="sr-only">Sök fältposter</span>
                <input
                  value={observationSearch}
                  onChange={(event) => setObservationSearch(event.target.value)}
                  placeholder="Sök i underlaget"
                  className="h-10 w-full rounded-md border border-gray-300 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-violet-600 focus:ring-2 focus:ring-violet-100"
                />
              </label>
              <div className="grid w-full grid-cols-3 rounded-md border border-gray-200 bg-white p-1 sm:w-auto sm:min-w-[330px]" aria-label="Filtrera fältposter">
                {([
                  { value: 'needs_review', label: 'Att kontrollera', count: needsReviewCount },
                  { value: 'reviewed', label: 'Kontrollerade', count: reviewedCount },
                  { value: 'all', label: 'Alla', count: observations.length },
                ] as const).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setObservationFilter(option.value)}
                    aria-pressed={observationFilter === option.value}
                    className={`min-h-9 rounded px-1 text-[11px] font-semibold transition ${
                      observationFilter === option.value
                        ? 'bg-violet-700 text-white shadow-sm'
                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-950'
                    }`}
                  >
                    {option.label} <span className="opacity-75">{option.count}</span>
                  </button>
                ))}
              </div>
            </div>
            {loading ? (
              <div className="flex items-center gap-2 px-4 py-5 text-sm text-gray-600">
                <Loader2 size={16} className="animate-spin" aria-hidden />
                Hämtar underlag...
              </div>
            ) : observations.length === 0 ? (
              <div className="flex min-h-64 flex-col items-center justify-center px-4 py-10 text-center">
                <div className="flex h-11 w-11 items-center justify-center rounded-md bg-violet-50 text-violet-700">
                  <ClipboardList size={20} aria-hidden />
                </div>
                <h3 className="mt-3 text-sm font-semibold text-gray-950">Inga fältposter ännu</h3>
                <p className="mt-1 max-w-sm text-sm leading-6 text-gray-600">
                  Lägg till en fältpost här eller dokumentera under steget Dokumentera på plats.
                </p>
                <button
                  type="button"
                  onClick={() => setFieldEntryDialogOpen(true)}
                  disabled={locked}
                  className="mt-4 inline-flex h-10 items-center gap-2 rounded-md bg-violet-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-gray-300"
                >
                  <Plus size={16} aria-hidden />
                  Lägg till fältpost
                </button>
              </div>
            ) : filteredObservations.length === 0 ? (
              <div className="px-4 py-8 text-sm text-gray-600">
                {observationSearch.trim()
                  ? 'Ingen fältpost matchar sökningen.'
                  : observationFilter === 'needs_review'
                    ? 'Alla fältposter är kontrollerade.'
                    : 'Det finns inga fältposter i det här urvalet.'}
              </div>
            ) : (
              <div className="divide-y divide-gray-200">
                {filteredObservations.map((observation) => {
                  const active = observationPanelOpen && observation.id === form.id
                  const observationNumber = observations.findIndex((item) => item.id === observation.id) + 1
                  return (
                    <button
                      key={observation.id}
                      type="button"
                      onClick={() => openObservationPanel(observation)}
                      className={`group grid w-full grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left transition md:grid-cols-[36px_minmax(0,1fr)_auto_20px] ${
                        active
                          ? 'bg-violet-50/60 shadow-[inset_3px_0_0_#6d28d9]'
                          : 'bg-white hover:bg-gray-50'
                      }`}
                    >
                      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-xs font-semibold ${
                        observation.reviewStatus === 'reviewed'
                          ? 'bg-emerald-50 text-emerald-800'
                          : 'bg-violet-50 text-violet-800'
                      }`}>
                        {observation.reviewStatus === 'reviewed'
                          ? <CheckCircle2 size={16} aria-label="Kontrollerad" />
                          : observationNumber}
                      </span>
                      <span className="grid min-w-0 gap-1 md:grid-cols-[minmax(180px,0.8fr)_minmax(240px,1.4fr)] md:items-center md:gap-6">
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-gray-950">
                            {getObservationTitle(observation)}
                          </span>
                          <span className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-gray-500">
                            <span className="shrink-0">{formatObservationTime(observation.observedAt)}</span>
                            {observation.buildingComponent ? (
                              <span className="truncate">{observation.buildingComponent}</span>
                            ) : null}
                          </span>
                        </span>
                        <span className="line-clamp-2 text-xs leading-5 text-gray-600 md:line-clamp-1 md:text-sm">
                          {getObservationPreview(observation)}
                        </span>
                      </span>
                      <span className="flex flex-col items-end gap-1.5 sm:flex-row sm:items-center">
                        <span className={`hidden rounded px-2 py-1 text-[10px] font-semibold xl:inline-flex ${
                          observation.reviewStatus === 'reviewed'
                            ? 'bg-emerald-50 text-emerald-800'
                            : 'bg-violet-50 text-violet-800'
                        }`}>
                          {observation.reviewStatus === 'reviewed' ? 'Kontrollerad' : 'Att kontrollera'}
                        </span>
                        {!observation.location ? (
                          <span className="rounded bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-800">
                            Saknar plats
                          </span>
                        ) : null}
                        {observation.reviewStatus !== 'reviewed' && observation.imageIds.length === 0 ? (
                          <span className="hidden rounded bg-gray-100 px-2 py-1 text-[10px] font-semibold text-gray-600 lg:inline-flex">
                            Ingen bild
                          </span>
                        ) : null}
                        <span className="inline-flex items-center gap-2 text-[11px] text-gray-500">
                          {observation.imageIds.length > 0 ? (
                            <span className="inline-flex items-center gap-1">
                              <ImageIcon size={12} aria-hidden /> {observation.imageIds.length}
                            </span>
                          ) : null}
                          {observation.measurements.length > 0 ? (
                            <span className="inline-flex items-center gap-1">
                              <Ruler size={12} aria-hidden /> {observation.measurements.length}
                            </span>
                          ) : null}
                        </span>
                      </span>
                      <ChevronRight size={16} className="hidden shrink-0 text-gray-400 transition group-hover:text-gray-700 md:block" aria-hidden />
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {observationPanelOpen && form.id ? (
            <>
              <div className="fixed inset-0 z-50 bg-gray-950/25" onClick={closeObservationPanel} />
              <aside
                className="fixed inset-0 z-[60] flex w-full flex-col bg-white shadow-2xl lg:inset-y-0 lg:left-auto lg:right-0 lg:max-w-4xl lg:border-l lg:border-gray-200"
                role="dialog"
                aria-modal="true"
                aria-labelledby="tu-observation-panel-title"
              >
                <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5 md:px-6">
            <div className="sticky top-0 z-20 -mx-4 flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 bg-white px-4 py-4 md:-mx-6 md:px-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-violet-700">
                  Fältpost {observations.findIndex((observation) => observation.id === form.id) + 1} av {observations.length}
                </p>
                <h3 id="tu-observation-panel-title" className="mt-1 text-lg font-semibold text-gray-950">
                  {form.location || form.buildingComponent || 'Fältpost utan plats'}
                </h3>
              </div>
              <div className="flex items-center gap-2">
                {formDirty ? (
                  <span className="rounded bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">Osparade ändringar</span>
                ) : form.id ? (
                  <span className={`rounded px-2 py-1 text-xs font-semibold ${
                    form.reviewStatus === 'reviewed'
                      ? 'bg-emerald-50 text-emerald-800'
                      : 'bg-violet-50 text-violet-800'
                  }`}>
                    {form.reviewStatus === 'reviewed' ? 'Kontrollerad' : 'Behöver kontrolleras'}
                  </span>
                ) : null}
                {form.id ? (
                  <button
                    type="button"
                    onClick={() => void deleteObservation()}
                    disabled={locked || saving}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-rose-200 bg-white text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:text-gray-300"
                    aria-label="Ta bort fältpost"
                    title="Ta bort fältpost"
                  >
                    <Trash2 size={16} aria-hidden />
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={closeObservationPanel}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-700 transition hover:bg-gray-50"
                  aria-label="Stäng fältposten"
                  title="Stäng"
                >
                  <X size={17} aria-hidden />
                </button>
              </div>
            </div>

            {error ? (
              <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800" role="alert">
                {error}
              </div>
            ) : null}
            {savedMessage ? (
              <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800" aria-live="polite">
                {savedMessage}
              </div>
            ) : null}

            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">Kontrollera källmaterialet</p>
              <p className="mt-1 text-sm text-gray-600">
                Rätta sakfel och kontrollera kopplingarna. Talspråk och ofärdiga formuleringar kan vara kvar.
              </p>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs font-medium text-gray-700">Plats/rum</span>
                <input
                  value={form.location}
                  onChange={(event) => updateForm('location', event.target.value)}
                  disabled={locked}
                  placeholder="Exempel: Sovrum mot norr"
                  className="h-10 w-full rounded-md border border-gray-300 px-3 text-sm outline-none transition focus:border-violet-600 focus:ring-2 focus:ring-violet-100 disabled:bg-gray-100"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-gray-700">Byggnadsdel</span>
                <input
                  value={form.buildingComponent}
                  onChange={(event) => updateForm('buildingComponent', event.target.value)}
                  disabled={locked}
                  placeholder="Exempel: Källaryttervägg"
                  className="h-10 w-full rounded-md border border-gray-300 px-3 text-sm outline-none transition focus:border-violet-600 focus:ring-2 focus:ring-violet-100 disabled:bg-gray-100"
                />
              </label>
            </div>

            <label className="mt-4 block space-y-1">
              <span className="text-xs font-medium text-gray-700">Fältanteckning</span>
              <textarea
                value={form.noteText}
                onChange={(event) => updateForm('noteText', event.target.value)}
                disabled={locked}
                rows={5}
                placeholder="Det som observerades eller berättades på plats."
                className="w-full resize-y rounded-md border border-gray-300 px-3 py-2 text-sm leading-6 outline-none transition focus:border-violet-600 focus:ring-2 focus:ring-violet-100 disabled:bg-gray-100"
              />
            </label>

            {form.audioStoragePath ? (
              <p className="mt-2 text-xs text-gray-500">Röstinspelningen är sparad med originalunderlaget.</p>
            ) : null}

            {form.transcriptText ? (
              <label className="mt-4 block space-y-1">
                <span className="flex items-center gap-2 text-xs font-medium text-gray-700">
                  Röstutskrift
                  <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-blue-700">
                    Kontrollera
                  </span>
                </span>
                <textarea
                  value={form.transcriptText}
                  onChange={(event) => updateForm('transcriptText', event.target.value)}
                  disabled={locked}
                  rows={4}
                  className="w-full resize-y rounded-md border border-blue-200 bg-blue-50/30 px-3 py-2 text-sm leading-6 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-gray-100"
                />
              </label>
            ) : null}

            <div className="mt-5 border-t border-gray-200 pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-sm font-semibold text-gray-950">Bilder</h4>
                  <p className="text-xs text-gray-600">{form.imageIds.length} kopplade · {images.length} i bildbanken</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {imagePickerOpen ? (
                    <button
                      type="button"
                      onClick={() => imageInputRef.current?.click()}
                      disabled={locked || imageBusy}
                      aria-busy={imageBusy}
                      className="inline-flex h-9 items-center gap-2 rounded-md border border-gray-300 bg-white px-3 text-xs font-semibold text-gray-800 transition hover:bg-gray-50 disabled:text-gray-400"
                    >
                      {imageBusy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Upload size={14} aria-hidden />}
                      {imageBusy ? 'Laddar...' : 'Ladda upp'}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setImagePickerOpen((current) => !current)}
                    className="inline-flex h-9 items-center gap-2 rounded-md border border-gray-300 bg-white px-3 text-xs font-semibold text-gray-800 transition hover:bg-gray-50"
                  >
                    <ImageIcon size={14} aria-hidden />
                    {imagePickerOpen ? 'Stäng bildbanken' : 'Hantera bildkopplingar'}
                  </button>
                </div>
              </div>
              {images.length === 0 ? (
                <div className="mt-3 rounded-md border border-dashed border-gray-300 px-3 py-5 text-center text-sm text-gray-600">
                  Bildbanken är tom.
                </div>
              ) : !imagePickerOpen && linkedImages.length === 0 ? (
                <button
                  type="button"
                  onClick={() => setImagePickerOpen(true)}
                  className="mt-3 w-full rounded-md border border-dashed border-gray-300 px-3 py-5 text-center text-sm font-medium text-gray-600 hover:border-violet-300 hover:bg-violet-50/40 hover:text-violet-800"
                >
                  Inga bilder är kopplade. Öppna bildbanken för att välja bilder.
                </button>
              ) : (
                <div className={imagePickerOpen ? 'mt-3 rounded-md border border-gray-200 bg-gray-50 p-3' : 'mt-3'}>
                  {imagePickerOpen ? (
                    <p className="mb-3 text-xs text-gray-600">Välj vilka bilder som hör till den aktuella fältposten.</p>
                  ) : null}
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                  {(imagePickerOpen ? images : linkedImages).map((image) => {
                    const selected = form.imageIds.includes(image.id)
                    const sectionPending = imageSectionActionIds.has(image.id)
                    return (
                      <div
                        key={image.id}
                        className={`relative overflow-hidden rounded-md border bg-white transition ${
                          sectionPending
                            ? 'cursor-wait border-violet-300 ring-2 ring-violet-100'
                            : selected
                              ? 'border-violet-600 ring-2 ring-violet-100'
                              : 'border-gray-200'
                        }`}
                        aria-busy={sectionPending}
                      >
                        <button
                          type="button"
                          onClick={() => onPreviewImage(image.id)}
                          disabled={sectionPending}
                          className="block w-full text-left disabled:cursor-wait"
                          aria-label="Granska bild i fullformat"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={image.publicUrl}
                            alt={image.caption ?? 'Besiktningsbild'}
                            className={`aspect-square w-full object-cover ${sectionPending ? 'opacity-55' : ''}`}
                          />
                        </button>
                        {sectionPending ? (
                          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 bg-white/55 text-[11px] font-semibold text-violet-900">
                            <Loader2 size={16} className="animate-spin" aria-hidden />
                            Lägger i bilaga
                          </div>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => toggleImage(image.id)}
                          disabled={locked || sectionPending}
                          aria-pressed={selected}
                          aria-label={selected ? 'Ta bort bildkoppling' : 'Koppla bild till observation'}
                          title={selected ? 'Ta bort bildkoppling' : 'Koppla bild till observation'}
                          className="absolute left-2 top-2 flex h-7 w-7 items-center justify-center rounded-md border border-white/80 bg-white/95 text-violet-700 shadow-sm disabled:text-gray-300"
                        >
                          {selected ? <Check size={15} strokeWidth={3} aria-hidden /> : <Plus size={15} aria-hidden />}
                        </button>
                        <div className="flex items-center justify-between gap-1 border-t border-gray-100 px-2 py-1.5">
                          <span className="truncate text-[11px] text-gray-600">
                            {image.sectionKey === 'appendix' ? 'I bilaga' : image.caption || 'Bildbank'}
                          </span>
                          <span className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => onPreviewImage(image.id)}
                              className="inline-flex h-7 w-7 items-center justify-center rounded text-gray-600 hover:bg-gray-100"
                              aria-label="Öppna bild"
                              title="Öppna bild"
                            >
                              <ExternalLink size={13} aria-hidden />
                            </button>
                            {image.sectionKey !== 'appendix' ? (
                              <button
                                type="button"
                                onClick={() => void setImageSectionWithFeedback(image.id, 'appendix')}
                                disabled={locked || imageBusy || sectionPending}
                                aria-busy={sectionPending}
                                className="inline-flex h-7 w-7 items-center justify-center rounded text-violet-700 hover:bg-violet-50 disabled:text-gray-300"
                                aria-label="Lägg i bildbilaga"
                                title="Lägg i bildbilaga"
                              >
                                {sectionPending ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Paperclip size={13} aria-hidden />}
                              </button>
                            ) : null}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                  </div>
                </div>
              )}
              {linkedImages.length > 0 ? (
                <p className="mt-2 text-xs text-gray-500">
                  Bildkopplingen sparas med fältposten. Endast bilder märkta ”I bilaga” tas med i rapportens bildbilaga.
                </p>
              ) : null}
            </div>

            <details className="group mt-5 border-t border-gray-200 pt-4">
              <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 rounded-md px-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 [&::-webkit-details-marker]:hidden">
                <span className="inline-flex items-center gap-2">
                  <Ruler size={16} className="text-gray-600" aria-hidden />
                  Mätvärden
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">
                    {selectedObservation?.measurements.length ?? 0}
                  </span>
                </span>
                <ChevronDown size={15} className="text-gray-500 transition group-open:rotate-180" aria-hidden />
              </summary>
              <div className="px-2 pb-2">
              {!form.id ? (
                <p className="mt-2 text-sm text-gray-600">Spara fältposten innan mätvärden läggs till.</p>
              ) : (
                <>
                  {selectedObservation?.measurements.length ? (
                    <div className="mt-3 divide-y divide-gray-200 rounded-md border border-gray-200">
                      {selectedObservation.measurements.map((measurement) => (
                        <div key={measurement.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-gray-950">
                              {measurement.measurementType}: {measurement.valueText}
                              {measurement.unit ? ` ${measurement.unit}` : ''}
                            </p>
                            <p className="mt-0.5 text-xs text-gray-600">
                              {[measurement.method, measurement.instrument, measurement.note].filter(Boolean).join(' · ')}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => void deleteMeasurement(measurement.id)}
                            disabled={locked || measurementBusy}
                            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-rose-700 hover:bg-rose-50 disabled:text-gray-300"
                            aria-label="Ta bort mätvärde"
                            title="Ta bort mätvärde"
                          >
                            <Trash2 size={14} aria-hidden />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-3 grid gap-2 sm:grid-cols-[1.2fr_1fr_0.7fr]">
                    <input
                      value={measurementForm.measurementType}
                      onChange={(event) => setMeasurementForm((current) => ({ ...current, measurementType: event.target.value }))}
                      disabled={locked}
                      placeholder="Typ, t.ex. fuktindikering"
                      className="h-9 rounded-md border border-gray-300 px-3 text-sm outline-none focus:border-violet-600 focus:ring-2 focus:ring-violet-100"
                    />
                    <input
                      value={measurementForm.valueText}
                      onChange={(event) => setMeasurementForm((current) => ({ ...current, valueText: event.target.value }))}
                      disabled={locked}
                      placeholder="Värde"
                      className="h-9 rounded-md border border-gray-300 px-3 text-sm outline-none focus:border-violet-600 focus:ring-2 focus:ring-violet-100"
                    />
                    <input
                      value={measurementForm.unit}
                      onChange={(event) => setMeasurementForm((current) => ({ ...current, unit: event.target.value }))}
                      disabled={locked}
                      placeholder="Enhet"
                      className="h-9 rounded-md border border-gray-300 px-3 text-sm outline-none focus:border-violet-600 focus:ring-2 focus:ring-violet-100"
                    />
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <input
                      value={measurementForm.method}
                      onChange={(event) => setMeasurementForm((current) => ({ ...current, method: event.target.value }))}
                      disabled={locked}
                      placeholder="Metod"
                      className="h-9 rounded-md border border-gray-300 px-3 text-sm outline-none focus:border-violet-600 focus:ring-2 focus:ring-violet-100"
                    />
                    <input
                      value={measurementForm.instrument}
                      onChange={(event) => setMeasurementForm((current) => ({ ...current, instrument: event.target.value }))}
                      disabled={locked}
                      placeholder="Instrument"
                      className="h-9 rounded-md border border-gray-300 px-3 text-sm outline-none focus:border-violet-600 focus:ring-2 focus:ring-violet-100"
                    />
                  </div>
                  <div className="mt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => void saveMeasurement()}
                      disabled={locked || measurementBusy}
                      className="inline-flex h-9 items-center gap-2 rounded-md border border-violet-200 bg-violet-50 px-3 text-xs font-semibold text-violet-800 transition hover:bg-violet-100 disabled:text-gray-400"
                    >
                      {measurementBusy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Plus size={14} aria-hidden />}
                      Lägg till mätvärde
                    </button>
                  </div>
                </>
              )}
              </div>
            </details>

            <div className="sticky bottom-[max(0.5rem,env(safe-area-inset-bottom))] z-10 mt-5 flex flex-wrap items-center justify-between gap-2 rounded-md border border-gray-200 bg-white/95 p-2 shadow-lg backdrop-blur">
              <span className="px-1 text-xs text-gray-600">
                {!form.id
                  ? 'Den nya fältposten sparas först som utkast.'
                  : form.reviewStatus === 'reviewed'
                    ? 'Källmaterialet är kontrollerat och redo för analys.'
                    : 'Kontrollera sakuppgifter och kopplingar innan analysen.'}
              </span>
              <div className="flex flex-wrap gap-2">
                {form.id && form.reviewStatus !== 'reviewed' ? (
                  <button
                    type="button"
                    onClick={() => void saveObservation(false)}
                    disabled={locked || saving}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-3 text-sm font-semibold text-gray-800 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400"
                  >
                    Spara som utkast
                  </button>
                ) : null}
                {!form.id ? (
                  <button
                    type="button"
                    onClick={() => void saveObservation(false)}
                    disabled={locked || saving}
                    className="inline-flex h-10 min-w-36 items-center justify-center gap-2 rounded-md bg-violet-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-gray-300"
                  >
                    {saving ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Check size={16} aria-hidden />}
                    Spara fältpost
                  </button>
                ) : form.reviewStatus !== 'reviewed' ? (
                  <button
                    type="button"
                    onClick={() => void saveObservation(true)}
                    disabled={locked || saving}
                    className="inline-flex min-h-10 min-w-44 items-center justify-center gap-2 rounded-md bg-violet-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-gray-300"
                  >
                    {saving ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Check size={16} aria-hidden />}
                    Godkänn underlaget och öppna nästa
                  </button>
                ) : formDirty ? (
                  <button
                    type="button"
                    onClick={() => void saveObservation(false)}
                    disabled={locked || saving}
                    className="inline-flex h-10 min-w-36 items-center justify-center gap-2 rounded-md bg-violet-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-gray-300"
                  >
                    {saving ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Check size={16} aria-hidden />}
                    Spara ändringar
                  </button>
                ) : nextUnreviewedObservation ? (
                  <button
                    type="button"
                    onClick={() => selectObservation(nextUnreviewedObservation)}
                    className="inline-flex h-10 min-w-40 items-center justify-center gap-2 rounded-md bg-violet-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-800"
                  >
                    Nästa att kontrollera
                    <ChevronRight size={15} aria-hidden />
                  </button>
                ) : (
                  <span className="inline-flex h-10 items-center gap-2 rounded-md bg-emerald-50 px-3 text-sm font-semibold text-emerald-800">
                    <CheckCircle2 size={16} aria-hidden />
                    Granskningen är klar
                  </span>
                )}
              </div>
            </div>
                </div>
              </aside>
            </>
          ) : null}
        </div>
      </section>

      {enableSectionAi ? (
      <section className="rounded-lg border border-violet-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-violet-100 px-4 py-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-violet-50 text-violet-700">
              <Sparkles size={20} aria-hidden />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-950">AI-förslag till utlåtandet</h2>
              <p className="mt-0.5 text-sm text-gray-600">
                Underlag: {reviewedCount} kontrollerade fältposter
                {analysisApproved ? ' och godkänd helhetsanalys' : ''}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onOpenReport(aiSectionId)}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-violet-200 bg-white px-3 text-xs font-semibold text-violet-800 transition hover:bg-violet-50"
          >
            Öppna utlåtandet
            <ChevronRight size={14} aria-hidden />
          </button>
        </div>

        <div className="p-4">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <label className="space-y-1">
              <span className="text-xs font-medium text-gray-700">Skapa förslag för</span>
              <select
                value={aiSectionId}
                onChange={(event) => {
                  setAiSectionId(event.target.value)
                  setSuggestion(null)
                }}
                disabled={locked || aiBusy}
                className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100 disabled:bg-gray-100"
              >
                {editableSections.map((section) => (
                  <option key={section.id} value={section.id}>{section.title}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => void generateSuggestion()}
              disabled={locked || aiBusy || !aiSectionId}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-violet-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {aiBusy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Sparkles size={16} aria-hidden />}
              {aiBusy ? 'Skapar...' : 'Skapa textförslag'}
            </button>
          </div>

          {aiError ? (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900" role="alert">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
              <span>{aiError}</span>
            </div>
          ) : null}

          {reviewedCount === 0 && !analysisApproved ? (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
              Inga fältposter är kontrollerade. Ett förslag kan bara bygga på ärendets grunduppgifter.
            </div>
          ) : null}

          {suggestion ? (
            <div className="mt-4 border-t border-violet-100 pt-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-violet-950">{suggestion.targetSectionTitle}</p>
                  <p className="mt-1 text-xs text-gray-600">
                    {suggestion.sourceObservationIds.length} källobservationer
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void reviewSuggestion('rejected')}
                  disabled={suggestionBusy}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:text-gray-300"
                  aria-label="Avvisa förslag"
                  title="Avvisa förslag"
                >
                  <X size={15} aria-hidden />
                </button>
              </div>
              <div className="mt-3 whitespace-pre-wrap rounded-md border border-gray-200 bg-gray-50 px-3 py-3 text-sm leading-6 text-gray-900">
                {suggestion.proposedText}
              </div>
              {suggestion.sourceObservationIds.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {suggestion.sourceObservationIds.map((observationId) => {
                    const observation = observations.find((item) => item.id === observationId)
                    return (
                      <button
                        key={observationId}
                        type="button"
                        onClick={() => observation && openObservationPanel(observation)}
                        className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                      >
                        {observation ? getObservationTitle(observation) : observationId.slice(0, 8)}
                      </button>
                    )
                  })}
                </div>
              ) : null}
              {suggestion.warnings.length > 0 ? (
                <div className="mt-3 space-y-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  {suggestion.warnings.map((warning) => <p key={warning}>{warning}</p>)}
                </div>
              ) : null}
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => void reviewSuggestion('accepted', 'append')}
                  disabled={locked || suggestionBusy}
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-violet-200 bg-white px-3 text-sm font-semibold text-violet-800 transition hover:bg-violet-50 disabled:text-gray-400"
                >
                  <Plus size={15} aria-hidden />
                  Lägg till efter befintlig text
                </button>
                <button
                  type="button"
                  onClick={() => void reviewSuggestion('accepted', 'replace')}
                  disabled={locked || suggestionBusy}
                  className="inline-flex h-10 items-center gap-2 rounded-md bg-violet-700 px-3 text-sm font-semibold text-white transition hover:bg-violet-800 disabled:bg-gray-300"
                >
                  {suggestionBusy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Check size={15} aria-hidden />}
                  Ersätt sektionens text
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </section>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-4">
        <p className="text-sm text-gray-600">
          {reviewedCount < observations.length
            ? `${observations.length - reviewedCount} fältposter behöver kontrolleras innan helhetsanalysen kan starta.`
            : 'Källmaterialet är kontrollerat och klart för en samlad bedömning.'}
        </p>
        <button
          type="button"
          onClick={onOpenAnalysis}
          disabled={reviewedCount < observations.length || observations.length === 0}
          className="inline-flex h-10 items-center gap-2 rounded-md bg-violet-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          Bedöm och komplettera
          <ChevronRight size={15} aria-hidden />
        </button>
      </div>

      {fieldEntryDialogOpen ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-gray-950/55 p-3 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="tu-evidence-field-entry-title"
        >
          <div className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-gray-50 shadow-2xl sm:max-h-[calc(100dvh-3rem)]">
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-200 bg-white px-4 py-3 sm:px-5">
              <div>
                <h2 id="tu-evidence-field-entry-title" className="text-base font-semibold text-gray-950">
                  Lägg till i fältloggen
                </h2>
                <p className="mt-0.5 text-sm text-gray-600">
                  Samma dokumentationsflöde som under Dokumentera på plats.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFieldEntryDialogOpen(false)}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-700 transition hover:bg-gray-50"
                aria-label="Stäng"
              >
                <X size={18} aria-hidden />
              </button>
            </div>
            <div className="min-h-0 overflow-y-auto p-3 sm:p-5">
              <TuFieldEntryComposer
                locked={locked}
                queue={queue}
                composerId="tu-evidence-field-entry"
                onQueued={() => {
                  setFieldEntryDialogOpen(false)
                  setSavedMessage('Fältposten är sparad lokalt och bearbetas i bakgrunden.')
                }}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
