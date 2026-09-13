import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowLeft, ClipboardList } from 'lucide-react'
import { ObBuildingContext } from '@/components/ob/ObBuildingContext'
import ObBuildingOverview from '@/components/ob/ObBuildingOverview'
import ObBuildingCover from '@/components/ob/ObBuildingCover'
import type { ObBuildingOverview as Overview, ObBuildingPart } from '@/lib/ob/buildingStructure'

const root = '10000000-0000-4000-8000-000000000001'
const primary: ObBuildingPart = { id: '10000000-0000-4000-8000-000000000002', inspection_id: root,
  building_id: '10000000-0000-4000-8000-000000000003', name: 'Huvudbyggnad', category_key: 'main',
  cover_path: null, scope_note: null, sort_order: 100, revision: 1, floor_model: { revision: 1, levels: [{ level: 0, name: 'Entréplan' }] } }
let overview: Overview = { available: true, structure: { inspection_id: root, primary_part_id: primary.id, revision: 1 }, parts: [primary],
  buildings: [{ id: primary.building_id, name: primary.name }], categories: [
    { key: 'main', label: 'Huvudbyggnad' }, { key: 'guesthouse', label: 'Gästhus' }, { key: 'garage', label: 'Garage' },
    { key: 'attefall', label: 'Attefallshus' }, { key: 'friggebod', label: 'Friggebod' }, { key: 'complement', label: 'Komplementbyggnad' }] }
const fetchOriginal = window.fetch.bind(window)
window.fetch = async (input, init) => {
  if (String(input) !== `/api/ob/inspections/${root}/buildings`) return fetchOriginal(input, init)
  const { operation, payload } = JSON.parse(String(init?.body))
  if (operation === 'add') {
    const part = { ...primary, id: crypto.randomUUID(), building_id: crypto.randomUUID(), name: payload.name, category_key: payload.categoryKey, sort_order: overview.parts.length * 100 + 100 }
    overview = { ...overview, parts: [...overview.parts, part] }
  } else if (operation === 'edit') overview = { ...overview, parts: overview.parts.map(part => part.id !== payload.partId ? part : {
    ...part, name: payload.name ?? part.name, category_key: payload.categoryKey ?? part.category_key, scope_note: payload.scopeNote ?? part.scope_note,
    cover_path: payload.coverPath ?? part.cover_path, revision: part.revision + 1 }) }
  else if (operation === 'remove') overview = { ...overview, parts: overview.parts.filter(part => part.id !== payload.partId) }
  else throw Error('Unexpected synthetic command')
  return Response.json({ data: overview })
}
function Preview() {
  const [data, setData] = useState(overview)
  const [partId, setPartId] = useState(primary.id)
  const [view, setView] = useState('overview')
  const part = data.parts.find(part => part.id === partId) ?? data.parts[0]
  return <ObBuildingContext.Provider value={{ inspectionId: root, overview: data, part, reload: async () => setData({ ...overview }) }}>
    <main className="mx-auto min-h-screen max-w-3xl bg-white px-4 py-4 text-gray-800">
      <header className="mb-5 flex items-center gap-3 border-b border-gray-200 pb-4">
        {view !== 'overview' && <button title="Tillbaka" aria-label="Tillbaka" className="h-11 w-11" onClick={() => setView('overview')}><ArrowLeft /></button>}
        <div className="min-w-0"><p className="text-xs text-teal-700">ÖB · TESTUPPGIFTER</p><h1 className="text-xl font-semibold">{view === 'overview' ? 'Fastighet & uppdrag' : 'Förutsättningar'}</h1></div>
      </header>
      {view === 'overview' ? <>
        <p className="mb-5 text-sm">Testgatan 1</p><ObBuildingOverview locked={false} />
        <nav className="mt-5 divide-y divide-gray-200" aria-label="Byggnadernas förutsättningar">
          {data.parts.map(part => <button key={part.id} onClick={() => { setPartId(part.id); setView('conditions') }} className="flex min-h-14 w-full items-center gap-3 py-3 text-left text-blue-700">
            <ClipboardList size={21} /><span className="min-w-0 break-words">Förutsättningar · {part.name}</span></button>)}
        </nav>
      </> : <ObBuildingCover locked={false} legacyPath="legacy-cover.jpg" />}
    </main>
  </ObBuildingContext.Provider>
}
createRoot(document.getElementById('root')!).render(<Preview />)
