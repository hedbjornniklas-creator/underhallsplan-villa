'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, Plus, RefreshCw, Search, UserRoundCheck } from 'lucide-react'
import type { OrganizationCustomerWorkspace } from '@/lib/customers/domain'
import type { ContractCustomerBinding, ContractCustomerLink } from '@/lib/action-cases/customerRegistry'
import type { ContractParties } from '@/lib/action-cases/customerContractParties'
import { useToast } from '@/components/ui/AppToastProvider'

export default function ContractCustomerRegistry({ orgId, link, parties, busy, disabled, historical, onBind }: {
  orgId: string
  link?: ContractCustomerLink
  parties: ContractParties
  busy: boolean
  disabled: boolean
  historical: boolean
  onBind: (binding: ContractCustomerBinding, requestId: string) => Promise<boolean>
}) {
  const toast = useToast()
  const [registry, setRegistry] = useState<OrganizationCustomerWorkspace | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [mode, setMode] = useState<'existing' | 'create'>('existing')
  const [selectedId, setSelectedId] = useState(link?.customerId ?? '')
  const [search, setSearch] = useState('')
  const pending = useRef<{ key: string; id: string } | null>(null)
  useEffect(() => { setSelectedId(link?.customerId ?? '') }, [link?.customerId])
  useEffect(() => {
    if (!link?.available) return
    const controller = new AbortController()
    setLoading(true)
    setFailed(false)
    void (async () => {
      try {
        const response = await fetch(`/api/settings/customers?orgId=${encodeURIComponent(orgId)}`, {
          cache: 'no-store', credentials: 'same-origin', signal: controller.signal
        })
        const body = await response.json()
        if (!response.ok || body.workspace?.organization?.id !== orgId || !Array.isArray(body.workspace.customers))
          throw new Error(body.error || 'Kundregistret kunde inte hämtas.')
        if (!controller.signal.aborted) setRegistry(body.workspace)
      } catch (error) {
        if (!controller.signal.aborted) { setFailed(true); toast.error(error, 'Kundregistret kunde inte hämtas.') }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()
    return () => controller.abort()
  }, [orgId, link?.available, attempt, toast])
  const customers = registry?.customers.filter((row) => row.isActive && row.customerType === 'private') ?? []
  const selected = customers.find((row) => row.id === selectedId)
  const matches = customers.filter((row) => [row.name, row.email, row.customerNumber].some((value) => value?.toLowerCase().includes(search.toLowerCase())))
  const duplicates = customers.filter((row) => row.name.toLowerCase() === parties.customers[0].name.trim().toLowerCase() ||
    (parties.email.trim() && row.email?.toLowerCase() === parties.email.trim().toLowerCase()))
  async function bind() {
    if (busy || disabled) return
    const binding: ContractCustomerBinding | null = mode === 'create' ? { mode } : selected ? {
      mode, customerId: selected.id, customerVersion: selected.version
    } : null
    if (!binding) return
    const key = JSON.stringify({ binding, parties })
    if (pending.current?.key !== key) pending.current = { key, id: crypto.randomUUID() }
    if (await onBind(binding, pending.current.id)) {
      pending.current = null
      setMode('existing')
      setAttempt((value) => value + 1)
    }
  }
  if (!link?.available) return <p className="mb-4 text-sm text-slate-500">Kundkopplingen behöver aktiveras av administratören.</p>
  return <section className="mb-5 border-b border-slate-200 pb-5" aria-label="Kundregister">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold">Kundregister{parties.customers.length > 1 ? ' · beställare 1' : ''}</h3>
      <div className="flex items-center gap-2">
        <span className="text-sm text-slate-600" role="status">{link.customerNumber ? `Kund ${link.customerNumber}` : 'Ingen kund kopplad'}</span>
        <button type="button" className="gizmo-button" title="Uppdatera kundlista" aria-label="Uppdatera kundlista" disabled={loading || busy}
          onClick={() => setAttempt((value) => value + 1)}><RefreshCw size={16} /></button>
      </div>
    </div>
    {historical && <p className="mt-2 text-sm text-slate-600">Kundkopplingen är låst eftersom projektet har publicerade avtalsversioner.</p>}
    {loading ? <p className="mt-3 flex items-center gap-2 text-sm" role="status"><Loader2 size={16} className="animate-spin" /> Hämtar kunder…</p>
      : failed ? <button className="gizmo-button mt-3" onClick={() => setAttempt((value) => value + 1)}><RefreshCw size={16} /> Försök igen</button>
      : <fieldset disabled={disabled || busy} className="mt-3 space-y-3">
        <legend className="sr-only">Koppla beställaren till HusHubs kundregister</legend>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Kundval">
          <button className="gizmo-button gizmo-customer-mode" aria-pressed={mode === 'existing'} onClick={() => setMode('existing')}><UserRoundCheck size={16} /> Välj befintlig kund</button>
          {registry?.organization.canManage && <button className="gizmo-button gizmo-customer-mode" aria-pressed={mode === 'create'} onClick={() => setMode('create')}><Plus size={16} /> Skapa ny kund</button>}
        </div>
        {mode === 'existing' ? <>
          <label className="block text-sm"><span className="flex items-center gap-2"><Search size={15} /> Sök privatkund</span>
            <input className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Namn, e-post eller kundnummer" /></label>
          <label className="block text-sm">Befintlig kund
            <select aria-label="Befintlig kund" className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
              <option value="">{matches.length ? 'Välj kund…' : 'Inga matchande privatkunder'}</option>
              {[...new Map([...(selected ? [selected] : []), ...matches].map((row) => [row.id, row])).values()].map((row) =>
                <option key={row.id} value={row.id}>{row.customerNumber} · {row.name}{row.email ? ` · ${row.email}` : ''}</option>)}
            </select>
          </label>
          {selected && <p className="break-words text-sm text-slate-600">{[selected.address, selected.postalCode, selected.city].filter(Boolean).join(' · ')}</p>}
        </> : <>
          <p className="break-words text-sm">{parties.customers[0].name || 'Namn saknas'} · {parties.email || 'E-post saknas'}</p>
          {duplicates.length > 0 && <p role="status" className="text-sm text-amber-800">Liknande kund finns: {duplicates.map((row) => `${row.customerNumber} · ${row.name}`).join(', ')}. Kontrollera kundvalet innan du skapar en ny.</p>}
        </>}
        <button className="gizmo-button" disabled={busy || disabled || !registry || (mode === 'existing' ? !selected?.email : !parties.customers[0].name.trim() || !parties.email.trim())} onClick={() => void bind()}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : mode === 'create' ? <Plus size={16} /> : <UserRoundCheck size={16} />}
          {busy ? 'Kopplar kund…' : mode === 'create' ? 'Skapa och koppla kund' : 'Hämta och koppla kund'}
        </button>
        <p className="text-xs text-slate-500">Vid byte av beställare återkallas tidigare kundlänkar och delningar.</p>
      </fieldset>}
  </section>
}
