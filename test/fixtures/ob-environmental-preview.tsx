import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { AppToastProvider } from '@/components/ui/AppToastProvider'
import ObStepEnvironmental from '@/components/ob/ObStepEnvironmental'
import ReportRenderer from '@/components/report/ReportRenderer'
import { buildReportSpec } from '@/lib/report/reportSpec'
import { emptyProtocol, buildEnvironmentalAppendix, type EnvironmentalKind, type EnvironmentalProtocol, type EnvironmentalFile } from '@/lib/ob/environmentalProtocol'

const id = '11111111-1111-4111-8111-111111111111'
const query = new URLSearchParams(location.search)
const kind: EnvironmentalKind = query.get('kind') === 'mould' ? 'mould' : 'radon'
function initial(kind: EnvironmentalKind): EnvironmentalProtocol {
  return { ...emptyProtocol(), fields: kind === 'radon' ? { building_type: 'Villa och garage', building_year: '1985', heating: 'Bergvärme', ventilation: 'Mekanisk frånluft', instrument: 'Testinstrument', started_at: '2026-09-28T08:00', ended_at: '2026-09-29T08:00' } : { purpose: 'Provtagning av missfärgning', laboratory: 'Testlaboratorium', report_reference: 'LAB-TEST-001' },
    rows: [{ id: '22222222-2222-4222-8222-222222222222', fields: kind === 'radon' ? { building: 'Garage', location: 'Plan 0 / Teknikrum', value: '85', uncertainty: '15' } : { building: 'Huvudbyggnad', location: 'Vind', sample_id: 'P1', method: 'Tejpprov', sampled_at: '2026-09-28T09:00', status: 'Inväntar laboratoriesvar' } }] }
}
type State = { document: EnvironmentalProtocol; revision: number; files: EnvironmentalFile[] }
const state = (kind: EnvironmentalKind): State => JSON.parse(sessionStorage.getItem(`preview:${kind}`) || 'null') || { document: initial(kind), revision: 0, files: [] }
const api = { writes: [] as unknown[], fail: false, delay: 100, conflict: false, state, id }
Object.assign(window, { environmentalTest: api })
window.fetch = async (input, options) => {
  const url = String(input), selected = url.includes('/mould') ? 'mould' : 'radon'
  if (!url.startsWith(`/api/ob/inspections/${id}/environmental/`)) throw Error(`Unexpected preview request: ${url}`)
  await new Promise(resolve => setTimeout(resolve, api.delay))
  const current = state(selected)
  if (options?.method === 'PATCH') {
    if (api.fail) return Response.json({ error: 'Test: anslutningen avbröts.' }, { status: 503 })
    const body = JSON.parse(String(options.body))
    if (api.conflict || body.revision !== current.revision) return Response.json({ conflict: true, error: 'Protokollet har ändrats i en annan flik.' }, { status: 409 })
    current.document = body.document; current.revision++
    sessionStorage.setItem(`preview:${selected}`, JSON.stringify(current)); api.writes.push(body)
    return Response.json({ revision: current.revision })
  }
  if (options?.method === 'POST') {
    const file = (options.body as FormData).get('file') as File
    const metadata = { id: crypto.randomUUID(), name: file.name, path: 'synthetic.pdf', size: file.size, sha256: 'a'.repeat(64) }
    current.files.push(metadata); sessionStorage.setItem(`preview:${selected}`, JSON.stringify(current))
    return Response.json({ file: metadata })
  }
  return Response.json(current)
}
function App() {
  const [selected, setSelected] = useState(kind)
  return <AppToastProvider><div className="preview-banner">Förhandsvisning · endast testuppgifter</div><header className="preview-heading"><img src="/report-assets/BesiktApp.png" alt="BesiktApp" /><nav aria-label="Tilläggsuppdrag"><button onClick={() => setSelected('radon')} aria-pressed={selected === 'radon'}>Radonindikering</button><button onClick={() => setSelected('mould')} aria-pressed={selected === 'mould'}>Mögelprov</button></nav></header><main className="preview-form"><ObStepEnvironmental key={selected} kind={selected} inspection={{ id, locked_at: query.has('locked') ? '2026-09-28' : null }} property={{ address: 'Testgatan 1', city: 'Teststad' }} /></main></AppToastProvider>
}
if (query.has('report')) {
  Object.assign(window, { reportTexts: { STD_COVER_BUYER_DUTY_NOTICE: 'Testtext för omslag som inte ingår i denna bilageförhandsvisning.' } })
  const environmental = (['radon', 'mould'] as const).map(kind => {
    const doc = initial(kind)
    if (kind === 'mould') {
      doc.rows[0].fields.status = 'Analyserat'
      doc.rows[0].fields.result = query.has('long') ? `${'Syntetiskt laboratoriesvar för kontroll av sidbrytning. '.repeat(100)} SLUT PÅ PROVRESULTAT.` : 'Laboratoriets analys redovisas här. Endast testuppgifter.'
    }
    return buildEnvironmentalAppendix(doc, kind, [])
  })
  const spec = buildReportSpec({ layoutVersion: 2, dynamicAppendices: { environmental } }).filter(section => section.id.startsWith('appendix-environmental'))
  createRoot(document.getElementById('root')!).render(<ReportRenderer spec={spec} mockData={{ mock: { properties: { address: 'Testgatan 1', cadastral_id: 'TEST 1:1' }, inspections: { date: '2026-09-28' }, appendices: { environmental } } }} rootClassName="report-root--pdf" inspectionSide="buyer" />)
} else createRoot(document.getElementById('root')!).render(<App />)
