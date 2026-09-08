import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import GettingStarted from '../../src/components/besiktapp/GettingStarted'
import ProfileStartReturn from '../../src/components/besiktapp/ProfileStartReturn'
import { startModule } from '../../src/lib/besiktapp/gettingStarted'
function Preview() {
  const params = new URLSearchParams(location.search)
  const selected = startModule(params.get('module')) || 'ob'
  const [opened, setOpened] = useState(false)
  const [pending, setPending] = useState(true)
  return <main style={{ maxWidth: params.has('narrow') ? 390 : 1120, margin: '20px auto', padding: 16 }}>
    <p className="rounded-lg bg-amber-50 p-3 text-sm">Isolerad testvy. Fiktiv profil. Inga uppdrag eller mejl skapas.</p>
    {params.has('besiktStart') ? <><button className="my-4 underline" onClick={() => setPending(false)}>Simulera slutförd autosparning</button><ProfileStartReturn pending={pending} error={null} onRetry={() => {}} /></> : <>
      {selected === 'ob' ? <GettingStarted module="ob" /> : <GettingStarted module={selected} onStart={() => setOpened(true)} />}
      {opened && <p role="status">Formuläret öppnades via callback. Ingen post skapades.</p>}
    </>}
  </main>
}
createRoot(document.getElementById('root')!).render(<Preview />)
