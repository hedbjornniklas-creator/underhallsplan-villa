'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Camera,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  Mic,
  Paperclip,
  Plus,
  Ruler,
  Sparkles,
  Square,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
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

type Props = {
  inspectionId: string
  refreshToken?: number
  locked: boolean
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

const CERTAINTY_OPTIONS: Array<{ value: TuObservationCertainty; label: string }> = [
  { value: 'confirmed', label: 'Konstaterat' },
  { value: 'probable', label: 'Sannolikt' },
  { value: 'uncertain', label: 'Osäkert' },
]

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
    certainty: 'confirmed',
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
  return observation.location || observation.buildingComponent || 'Observation utan plats'
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
  const [recording, setRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [transcribing, setTranscribing] = useState(false)
  const [aiSectionId, setAiSectionId] = useState(() => defaultAiSectionId(sections))
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [suggestion, setSuggestion] = useState<TuEvidenceAiSuggestion | null>(null)
  const [suggestionBusy, setSuggestionBusy] = useState(false)
  const [analysisApproved, setAnalysisApproved] = useState(false)
  const [imageSectionActionIds, setImageSectionActionIds] = useState<Set<string>>(() => new Set())
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const recordingStartedAtRef = useRef<number | null>(null)
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
      const selectedId = preferredId ?? form.id
      if (selectedId) {
        const selected = next.find((observation) => observation.id === selectedId)
        if (selected) setForm(toObservationForm(selected))
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Kunde inte hämta besiktningsunderlaget.')
    } finally {
      setLoading(false)
    }
  }, [form.id, inspectionId])

  const refreshObservationList = useCallback(async () => {
    try {
      const response = await fetch(`/api/tu/investigations/${inspectionId}/observations`)
      const payload = await readJson<TuEvidenceResponse>(response)
      if (!response.ok) throw new Error(payload.error ?? 'Kunde inte uppdatera besiktningsunderlaget.')
      setObservations(payload.observations ?? [])
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

  useEffect(() => {
    if (!recording) return
    const timer = window.setInterval(() => {
      const startedAt = recordingStartedAtRef.current
      if (startedAt) setRecordingSeconds(Math.max(0, Math.round((Date.now() - startedAt) / 1000)))
    }, 500)
    return () => window.clearInterval(timer)
  }, [recording])

  useEffect(() => {
    return () => {
      mediaRecorderRef.current?.stop()
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  const selectedObservation = form.id
    ? observations.find((observation) => observation.id === form.id) ?? null
    : null
  const reviewedCount = observations.filter((observation) => observation.reviewStatus === 'reviewed').length
  const reportCount = observations.filter((observation) => observation.includeInReport).length
  const linkedImages = images.filter((image) => form.imageIds.includes(image.id))

  const updateForm = <K extends keyof ObservationForm>(key: K, value: ObservationForm[K]) => {
    setSavedMessage(null)
    setForm((current) => ({ ...current, [key]: value }))
  }

  const selectObservation = (observation: TuObservation) => {
    setError(null)
    setSavedMessage(null)
    setSuggestion(null)
    setForm(toObservationForm(observation))
  }

  const startNewObservation = () => {
    setError(null)
    setSavedMessage(null)
    setSuggestion(null)
    setMeasurementForm(EMPTY_MEASUREMENT)
    setForm(createEmptyObservation(sections))
  }

  const saveObservation = async () => {
    if (locked || saving) return
    if (!form.noteText.trim() && !form.transcriptText.trim() && form.imageIds.length === 0) {
      setError('Lägg in en anteckning, en röstinmatning eller minst en bild.')
      return
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
          reviewStatus: form.reviewStatus,
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
        throw new Error(payload.error ?? 'Kunde inte spara observationen.')
      }
      await loadObservations(payload.observation.id)
      setSavedMessage('Observationen är sparad.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Kunde inte spara observationen.')
    } finally {
      setSaving(false)
    }
  }

  const deleteObservation = async () => {
    if (locked || saving || !form.id) return
    if (!window.confirm('Ta bort observationen och dess mätvärden?')) return
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/tu/investigations/${inspectionId}/observations`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ observationId: form.id }),
      })
      const payload = await readJson<TuEvidenceResponse>(response)
      if (!response.ok) throw new Error(payload.error ?? 'Kunde inte ta bort observationen.')
      setForm(createEmptyObservation(sections))
      await loadObservations(null)
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Kunde inte ta bort observationen.')
    } finally {
      setSaving(false)
    }
  }

  const toggleImage = (imageId: string) => {
    setForm((current) => ({
      ...current,
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
      imageIds: [...new Set([...current.imageIds, ...uploadedImageIds])],
    }))
    setSavedMessage('Bilden är uppladdad och kopplad. Spara observationen för att behålla kopplingen.')
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

  const startRecording = async () => {
    if (locked || recording || transcribing || form.audioStoragePath) return
    setError(null)
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Röstinmatning stöds inte i den här webbläsaren.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const preferredMimeTypes = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg']
      const mimeType = preferredMimeTypes.find((candidate) => MediaRecorder.isTypeSupported(candidate))
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      audioChunksRef.current = []
      mediaStreamRef.current = stream
      mediaRecorderRef.current = recorder
      recordingStartedAtRef.current = Date.now()
      setRecordingSeconds(0)
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data)
      }
      recorder.onstop = () => {
        const durationSeconds = recordingStartedAtRef.current
          ? Math.max(1, Math.round((Date.now() - recordingStartedAtRef.current) / 1000))
          : recordingSeconds
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        stream.getTracks().forEach((track) => track.stop())
        mediaStreamRef.current = null
        mediaRecorderRef.current = null
        recordingStartedAtRef.current = null
        setRecording(false)
        void transcribeRecording(blob, durationSeconds)
      }
      recorder.start(500)
      setRecording(true)
    } catch (recordError) {
      setError(recordError instanceof Error ? recordError.message : 'Mikrofonen kunde inte startas.')
    }
  }

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state === 'inactive') return
    recorder.stop()
  }

  const transcribeRecording = async (blob: Blob, durationSeconds: number) => {
    setTranscribing(true)
    setError(null)
    try {
      const data = new FormData()
      data.append('audio', new File([blob], 'rostanteckning', { type: blob.type || 'audio/webm' }))
      data.append('durationSeconds', String(durationSeconds))
      const response = await fetch(
        `/api/tu/investigations/${inspectionId}/observations/transcribe`,
        { method: 'POST', body: data }
      )
      const payload = await readJson<{
        transcript?: string
        audio?: {
          storageBucket?: string
          storagePath?: string
          contentType?: string
          durationSeconds?: number | null
        }
        error?: string
      }>(response)
      if (!response.ok || !payload.transcript) {
        throw new Error(payload.error ?? 'Kunde inte transkribera röstanteckningen.')
      }
      setForm((current) => ({
        ...current,
        transcriptText: current.transcriptText.trim()
          ? `${current.transcriptText.trimEnd()}\n\n${payload.transcript}`
          : payload.transcript ?? '',
        audioStorageBucket: payload.audio?.storageBucket ?? current.audioStorageBucket,
        audioStoragePath: payload.audio?.storagePath ?? current.audioStoragePath,
        audioContentType: payload.audio?.contentType ?? current.audioContentType,
        audioDurationSeconds: payload.audio?.durationSeconds ?? durationSeconds,
      }))
    } catch (transcriptionError) {
      setError(
        transcriptionError instanceof Error
          ? transcriptionError.message
          : 'Kunde inte transkribera röstanteckningen.'
      )
    } finally {
      setTranscribing(false)
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
              <h2 className="text-base font-semibold text-gray-950">Sortera och granska</h2>
              <p className="text-sm text-gray-600">
                {observations.length} observationer · {reviewedCount} granskade · {reportCount} valda för rapport
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                disabled={locked || imageBusy}
                aria-busy={imageBusy}
                className="inline-flex h-10 items-center gap-2 rounded-md border border-gray-300 bg-white px-3 text-sm font-semibold text-gray-800 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400"
              >
                {imageBusy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Camera size={16} aria-hidden />}
                {imageBusy ? 'Laddar upp...' : 'Ta eller ladda upp bild'}
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
            <button
              type="button"
              onClick={startNewObservation}
              disabled={locked}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-violet-700 px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              <Plus size={16} aria-hidden />
              Ny observation
            </button>
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

        <div className="grid min-h-[620px] lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="border-b border-gray-200 bg-gray-50/70 lg:border-b-0 lg:border-r">
            {loading ? (
              <div className="flex items-center gap-2 px-4 py-5 text-sm text-gray-600">
                <Loader2 size={16} className="animate-spin" aria-hidden />
                Hämtar underlag...
              </div>
            ) : observations.length === 0 ? (
              <div className="px-4 py-8 text-sm text-gray-600">Inga observationer ännu.</div>
            ) : (
              <div className="divide-y divide-gray-200">
                {observations.map((observation, index) => {
                  const active = observation.id === form.id
                  return (
                    <button
                      key={observation.id}
                      type="button"
                      onClick={() => selectObservation(observation)}
                      className={`group flex w-full items-start gap-3 px-4 py-3 text-left transition ${
                        active ? 'bg-white shadow-[inset_3px_0_0_#6d28d9]' : 'hover:bg-white'
                      }`}
                    >
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-gray-200 bg-white text-xs font-semibold text-gray-700">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 text-sm font-semibold text-gray-950">
                          <span className="truncate">{getObservationTitle(observation)}</span>
                          {observation.reviewStatus === 'reviewed' ? (
                            <CheckCircle2 size={14} className="shrink-0 text-emerald-700" aria-label="Granskad" />
                          ) : null}
                        </span>
                        <span className="mt-1 line-clamp-2 block text-xs leading-5 text-gray-600">
                          {getObservationPreview(observation)}
                        </span>
                        <span className="mt-1.5 flex items-center gap-2 text-[11px] text-gray-500">
                          <span>{formatObservationTime(observation.observedAt)}</span>
                          {observation.imageIds.length > 0 ? (
                            <span className="inline-flex items-center gap-1">
                              <ImageIcon size={11} aria-hidden /> {observation.imageIds.length}
                            </span>
                          ) : null}
                          {observation.measurements.length > 0 ? (
                            <span className="inline-flex items-center gap-1">
                              <Ruler size={11} aria-hidden /> {observation.measurements.length}
                            </span>
                          ) : null}
                        </span>
                      </span>
                      <ChevronRight size={15} className="mt-1 shrink-0 text-gray-400 group-hover:text-gray-700" aria-hidden />
                    </button>
                  )
                })}
              </div>
            )}
          </aside>

          <div className="min-w-0 px-4 py-4 md:px-5">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 pb-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-violet-700">
                  {form.id ? 'Observation' : 'Ny observation'}
                </p>
                <h3 className="mt-1 text-lg font-semibold text-gray-950">
                  {form.id ? form.location || form.buildingComponent || 'Redigera underlag' : 'Dokumentera på plats'}
                </h3>
              </div>
              {form.id ? (
                <button
                  type="button"
                  onClick={() => void deleteObservation()}
                  disabled={locked || saving}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-rose-200 bg-white text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:text-gray-300"
                  aria-label="Ta bort observation"
                  title="Ta bort observation"
                >
                  <Trash2 size={16} aria-hidden />
                </button>
              ) : null}
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

            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_210px]">
              <label className="space-y-1">
                <span className="text-xs font-medium text-gray-700">Iakttagelse</span>
                <textarea
                  value={form.noteText}
                  onChange={(event) => updateForm('noteText', event.target.value)}
                  disabled={locked}
                  rows={5}
                  placeholder="Skriv vad som faktiskt kunde observeras."
                  className="w-full resize-y rounded-md border border-gray-300 px-3 py-2 text-sm leading-6 outline-none transition focus:border-violet-600 focus:ring-2 focus:ring-violet-100 disabled:bg-gray-100"
                />
              </label>
              <div className="space-y-2">
                <span className="block text-xs font-medium text-gray-700">Röstinmatning</span>
                <button
                  type="button"
                  onClick={recording ? stopRecording : () => void startRecording()}
                  disabled={locked || transcribing || (!recording && Boolean(form.audioStoragePath))}
                  className={`flex h-[122px] w-full flex-col items-center justify-center gap-2 rounded-md border text-sm font-semibold transition disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400 ${
                    recording
                      ? 'border-rose-300 bg-rose-50 text-rose-800'
                      : 'border-violet-200 bg-violet-50 text-violet-800 hover:bg-violet-100'
                  }`}
                >
                  {transcribing ? (
                    <Loader2 size={24} className="animate-spin" aria-hidden />
                  ) : recording ? (
                    <Square size={22} fill="currentColor" aria-hidden />
                  ) : (
                    <Mic size={24} aria-hidden />
                  )}
                  <span>
                    {transcribing
                      ? 'Transkriberar...'
                      : recording
                        ? `Stoppa · ${recordingSeconds} s`
                        : form.audioStoragePath
                          ? 'Röstinspelning tillagd'
                          : 'Spela in anteckning'}
                  </span>
                </button>
              </div>
            </div>

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

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs font-medium text-gray-700">Risk/konsekvens</span>
                <textarea
                  value={form.riskNote}
                  onChange={(event) => updateForm('riskNote', event.target.value)}
                  disabled={locked}
                  rows={3}
                  className="w-full resize-y rounded-md border border-gray-300 px-3 py-2 text-sm leading-6 outline-none transition focus:border-violet-600 focus:ring-2 focus:ring-violet-100 disabled:bg-gray-100"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-gray-700">Fortsatt kontroll/hantering</span>
                <textarea
                  value={form.suggestedFollowUp}
                  onChange={(event) => updateForm('suggestedFollowUp', event.target.value)}
                  disabled={locked}
                  rows={3}
                  className="w-full resize-y rounded-md border border-gray-300 px-3 py-2 text-sm leading-6 outline-none transition focus:border-violet-600 focus:ring-2 focus:ring-violet-100 disabled:bg-gray-100"
                />
              </label>
            </div>

            <fieldset className="mt-4">
              <legend className="text-xs font-medium text-gray-700">Bedömningssäkerhet</legend>
              <div className="mt-1 grid grid-cols-3 rounded-md border border-gray-300 bg-gray-50 p-1">
                {CERTAINTY_OPTIONS.map((option) => {
                  const active = form.certainty === option.value
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => updateForm('certainty', option.value)}
                      disabled={locked}
                      className={`min-h-9 rounded px-2 text-xs font-semibold transition ${
                        active ? 'bg-white text-gray-950 shadow-sm' : 'text-gray-600 hover:text-gray-950'
                      }`}
                    >
                      {option.label}
                    </button>
                  )
                })}
              </div>
            </fieldset>

            <div className="mt-5 border-t border-gray-200 pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-sm font-semibold text-gray-950">Bilder</h4>
                  <p className="text-xs text-gray-600">{form.imageIds.length} bilder kopplade till observationen</p>
                </div>
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
              </div>
              {images.length === 0 ? (
                <div className="mt-3 rounded-md border border-dashed border-gray-300 px-3 py-5 text-center text-sm text-gray-600">
                  Bildbanken är tom.
                </div>
              ) : (
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                  {images.map((image) => {
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
              )}
              {linkedImages.length > 0 ? (
                <p className="mt-2 text-xs text-gray-500">
                  Bildkopplingen sparas med observationen. Endast bilder märkta ”I bilaga” tas med i rapportens bildbilaga.
                </p>
              ) : null}
            </div>

            <div className="mt-5 border-t border-gray-200 pt-4">
              <div className="flex items-center gap-2">
                <Ruler size={16} className="text-gray-600" aria-hidden />
                <h4 className="text-sm font-semibold text-gray-950">Mätvärden</h4>
              </div>
              {!form.id ? (
                <p className="mt-2 text-sm text-gray-600">Spara observationen innan mätvärden läggs till.</p>
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

            <div className="mt-5 grid gap-3 border-t border-gray-200 pt-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
              <label className="space-y-1">
                <span className="text-xs font-medium text-gray-700">Rapportsektion</span>
                <select
                  value={form.targetSectionId}
                  onChange={(event) => updateForm('targetSectionId', event.target.value)}
                  disabled={locked}
                  className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm outline-none focus:border-violet-600 focus:ring-2 focus:ring-violet-100 disabled:bg-gray-100"
                >
                  <option value="">Ingen särskild sektion</option>
                  {editableSections.map((section) => (
                    <option key={section.id} value={section.id}>{section.title}</option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap gap-2">
                <label className="inline-flex h-10 items-center gap-2 rounded-md border border-gray-300 bg-white px-3 text-xs font-semibold text-gray-800">
                  <input
                    type="checkbox"
                    checked={form.includeInReport}
                    onChange={(event) => updateForm('includeInReport', event.target.checked)}
                    disabled={locked}
                    className="h-4 w-4 accent-violet-700"
                  />
                  Använd i rapport
                </label>
                <label className="inline-flex h-10 items-center gap-2 rounded-md border border-gray-300 bg-white px-3 text-xs font-semibold text-gray-800">
                  <input
                    type="checkbox"
                    checked={form.reviewStatus === 'reviewed'}
                    onChange={(event) => updateForm('reviewStatus', event.target.checked ? 'reviewed' : 'draft')}
                    disabled={locked}
                    className="h-4 w-4 accent-violet-700"
                  />
                  Faktagranskad
                </label>
              </div>
            </div>

            <div className="sticky bottom-2 z-10 mt-5 flex flex-wrap items-center justify-between gap-2 rounded-md border border-gray-200 bg-white/95 p-2 shadow-lg backdrop-blur">
              <span className="px-1 text-xs text-gray-600">
                {form.reviewStatus === 'reviewed' ? 'Granskad och tillgänglig för AI.' : 'Utkast, används inte av AI ännu.'}
              </span>
              <button
                type="button"
                onClick={() => void saveObservation()}
                disabled={locked || saving || transcribing || recording}
                className="inline-flex h-10 min-w-32 items-center justify-center gap-2 rounded-md bg-violet-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {saving ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Check size={16} aria-hidden />}
                Spara
              </button>
            </div>
          </div>
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
                Underlag: {reviewedCount} faktagranskade observationer
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
              Inga observationer är faktagranskade. Ett förslag kan bara bygga på ärendets grunduppgifter.
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
                        onClick={() => observation && selectObservation(observation)}
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
            ? `${observations.length - reviewedCount} observationer behöver faktagranskas innan helhetsanalysen kan starta.`
            : 'Underlaget är faktagranskat och klart för en samlad bedömning.'}
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
    </div>
  )
}
