import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Menu } from 'lucide-react'
import { ObBuildingContext } from '@/components/ob/ObBuildingContext'
import { ObFloorContext } from '@/components/ob/ObFloorProvider'
import ObStepGrunddata from '@/components/ob/ObStepGrunddata'
import ObStepForutsattningar from '@/components/ob/ObStepForutsattningar'
import ObStepHandlingar from '@/components/ob/ObStepHandlingar'
import ObLocalDraftStatus from '@/components/ob/ObLocalDraftStatus'
import ObStepMenu, { type ObMenuSection } from '@/components/ob/ObStepMenu'
import { inspectionId, inspection, property, overview, parts } from './ob-forms-client'

const params = new URLSearchParams(location.search)
const sections: ObMenuSection[] = [{ key: 'grunddata', label: 'Fastighet & uppdrag' }, ...parts.map(part => ({ key: 'forutsattningar' as const, label: `Förutsättningar · ${part.name}`, partId: part.id })), { key: 'handlingar', label: 'Handlingar & upplysningar' }]
function App() {
  const [section, setSection] = useState(params.get('section') === 'documents' ? sections.length - 1 : params.get('section') === 'conditions' ? (params.has('extra') ? 2 : 1) : 0)
  const [menu, setMenu] = useState(false)
  const [propertyData, setProperty] = useState(property)
  const [inspectionData, setInspection] = useState(inspection)
  const [data, setData] = useState(overview)
  const part = data.parts[Math.max(0, Math.min(section - 1, data.parts.length - 1))]
  const legacy = params.has('legacy')
  return <ObBuildingContext.Provider value={{ inspectionId, overview: legacy ? { ...data, structure: null } : data,
    part: legacy ? null : part, reload: async () => setData({ ...overview }) }}>
    <ObFloorContext.Provider value={{ model: params.has('legacy-floors') ? null : part.floor_model, update: () => {} }}>
      <main className="ob-form-shell" style={{ maxWidth: 1280, padding: 20, margin: 'auto', background: 'white' }}>
        <header className="obm-root" style={{ paddingBottom: 20, minHeight: 0 }}>
          <div className="flex items-center justify-between gap-3">
            <img src="/logo.png" alt="BesiktApp" width="125" />
            <button className="obm-icon" title="Öppna stegmeny" aria-label="Öppna stegmeny" onClick={() => setMenu(true)}><Menu /></button>
          </div>
          <p className="ob-form-muted">Testgatan 1 · syntetiska testuppgifter</p>
          <h1 style={{ fontSize: '1.5rem', marginTop: 12 }}>{sections[section].label}</h1>
        </header>
        <ObLocalDraftStatus inspectionId={inspectionId} compact={section === 0 && !params.has('review')} />
        {section === 0 ? <ObStepGrunddata property={propertyData as any} inspection={inspectionData as any}
          workspace={!params.has('review')}
          onPropertyUpdated={setProperty} onInspectionUpdated={setInspection} /> : section === sections.length - 1 ?
          <ObStepHandlingar property={propertyData as any} inspection={inspectionData as any} /> :
          <ObStepForutsattningar key={part.id} inspection={inspectionData as any} property={propertyData as any} onInspectionUpdated={setInspection} />}
        {menu && <ObStepMenu sections={sections} buildings={parts.map(part => ({ id: part.id, name: part.name }))} activeIndex={section}
          onClose={() => setMenu(false)} onBack={() => { setSection(0); setMenu(false) }}
          onSelect={next => { setSection(sections.indexOf(next)); setMenu(false) }} />}
      </main>
    </ObFloorContext.Provider>
  </ObBuildingContext.Provider>
}
createRoot(document.getElementById('root')!).render(<App />)
