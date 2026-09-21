import { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import DebouncedTextarea from '@/components/ob/DebouncedTextarea'
import { AppToastProvider, useToast } from '@/components/ui/AppToastProvider'
import Sheet from '@/components/ob/ObRoundSheet'

function Fixture() {
  const [open, setOpen] = useState(true)
  const [saved, setSaved] = useState('')
  const [fail, setFail] = useState(false)
  const [dialog, setDialog] = useState(false)
  const failRef = useRef(fail)
  failRef.current = fail
  const toast = useToast()
  return <main>
    <button onClick={() => setOpen(value => !value)}>Visa textfält</button>
    <button onClick={() => setFail(value => !value)}>Sparfel: {String(fail)}</button>
    <output>{saved}</output>
    {open && <DebouncedTextarea aria-label="Testtext" draftKey="ob:feedback:grunddata:attendees_other"
      value="Original" debounceMs={40} onSave={async value => {
        await new Promise(resolve => setTimeout(resolve, 30))
        if (failRef.current) throw Error('Synthetic save failure')
        setSaved(value)
        // Deliberately retain the old prop until a later server render.
      }} />}
    <button onClick={() => toast.error('Testfel', { durationMs: 500 })}>Visa kort notis</button>
    <button onClick={() => setDialog(true)}>Öppna dialog</button>
    {dialog && <Sheet title="Testdialog" onClose={() => setDialog(false)}>
      <button onClick={() => toast.error('Kunde inte koppla bilden. Försök igen.')}>Visa dialogfel</button>
    </Sheet>}
  </main>
}
createRoot(document.getElementById('root')!).render(<AppToastProvider><Fixture /></AppToastProvider>)
