import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AppToastProvider } from '@/components/ui/AppToastProvider'
import { ObBuildingContext } from '@/components/ob/ObBuildingContext'
import { ObFloorContext } from '@/components/ob/ObFloorProvider'
import ObStepGrunddata from '@/components/ob/ObStepGrunddata'
import ObOrganizationBoundary from '@/components/ob/ObOrganizationBoundary'
import ObStepForutsattningar from '@/components/ob/ObStepForutsattningar'
import ObStepHandlingar from '@/components/ob/ObStepHandlingar'
import ObInspectionHeader, { ObInspectionNavigationContext } from '@/components/ob/ObInspectionHeader'
import ObWizard from '@/components/ob/ObWizard'
import MobileRoundFixture from './ob-mobile-round'
import ObStepMenu, { type ObMenuSection } from '@/components/ob/ObStepMenu'
import { inspectionId, inspection, property, overview, parts } from './ob-forms-client'

const params = new URLSearchParams(location.search)
const sections: ObMenuSection[] = [{ key: 'grunddata', label: 'Fastighet & uppdrag' }, { key: 'handlingar', label: 'Handlingar & upplysningar' },
  ...parts.flatMap(part => [{ key: 'forutsattningar' as const, label: `Förutsättningar · ${part.name}`, partId: part.id },
    { key: 'runda-ny' as const, label: `ÖB-runda · ${part.name}`, partId: part.id }]), { key: 'delivery', label: 'Skicka utlåtande' }]
const documentsIndex = 1
function App() {
  const [section, setSection] = useState(params.get('section') === 'documents' ? documentsIndex : params.get('section') === 'delivery' ? sections.length - 1 : params.get('section') === 'round' ? 3 : params.get('section') === 'conditions' ? (params.has('extra') ? 4 : 2) : 0)
  const [menu, setMenu] = useState(false)
  const [propertyData, setProperty] = useState(property)
  const [inspectionData, setInspection] = useState(inspection)
  const [data, setData] = useState(overview)
  const part = data.parts.find(part => part.id === sections[section].partId) ?? data.parts[0]
  const legacy = params.has('legacy')
  const round = sections[section].key === 'runda-ny'
  useEffect(() => { window.scrollTo(0, 0) }, [section])
  return <ObBuildingContext.Provider value={{ inspectionId, overview: legacy ? { ...data, structure: null } : data,
    part: legacy ? null : part, reload: async () => setData({ ...overview }) }}>
    <ObFloorContext.Provider value={{ model: params.has('legacy-floors') ? null : part.floor_model, update: () => {} }}>
      <main className="ob-inspection-page">
        <ObInspectionNavigationContext.Provider value={{ address: params.has('long-address') ? 'Långa testadressens allé 123, Västra Teststaden' : 'Testgatan 1',
          step: section + 1, total: sections.length, onBack: () => setSection(0) }}>
        <div className="ob-form-shell ob-inspection-shell">
        {!round && <ObInspectionHeader inspectionId={inspectionId} title={sections[section].label} onOpenMenu={() => setMenu(true)} />}
        <div className={`ob-inspection-content${round ? ' ob-inspection-content-round' : ''}`}>
        {section === 0 ? <ObStepGrunddata property={propertyData as any} inspection={inspectionData as any}
          workspace={!params.has('review')}
          onPropertyUpdated={setProperty} onInspectionUpdated={setInspection} /> : section === documentsIndex ?
          <ObStepHandlingar property={propertyData as any} inspection={inspectionData as any} /> : round ?
          <MobileRoundFixture key={part.id} buildingName={part.name} onOpenStepMenu={() => setMenu(true)} storageKey={`layout:${part.id}`} /> : sections[section].key === 'delivery' ?
          <ObWizard property={{ ...propertyData, id: '10000000-0000-4000-8000-000000000099' } as any} inspection={inspectionData as any}
            onInspectionUpdated={setInspection} activeSection="delivery" /> :
          <ObStepForutsattningar key={part.id} inspection={inspectionData as any} property={propertyData as any} onInspectionUpdated={setInspection} />}
        </div>
        </div>
        </ObInspectionNavigationContext.Provider>
        {menu && <ObStepMenu sections={sections} buildings={parts.map(part => ({ id: part.id, name: part.name }))} activeIndex={section}
          onClose={() => setMenu(false)} onBack={() => { setSection(0); setMenu(false) }}
          onSelect={next => { setSection(sections.indexOf(next)); setMenu(false) }} />}
      </main>
    </ObFloorContext.Provider>
  </ObBuildingContext.Provider>
}
createRoot(document.getElementById('root')!).render(<AppToastProvider><ObOrganizationBoundary><App /></ObOrganizationBoundary></AppToastProvider>)
