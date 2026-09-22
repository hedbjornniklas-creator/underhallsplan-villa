import { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import DebouncedTextarea from '@/components/ob/DebouncedTextarea'
import { AppToastProvider, useToast } from '@/components/ui/AppToastProvider'
import Sheet from '@/components/ob/ObRoundSheet'
import ObLocalDraftStatus from '@/components/ob/ObLocalDraftStatus'

function Fixture() {
  const [open, setOpen] = useState(true)
  const [saved, setSaved] = useState('')
  const [fail, setFail] = useState(false)
  const [dialog, setDialog] = useState(false)
  const [locked, setLocked] = useState(false)
  const [formLocked, setFormLocked] = useState(false)
  const failRef = useRef(fail)
  failRef.current = fail
  const toast = useToast()
  return <main>
    <ObLocalDraftStatus inspectionId="feedback" readSaved={async (_id, entry) => {
      if (entry.path.includes('read-failure')) throw Error('Synthetic read error')
      if (entry.path.includes('unknown')) return null
      return { note: 'Serverns text', risk_text: '', ftu_text: '' }
    }} />
    <button onClick={() => setOpen(value => !value)}>Visa textfält</button>
    <button onClick={() => setFail(value => !value)}>Sparfel: {String(fail)}</button>
    <button onClick={() => setLocked(value => !value)}>Låst: {String(locked)}</button>
    <button onClick={() => setFormLocked(value => !value)}>Formulär låst: {String(formLocked)}</button>
    <output>{saved}</output>
    <fieldset disabled={formLocked}>{open && <DebouncedTextarea aria-label="Testtext" draftKey="ob:feedback:grunddata:attendees_other"
      value="Original" disabled={locked} debounceMs={200} onSave={async value => {
        if (value === 'Fördröjt fel') {
          await new Promise(resolve => setTimeout(resolve, 1000))
          throw Error('Synthetic late failure')
        }
        await new Promise(resolve => setTimeout(resolve, 30))
        if (failRef.current) throw Error('Synthetic save failure')
        setSaved(value)
        // Deliberately retain the old prop until a later server render.
      }} />}</fieldset>
    <button onClick={() => toast.error('Testfel', { durationMs: 500 })}>Visa kort notis</button>
    <button onClick={() => setDialog(true)}>Öppna dialog</button>
    {dialog && <Sheet title="Testdialog" onClose={() => setDialog(false)}>
      <button onClick={() => toast.error('Kunde inte koppla bilden. Försök igen.')}>Visa dialogfel</button>
    </Sheet>}
  </main>
}
createRoot(document.getElementById('root')!).render(<AppToastProvider><Fixture /></AppToastProvider>)
