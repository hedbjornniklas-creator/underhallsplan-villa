'use client'
import { useEffect, useRef, useState } from 'react'
import { Loader2, Save } from 'lucide-react'

type Manager = { managerId: string | null; managerName: string; canEdit: boolean; people: Array<{ id: string; name: string }> }
export default function ProjectManagerField({ caseId, active, disabled = false, onChanged }: { caseId: string; active: boolean; disabled?: boolean; onChanged: () => void }) {
  const [data, setData] = useState<Manager | null>(null), [value, setValue] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [notice, setNotice] = useState('')
  const running = useRef(false)
  useEffect(() => {
    if (!active) return
    const c = new AbortController()
    void (async () => {
      try {
        const r = await fetch(`/api/action-cases/${caseId}/manager`, { signal: c.signal, cache: 'no-store' }), result = await r.json()
        if (!r.ok) throw new Error(result.error || 'Projektansvarig kunde inte hämtas.')
        setData(result); setValue(result.managerId || ''); setError('')
      } catch (e) { if (!c.signal.aborted) setError(e instanceof Error ? e.message : 'Uppgiften kunde inte hämtas.') }
    })()
    return () => c.abort()
  }, [caseId, active])
  async function save() {
    if (!data || disabled || running.current || value === (data.managerId || '')) return
    if (!window.confirm('Ändra projektansvarig? Den nya projektansvariga får åtkomst till projektets frågor och rätt att hantera deras deltagare.')) return
    running.current = true; setBusy(true); setError(''); setNotice('')
    try {
      const r = await fetch(`/api/action-cases/${caseId}/manager`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ managerId: value || null, expectedManagerId: data.managerId }) }), result = await r.json()
      if (!r.ok) throw new Error(result.error || 'Projektansvarig kunde inte sparas.')
      if (result.managerId !== (value || null) || !Array.isArray(result.people)) throw new Error('Sparningen kunde inte bekräftas.')
      setData(result); setNotice('Projektansvarig sparad.'); onChanged()
    } catch (e) { setError(e instanceof Error ? e.message : 'Sparningen misslyckades.') }
    finally { running.current = false; setBusy(false) }
  }
  return <section className="gizmo-overview-row" aria-label="Projektansvarig">
    <div className="w-full max-w-xl"><h3>Projektansvarig</h3>
      {data?.canEdit ? <div className="mt-2 flex flex-wrap items-center gap-2">
        <select aria-label="Projektansvarig" className="min-h-11 min-w-0 max-w-full flex-1 rounded-md border border-[#D5DCDD] bg-white px-3 text-sm" value={value} disabled={busy || disabled} onChange={e => { setValue(e.target.value); setError(''); setNotice('') }}>
          <option value="">Ej utsedd</option>
          {data.managerId && !data.people.some(p => p.id === data.managerId) && <option value={data.managerId}>{data.managerName} (inte tillgänglig)</option>}
          {data.people.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}
        </select>
        <button type="button" className="gizmo-button" disabled={disabled || busy || value === (data.managerId || '')} onClick={() => void save()}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}Utse</button>
      </div> : <p>{data ? data.managerName || 'Ej utsedd' : error ? '' : 'Hämtar…'}</p>}
      {error && <p className="mt-2 text-sm text-rose-700" role="alert">{error}</p>}{notice && <p className="mt-2 text-sm" role="status">{notice}</p>}
    </div>
  </section>
}
