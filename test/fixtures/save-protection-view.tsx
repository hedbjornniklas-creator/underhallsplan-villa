import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ProjectSaveProtectionProvider, useProjectSaveNavigation, useProjectSaveProtection } from '@/components/tasks/ProjectSaveProtection'
import { useQuestionAutosave } from '@/components/tasks/useQuestionAutosave'
import UppdragScope from '@/components/tasks/UppdragScope'
import ActionCaseRequestSheet from '@/components/tasks/ActionCaseQuoteRequests'
import type { ActionCaseView } from '@/lib/action-cases/contracts'

function Editor() {
  const [text, setText] = useState(''), [file, setFile] = useState(false), [read, setRead] = useState(false)
  const [manual, setManual] = useState(''), [fail, setFail] = useState(false), [delay, setDelay] = useState(0)
  const [view, setView] = useState('Projektarbete'), [saves, setSaves] = useState(0)
  const [requestOpen, setRequestOpen] = useState(false)
  const navigate = useProjectSaveNavigation()
  const autosave = useQuestionAutosave<string>({ valid: () => true, save: async () => {
    await new Promise(resolve => setTimeout(resolve, delay))
    if (fail) throw Error('Simulerat sparfel')
    setSaves(value => value + 1)
  }, onSaved: () => undefined })
  const seed = React.useRef(autosave.seed)
  useEffect(() => { setText(seed.current('save-protection-fixture', '', 0) || '') }, [])
  useProjectSaveProtection({ label: 'Projektarbete · Testmoment', pending: autosave.dirty || autosave.busy, lossRisk: !autosave.local,
    detail: autosave.error || 'Utkastet finns på den här enheten.', view: 'work', flush: autosave.flush })
  useProjectSaveProtection({ label: 'Bilder och filer · Testbild.png', pending: file, detail: 'Bilden är inte uppladdad.', view: 'files' })
  useProjectSaveProtection({ label: 'Offertförfrågan · Testleverantör', pending: Boolean(manual), detail: 'Mottagarens namn är inte sparat.', view: 'work' })
  return <main className="gizmo-project-page"><h1>Fiktivt test av sparningsskydd</h1><p>Inga riktiga projektuppgifter eller utskick.</p>
    <nav><button onClick={() => void navigate?.(() => setView('Tidsplan'))}>Till Tidsplan</button><button onClick={() => void navigate?.(() => setView('Projektarbete'))}>Till Projektarbete</button><a href="/annan-sida">Annan sida</a></nav>
    <h2 data-testid="view">{view}</h2><label>Testtext<textarea value={text} onChange={event => { setText(event.target.value); autosave.change(event.target.value) }} /></label>
    <label>Mottagare<input value={manual} onChange={event => setManual(event.target.value)} /></label>
    <label><input type="checkbox" checked={file} onChange={event => setFile(event.target.checked)} /> Fil väntar på uppladdning</label>
    <label><input type="checkbox" checked={read} onChange={event => setRead(event.target.checked)} /> Bakgrundshämtning / orört fönster</label>
    <label><input type="checkbox" checked={fail} onChange={event => setFail(event.target.checked)} /> Simulerat sparfel</label>
    <label>Svarstid<input type="number" value={delay} onChange={event => setDelay(Number(event.target.value))} /></label>
    <button onClick={() => void autosave.retry()}>Återförsök</button><button onClick={() => setTimeout(() => setFile(false), 800)}>Slutför testuppladdning</button><button onClick={() => setRequestOpen(true)}>Öppna offertförfrågan</button><output data-testid="save">{autosave.dirty ? autosave.error || 'Osparat' : 'Sparat'}</output><output data-testid="saves">{saves}</output>
    {requestOpen && <ActionCaseRequestSheet actionCase={{ id: '00000000-0000-4000-8000-000000000001', title: 'Fiktivt projekt', propertyAddress: 'Fiktiv adress', items: [], attachments: [], participants: [], quoteRequests: [] } as unknown as ActionCaseView} requestId={null} busy={false} onClose={() => setRequestOpen(false)} onAction={async () => false} onSupplement={() => {}} onOpenWork={() => {}} />}
  </main>
}
function App() { return <UppdragScope><ProjectSaveProtectionProvider onLocate={() => {}}><Editor /></ProjectSaveProtectionProvider></UppdragScope> }
createRoot(document.getElementById('root')!).render(<App />)
