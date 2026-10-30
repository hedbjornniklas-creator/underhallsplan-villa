import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import TaskComposerSheet from '../../src/components/tasks/TaskComposerSheet'
import UppdragScope from '../../src/components/tasks/UppdragScope'
import type { TaskPerson } from '../../src/lib/tasks/contracts'

const people: TaskPerson[] = ['self', 'other'].map((id, index) => ({ id, kind: 'profile', name: index ? 'Bo Exempel' : 'Anna Exempel', email: `${id}@example.test`, phone: null, companyName: null, whatsappNumber: null, isActive: true }))
function Fixture() {
  const [open, setOpen] = useState(true), [payload, setPayload] = useState<unknown>(null), [fail, setFail] = useState(false)
  return <UppdragScope><main className="min-h-screen bg-white p-6">
    <h1>Fiktivt test av egna uppgifter</h1>
    <label><input aria-label="Simulera sparfel" type="checkbox" checked={fail} onChange={event => setFail(event.target.checked)} />Simulera sparfel</label>
    <button onClick={() => setOpen(true)}>Ny testuppgift</button>
    <output aria-label="Sparat underlag">{JSON.stringify(payload)}</output>
    {open ? <TaskComposerSheet open parentTask={null} suggestion={null} people={people} currentUserId="self" busy={false} onClose={() => setOpen(false)} onCreate={async value => {
      setPayload(value)
      if (fail) throw Error('Fiktivt sparfel')
      setOpen(false)
    }} /> : null}
  </main></UppdragScope>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
