'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Link2,
  Loader2,
  Save,
  X,
} from 'lucide-react'
import { useToast } from '@/components/ui/AppToastProvider'
import {
  TU_CONTROL_PLAN_UPDATED_EVENT,
  TU_VERIFICATION_STATUS_OPTIONS,
  type TuControlPlanResponse,
  type TuControlPlanState,
  type TuVerificationItem,
  type TuVerificationStatus,
} from '@/lib/tu/controlPlan'
import type { TuEvidenceResponse, TuObservation } from '@/lib/tu/evidence'

function statusLabel(value: TuVerificationStatus) {
  return TU_VERIFICATION_STATUS_OPTIONS.find((option) => option.value === value)?.label
    ?? 'Inte kontrollerad'
}

function statusTone(value: TuVerificationStatus) {
  if (value === 'verified' || value === 'consistent') return 'bg-emerald-50 text-emerald-800'
  if (value === 'remaining_condition' || value === 'partially_verified') return 'bg-amber-50 text-amber-900'
  if (value === 'reported_not_verifiable' || value === 'inaccessible') return 'bg-sky-50 text-sky-900'
  if (value === 'not_applicable') return 'bg-gray-100 text-gray-600'
  return 'bg-violet-50 text-violet-800'
}

function observationTitle(observation: TuObservation) {
  return observation.location || observation.buildingComponent || 'Fältpost'
}

function observationSummary(observation: TuObservation) {
  const text = observation.transcriptText?.trim() || observation.noteText.trim()
  return text || `${observation.imageIds.length} kopplade bilder`
}

export default function TuPostDamageFieldChecklist({
  inspectionId,
  preparation,
  locked,
}: {
  inspectionId: string
  preparation: TuControlPlanState | null
  locked: boolean
}) {
  const toast = useToast()
  const [items, setItems] = useState<TuVerificationItem[]>(preparation?.items ?? [])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [verificationStatus, setVerificationStatus] = useState<TuVerificationStatus>('not_checked')
  const [needsFollowUp, setNeedsFollowUp] = useState(false)
  const [inspectorNote, setInspectorNote] = useState('')
  const [observations, setObservations] = useState<TuObservation[]>([])
  const [selectedObservationIds, setSelectedObservationIds] = useState<string[]>([])
  const [observationsLoading, setObservationsLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => setItems(preparation?.items ?? []), [preparation])

  const visibleItems = useMemo(
    () => items.filter((item) => item.reviewStatus === 'accepted'),
    [items]
  )
  const selected = visibleItems.find((item) => item.id === selectedId) ?? null
  const completedCount = visibleItems.filter((item) => item.verificationStatus !== 'not_checked').length

  useEffect(() => {
    if (!selected) return
    setVerificationStatus(selected.verificationStatus)
    setNeedsFollowUp(selected.needsFollowUp)
    setInspectorNote(selected.inspectorNote ?? '')
    setSelectedObservationIds(selected.observationIds)
  }, [selected])

  useEffect(() => {
    if (!selectedId) return
    const controller = new AbortController()
    setObservationsLoading(true)
    fetch(`/api/tu/investigations/${inspectionId}/observations`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({})) as TuEvidenceResponse
        if (!response.ok) throw new Error(payload.error || 'Kunde inte hämta fältposterna.')
        setObservations(payload.observations ?? [])
      })
      .catch((error) => {
        if (controller.signal.aborted) return
        toast.error(error, 'Kunde inte hämta fältposterna.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setObservationsLoading(false)
      })
    return () => controller.abort()
  }, [inspectionId, selectedId, toast])

  useEffect(() => {
    if (!selected) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) setSelectedId(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [saving, selected])

  const saveResult = async () => {
    if (!selected) return
    setSaving(true)
    try {
      const response = await fetch(`/api/tu/investigations/${inspectionId}/preparation`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target: 'item',
          itemId: selected.id,
          verificationStatus,
          needsFollowUp,
          inspectorNote,
        }),
      })
      const itemPayload = await response.json().catch(() => ({})) as TuControlPlanResponse
      if (!response.ok || !itemPayload.item) {
        throw new Error(itemPayload.error || 'Kunde inte spara kontrollresultatet.')
      }

      const linkResponse = await fetch(`/api/tu/investigations/${inspectionId}/preparation`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target: 'links',
          itemId: selected.id,
          observationIds: selectedObservationIds,
        }),
      })
      const linkPayload = await linkResponse.json().catch(() => ({})) as TuControlPlanResponse
      if (!linkResponse.ok || !linkPayload.item) {
        throw new Error(linkPayload.error || 'Kontrollresultatet sparades, men fältposterna kunde inte kopplas.')
      }
      setItems((current) => current.map((item) => item.id === itemPayload.item?.id
        ? { ...itemPayload.item, observationIds: linkPayload.item?.observationIds ?? [] }
        : item))
      window.dispatchEvent(new CustomEvent(TU_CONTROL_PLAN_UPDATED_EVENT, {
        detail: { inspectionId },
      }))
      toast.success('Kontrollresultatet har sparats.', { appearance: 'dark' })
      setSelectedId(null)
    } catch (error) {
      toast.error(error, 'Kunde inte spara kontrollresultatet.')
    } finally {
      setSaving(false)
    }
  }

  if (preparation?.case.status !== 'plan_approved' || visibleItems.length === 0) return null

  return (
    <>
      <section className="overflow-hidden rounded-lg border border-violet-200 bg-white shadow-sm">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-violet-50 text-violet-700">
              <ClipboardCheck size={18} aria-hidden />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-gray-950">Kontrollplan</h2>
              <p className="text-xs text-gray-500">{completedCount} av {visibleItems.length} punkter kontrollerade</p>
            </div>
          </div>
          <div className="h-1.5 w-32 overflow-hidden rounded-full bg-gray-100" aria-hidden>
            <div
              className="h-full bg-violet-600 transition-all"
              style={{ width: `${visibleItems.length ? (completedCount / visibleItems.length) * 100 : 0}%` }}
            />
          </div>
        </header>
        <div className="divide-y divide-gray-100">
          {visibleItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelectedId(item.id)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-violet-50/40"
            >
              <span className={`inline-flex size-7 shrink-0 items-center justify-center rounded-full ${statusTone(item.verificationStatus)}`}>
                {item.verificationStatus === 'verified' || item.verificationStatus === 'consistent'
                  ? <CheckCircle2 size={15} aria-hidden />
                  : <span className="size-2 rounded-full bg-current opacity-60" aria-hidden />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold leading-5 text-gray-950">{item.title}</span>
                <span className="mt-0.5 block text-xs text-gray-500">{statusLabel(item.verificationStatus)}{item.needsFollowUp ? ' · behöver följas upp' : ''}</span>
              </span>
              <ChevronRight size={17} className="shrink-0 text-gray-400" aria-hidden />
            </button>
          ))}
        </div>
      </section>

      {selected ? (
        <div className="fixed inset-0 z-[300] flex justify-end bg-black/35" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !saving) setSelectedId(null)
        }}>
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="tu-control-result-title"
            className="flex h-full w-full max-w-xl flex-col bg-white shadow-2xl"
          >
            <header className="flex items-start justify-between gap-4 border-b border-gray-200 px-4 py-4 sm:px-5">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase text-violet-700">Kontrollpunkt</p>
                <h2 id="tu-control-result-title" className="mt-1 text-lg font-semibold leading-6 text-gray-950">{selected.title}</h2>
              </div>
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                disabled={saving}
                aria-label="Stäng"
                title="Stäng"
                className="inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-gray-200 text-gray-600 transition hover:bg-gray-50"
              >
                <X size={18} aria-hidden />
              </button>
            </header>
            <div className="flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-5">
              <div>
                <p className="text-xs font-semibold uppercase text-gray-500">Vad ska kontrolleras?</p>
                <p className="mt-1 text-sm leading-6 text-gray-800">{selected.description}</p>
              </div>
              {selected.verificationMethod ? (
                <div>
                  <p className="text-xs font-semibold uppercase text-gray-500">Föreslagen kontrollmetod</p>
                  <p className="mt-1 text-sm leading-6 text-gray-800">{selected.verificationMethod}</p>
                </div>
              ) : null}
              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-gray-900">Kontrollresultat</span>
                <select
                  value={verificationStatus}
                  onChange={(event) => setVerificationStatus(event.target.value as TuVerificationStatus)}
                  disabled={locked || saving}
                  className="h-11 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-950 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100 disabled:bg-gray-100"
                >
                  {TU_VERIFICATION_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-gray-900">Notering <span className="font-normal text-gray-500">(valfritt)</span></span>
                <textarea
                  value={inspectorNote}
                  onChange={(event) => setInspectorNote(event.target.value)}
                  disabled={locked || saving}
                  rows={5}
                  placeholder="Skriv kort vad som kunde verifieras, vad som inte var åtkomligt eller vad som återstår."
                  className="w-full resize-y rounded-md border border-gray-300 bg-white px-3 py-2 text-sm leading-6 text-gray-950 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100 disabled:bg-gray-100"
                />
              </label>
              <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-800">
                <input
                  type="checkbox"
                  checked={needsFollowUp}
                  onChange={(event) => setNeedsFollowUp(event.target.checked)}
                  disabled={locked || saving}
                  className="size-4 rounded border-gray-300 text-violet-700 focus:ring-violet-500"
                />
                Behöver följas upp
              </label>
              <details className="rounded-md border border-gray-200 bg-gray-50/60">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-3 text-sm font-semibold text-gray-900">
                  <span className="inline-flex items-center gap-2">
                    <Link2 size={16} className="text-violet-700" aria-hidden />
                    Koppla fältposter
                  </span>
                  <span className="rounded bg-white px-2 py-0.5 text-xs font-medium text-gray-600">
                    {selectedObservationIds.length} valda
                  </span>
                </summary>
                <div className="border-t border-gray-200 p-3">
                  {observationsLoading ? (
                    <p className="flex items-center gap-2 py-2 text-sm text-gray-600">
                      <Loader2 size={15} className="animate-spin text-violet-700" aria-hidden /> Hämtar fältposter...
                    </p>
                  ) : observations.length === 0 ? (
                    <p className="py-2 text-sm text-gray-600">Det finns ännu inga fältposter att koppla.</p>
                  ) : (
                    <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                      {observations.map((observation) => {
                        const checked = selectedObservationIds.includes(observation.id)
                        return (
                          <label key={observation.id} className="flex cursor-pointer items-start gap-3 rounded-md border border-gray-200 bg-white px-3 py-2 hover:border-violet-200">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) => setSelectedObservationIds((current) => event.target.checked
                                ? [...new Set([...current, observation.id])]
                                : current.filter((id) => id !== observation.id))}
                              disabled={locked || saving}
                              className="mt-1 size-4 shrink-0 rounded border-gray-300 text-violet-700 focus:ring-violet-500"
                            />
                            <span className="min-w-0">
                              <span className="block text-sm font-semibold text-gray-900">{observationTitle(observation)}</span>
                              <span className="mt-0.5 line-clamp-2 block text-xs leading-5 text-gray-600">{observationSummary(observation)}</span>
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  )}
                </div>
              </details>
              <p className="text-xs leading-5 text-gray-500">
                Bilder, röst och mer omfattande iakttagelser sparas som vanliga fältposter. Koppla relevanta fältposter så att kontrollresultatet blir spårbart i analysen och utlåtandet.
              </p>
            </div>
            <footer className="flex justify-end gap-2 border-t border-gray-200 px-4 py-4 sm:px-5">
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                disabled={saving}
                className="inline-flex h-10 items-center rounded-md border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
              >
                Avbryt
              </button>
              <button
                type="button"
                onClick={() => void saveResult()}
                disabled={locked || saving}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-violet-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {saving ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Save size={16} aria-hidden />}
                Spara kontrollresultat
              </button>
            </footer>
          </aside>
        </div>
      ) : null}
    </>
  )
}
