import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import TuEvidenceWorkspace from '@/components/tu/TuEvidenceWorkspace'
import TuFieldLogWorkspace from '@/components/tu/TuFieldLogWorkspace'
import TuWorkflowRail from '@/components/tu/TuWorkflowRail'
import { AppToastProvider } from '@/components/ui/AppToastProvider'
import type { TuObservation } from '@/lib/tu/evidence'
import type { TuWorkflowStep, TuWorkspaceView } from '@/lib/tu/workflow'
import type { TuFieldQueueController } from '@/hooks/useTuFieldQueue'

const date = '2026-10-02T08:00:00Z'
const observations: TuObservation[] = ['Vind', 'Hall', 'Kök'].map((location, index) => ({
  id: `obs-${index + 1}`, sourceType: index === 2 ? 'measurement' : 'typed', location,
  buildingComponent: null, noteText: `Anteckning från ${location}`, transcriptText: null,
  riskNote: null, suggestedFollowUp: null, certainty: 'confirmed', reviewStatus: 'draft',
  targetSectionId: null, includeInReport: true, reportInclusion: 'include', imageIds: ['image-1'],
  audioStorageBucket: null, audioStoragePath: null, audioContentType: null, audioDurationSeconds: null,
  observedAt: date, createdAt: date, updatedAt: date,
  measurements: index !== 2 ? [] : [{
    id: 'measurement-1', observationId: 'obs-3', location, measurementType: 'Fuktindikering',
    valueText: '45,1', unit: 'indikationsvärde', method: 'Fuktindikering utan stift',
    instrument: 'Elma Moisture Max', assessment: 'not_assessable', note: null,
    measuredAt: date, createdAt: date, updatedAt: date,
  }],
}))
const state = {
  observations, gets: 0, patches: 0, assignmentOpened: 0, holdDeletes: false,
  finishDelete: null as null | ((ok: boolean) => void),
  refresh: () => {},
}
Object.assign(window, { __tuEvidenceTest: state })
window.fetch = async (input, init) => {
  const url = String(input)
  if (!url.startsWith('/api/tu/investigations/fixture/')) throw Error(`Unexpected fixture request: ${url}`)
  const payload = JSON.parse(String(init?.body ?? '{}'))
  const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  if (url.includes('/observations') && (!init?.method || init.method === 'GET')) {
    state.gets++
    return respond({ observations: state.observations })
  }
  if (url.includes('/observations') && init?.method === 'DELETE') {
    const ok = await new Promise<boolean>((resolve) => {
      state.finishDelete = resolve
      if (!state.holdDeletes) window.setTimeout(() => resolve(true), 500)
    })
    state.finishDelete = null
    if (!ok) return respond({ error: 'INTERNAL_FIXTURE_FAILURE' }, 500)
    state.observations = state.observations.filter((row) => row.id !== payload.observationId)
    return respond({ ok: true })
  }
  if (url.includes('/observations') && init?.method === 'PATCH') {
    state.patches++
    const row = state.observations.find((row) => row.id === payload.observationId)
    if (!row) throw Error('Fixture observation missing')
    Object.assign(row, payload, { updatedAt: new Date().toISOString() })
    return respond({ observation: row })
  }
  if (url.includes('/measurements') && init?.method === 'PATCH') {
    const measurement = state.observations.flatMap((row) => row.measurements).find((row) => row.id === payload.measurementId)
    if (!measurement) throw Error('Fixture measurement missing')
    Object.assign(measurement, payload)
    return respond({ measurement })
  }
  throw Error(`Unexpected fixture method ${init?.method}: ${url}`)
}
const queue: TuFieldQueueController = {
  items: [], previewUrls: {}, counts: { total: 0, uploading: 0, transcribing: 0, saving: 0, failed: 0, waiting: 0 },
  queueError: null, online: true, completedRevision: 0,
  enqueueFieldEntry: async () => '', enqueueLooseImages: async () => '', enqueueMeasurement: async () => '',
  retryItem: async () => {}, retryAll: async () => {}, processQueue: async () => {},
}
const steps: TuWorkflowStep[] = [
  ['field', 'Dokumentera på plats'], ['evidence', 'Sortera och granska'],
  ['assessment', 'Skapa utlåtandet'], ['report', 'Granska utlåtandet'], ['delivery', 'Fastställ och leverera'],
].map(([id, title], index) => ({ id: id as TuWorkspaceView, title, shortTitle: title, description: '', number: index + 1,
  status: 'in_progress', statusText: 'Testunderlag', blockerCount: 0 }))

function Preview() {
  const [view, setView] = useState<TuWorkspaceView>('field')
  const [focus, setFocus] = useState<{ observationId: string; measurementId?: string; nonce: number } | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)
  const [images, setImages] = useState([{ id: 'image-1', sectionKey: 'bank' as const, publicUrl: '/fixture-image.png', caption: 'Testbild', createdAt: date }])
  const [imageBusy, setImageBusy] = useState(false)
  const locked = new URLSearchParams(location.search).has('locked')
  useEffect(() => {
    state.refresh = () => setRefreshToken((value) => value + 1)
    return () => { state.refresh = () => {} }
  }, [])
  return <AppToastProvider><div className="mx-auto max-w-7xl p-3 sm:p-6">
    <h1 className="mb-4 text-xl font-semibold">TU arbetsflöde · testdata</h1>
    <div className="grid items-start gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
      <TuWorkflowRail steps={steps} current={view} loading={false} onChange={setView} assignmentLocked={locked}
        onEditAssignment={() => { state.assignmentOpened++ }} />
      <main className="min-w-0">
        {view === 'field' ? <TuFieldLogWorkspace inspectionId="fixture" organizationId="org-1" locked={locked} queue={queue} images={images}
          onPreviewImage={() => {}} onDeleteImage={async () => true} onOpenEvidence={() => setView('evidence')}
          onEditObservation={(observationId, measurementId) => { setFocus({ observationId, measurementId, nonce: Date.now() }); setView('evidence') }} /> :
          <TuEvidenceWorkspace inspectionId="fixture" organizationId="org-1" locked={locked} queue={queue} sections={[]} images={images}
            refreshToken={refreshToken} focusRequest={focus} imageBusy={imageBusy}
            onCloseObservation={() => { if (focus) { setFocus(null); setView('field') } }}
            onUploadImages={async (files) => {
              setImageBusy(true)
              const added = files.map((_, index) => ({ id: `image-${images.length + index + 1}`, sectionKey: 'bank' as const, publicUrl: '/fixture-image.png', caption: 'Ny testbild', createdAt: date }))
              setImages((current) => [...current, ...added])
              setImageBusy(false)
              return added.map((image) => image.id)
            }}
            onSetImageSection={async () => {}} onPreviewImage={() => {}} onApplySuggestion={async () => {}}
            onOpenReport={() => {}} onOpenAnalysis={() => {}} />}
      </main>
    </div>
  </div></AppToastProvider>
}
createRoot(document.getElementById('root')!).render(<Preview />)
