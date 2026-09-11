'use client'

import { useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { MAX_ROOM_NAME_LENGTH } from '@/lib/ob/renameRoundRoom'
import type { InteriorRoom } from './ObStepRunda'
import Sheet from './ObRoundSheet'

export default function ObRoundRenameRoom({ room, blocked, onRename, onRenamed, onClose }: {
  room: InteriorRoom
  blocked: boolean
  onRename: (room: InteriorRoom, name: string) => Promise<InteriorRoom>
  onRenamed: (room: InteriorRoom) => void
  onClose: () => void
}) {
  const [name, setName] = useState(room.room_label || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const flight = useRef(false)
  const valid = name.trim().length > 0 && name.trim().length <= MAX_ROOM_NAME_LENGTH
  async function save() {
    if (blocked || flight.current || !valid) return
    if (name.trim() === room.room_label) { onClose(); return }
    flight.current = true
    setBusy(true)
    setError('')
    try {
      onRenamed(await onRename(room, name.trim()))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunde inte spara rumsnamnet. Försök igen.')
    } finally {
      flight.current = false
      setBusy(false)
    }
  }
  return <Sheet title="Byt rumsnamn" onClose={onClose} closeDisabled={busy}
    footer={<button type="submit" form="obm-rename-room" className="obm-primary" disabled={blocked || busy || !valid}>
      <Check size={18} />{busy ? 'Sparar…' : 'Spara namn'}
    </button>}>
    <form id="obm-rename-room" onSubmit={event => { event.preventDefault(); void save() }}>
      <label className="obm-field">Rumsnamn
        <input autoFocus value={name} maxLength={MAX_ROOM_NAME_LENGTH} readOnly={blocked || busy}
          onChange={event => setName(event.target.value)} onFocus={event => event.target.select()} />
      </label>
      {error && <p role="alert" className="obm-error">{error}</p>}
    </form>
  </Sheet>
}
