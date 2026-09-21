import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ClipboardList, Menu } from 'lucide-react'
import MobileRoundFixture from './ob-mobile-round'
import ObStepMenu, { type ObMenuSection } from '../../src/components/ob/ObStepMenu'
import type { ObMobileRoundProps } from '../../src/components/ob/ObMobileRound'

const buildings = ['Huvudbyggnad', 'Gästhus', 'Garage och verkstad', 'Komplementbyggnad med förråd och övernattningsrum']
const params = new URLSearchParams(location.search)
const building = Math.max(0, Math.min(3, Number(params.get('building')) || 0))
const buildingName = buildings[building]
const menuSections: ObMenuSection[] = buildings.flatMap((name, index) => [
  { key: 'forutsattningar', label: `Förutsättningar · ${name}`, partId: String(index) },
  { key: 'runda-ny', label: `ÖB-runda · ${name}`, partId: String(index) },
])
const qa = (window as unknown as { __obMobileTest: {
  rooms: ObMobileRoundProps['rooms']; notes: ObMobileRoundProps['notes']; images: ObMobileRoundProps['images']; failSaves: boolean
} }).__obMobileTest

// Seed the existing browser fixture before React mounts; retain the real round UI.
qa.rooms[0].room_label = building === 2 ? 'Verkstad' : 'Badrum'
qa.rooms[1].floor_label = 'plan0'
qa.rooms[1].room_label = 'Sovrum med klädkammare och utgång till balkongen'
qa.notes[0] = { ...qa.notes[0], control_point_id: 'point-1', title: 'Golv och ytskikt i våtrum',
  note: 'Spricka noterades i en klinkerplatta intill väggen.', risk_text: 'Bakomliggande skada kan inte uteslutas.' }
qa.notes[1] = { ...qa.notes[1], control_point_id: 'point-1', title: 'Golvbrunnens anslutning', note: 'Tätskiktets anslutning kunde inte kontrolleras okulärt.',
  ftu_text: 'Anslutningen bör undersökas av en fackman.' }
qa.images[0].label = 'Badrum, översikt (testbild)'
qa.images.push({ ...qa.images[0], id: 'brand-linked', control_item_id: 'note-1', processing_status: 'linked' })
qa.failSaves = params.has('save-error')

function App() {
  const [menu, setMenu] = useState(false)
  const [section, setSection] = useState(params.get('section') === 'conditions' ? 'conditions' : 'round')
  function navigate(index: number, next: string) {
    if (index === building) { setSection(next); setMenu(false); return }
    const query = new URLSearchParams(location.search)
    query.set('building', String(index)); query.set('section', next)
    location.assign(`/round?${query}`)
  }
  return <>
    {section === 'round' ? <MobileRoundFixture buildingName={buildingName}
      storageKey={`ob-brand-preview:${building}:notes`} onOpenStepMenu={() => setMenu(true)} /> :
      <main className="obm-root ob-brand-conditions">
        <header className="obm-inspection-header"><div><strong>Överlåtelsebesiktning</strong><span>Testgatan 1 (syntetiskt objekt)</span></div>
          <button className="obm-icon" title="Öppna stegmeny" aria-label="Öppna stegmeny" onClick={() => setMenu(true)}><Menu /></button></header>
        <header className="obm-page-header"><span>{buildingName}</span><h1>Förutsättningar</h1></header>
        <section className="ob-brand-conditions-body">
          <label className="obm-field">Byggnadsår<input defaultValue="1986" inputMode="numeric" /></label>
          <label className="obm-field">Väder<select defaultValue="klart"><option value="klart">Klart väder</option><option>Mulet</option><option>Regn</option></select></label>
          <label className="obm-field">Åtkomlighet<textarea rows={4} defaultValue="Byggnaden var möblerad vid besiktningen. Delar av förrådet var belamrade." /></label>
          <button className="obm-primary" onClick={() => setSection('round')}><ClipboardList size={20} />ÖB-runda</button>
        </section>
      </main>}
    {menu && <ObStepMenu sections={menuSections} buildings={buildings.map((name, index) => ({ id: String(index), name }))}
      activeIndex={building * 2 + (section === 'round' ? 1 : 0)}
      onClose={() => setMenu(false)} onBack={() => { setMenu(false); setSection('round') }}
      onSelect={next => navigate(Number(next.partId), next.key === 'forutsattningar' ? 'conditions' : 'round')} />}
  </>
}
createRoot(document.getElementById('root')!).render(<App />)
