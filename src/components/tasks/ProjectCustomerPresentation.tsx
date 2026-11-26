'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, RefreshCw, Save } from 'lucide-react'
import { customerTypeLabels, defaultCustomerPresentation, type CustomerPresentation, type ProjectCustomerType } from '@/lib/action-cases/customerPresentation'
import type { CustomerOfferWorkspace } from '@/lib/action-cases/customerOffers'
import type { OrganizationCustomerWorkspace } from '@/lib/customers/domain'
import { useProjectSaveProtection } from './ProjectSaveProtection'

export default function ProjectCustomerPresentation({ caseId, workspace, locked, blocked, active, onPending, onDirty, onApplied, onReload }: {
  caseId: string; workspace: CustomerOfferWorkspace; locked: boolean; blocked: boolean; active: boolean
  onPending: (pending: boolean) => void; onDirty: (dirty: boolean) => void; onApplied: (workspace: CustomerOfferWorkspace) => void; onReload: () => Promise<boolean>
}) {
  const saved = workspace.customerPresentation
  const fallback = saved?.value ?? { ...defaultCustomerPresentation(workspace.draft.contractParties?.business ? 'business' : 'private'), vatBasis: 'incl' as const }
  const [value, setValue] = useState<CustomerPresentation>(fallback), [customerId, setCustomerId] = useState('')
  const [registry, setRegistry] = useState<OrganizationCustomerWorkspace | null>(null), [registryError, setRegistryError] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [confirm, setConfirm] = useState(false), [attempt, setAttempt] = useState(0)
  const pendingRequest = useRef<{ key: string; payload: Record<string, unknown> } | null>(null)
  const dirty = JSON.stringify(value) !== JSON.stringify(fallback) || Boolean(customerId)
  useProjectSaveProtection({ label: 'Beställartyp och momsvisning', pending: dirty || busy, view: 'overview', detail: busy ? 'Projektets beställarval sparas.' : 'Ditt val är inte sparat.' })
  useEffect(() => { onPending(busy); return () => onPending(false) }, [busy, onPending])
  useEffect(() => { onDirty(dirty); return () => onDirty(false) }, [dirty, onDirty])
  useEffect(() => {
    if (!active || locked || !workspace.customerLink?.organizationId) return
    const controller = new AbortController()
    void fetch(`/api/settings/customers?orgId=${workspace.customerLink.organizationId}`, { signal: controller.signal, cache: 'no-store' }).then(async response => {
      const data = await response.json()
      if (!response.ok || data.workspace?.organization?.id !== workspace.customerLink?.organizationId || !Array.isArray(data.workspace.customers)) throw new Error()
      setRegistry(data.workspace); setRegistryError(false)
    }).catch(() => { if (!controller.signal.aborted) setRegistryError(true) })
    return () => controller.abort()
  }, [active, locked, workspace.customerLink?.organizationId, attempt])
  const selected = registry?.customers.find(customer => customer.id === customerId)
  async function save() {
    if (busy || blocked || locked || !saved?.available) return
    const key = JSON.stringify({ value, customerId, revision: saved.revision, contractRevision: workspace.revision, offerRevision: workspace.offerDraft?.revision ?? 0 })
    if (pendingRequest.current?.key !== key) pendingRequest.current = { key, payload: {
      requestId: crypto.randomUUID(), value, revision: saved.revision, contractRevision: workspace.revision,
      offerRevision: workspace.offerDraft?.revision ?? 0, customerId: selected?.id ?? null, customerVersion: selected?.version ?? null } }
    setBusy(true); setError('')
    try {
      const response = await fetch(`/api/action-cases/${caseId}/customer-presentation`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pendingRequest.current.payload) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Valet kunde inte sparas.')
      if (result.saved !== true || JSON.stringify(result.workspace?.customerPresentation?.value) !== JSON.stringify(value) || !result.workspace.offerDraft) throw new Error('Sparningen kunde inte bekräftas. Försök igen.')
      pendingRequest.current = null; onApplied(result.workspace)
    } catch (error) { setError(error instanceof Error ? error.message : 'Valet kunde inte sparas.') }
    finally { setBusy(false) }
  }
  return <details className="gizmo-home-manager gizmo-customer-presentation"><summary>Beställare och moms · {customerTypeLabels[fallback.customerType]} · {fallback.vatBasis === 'excl' ? 'Exkl. moms' : 'Inkl. moms'}{locked ? ' · Låst' : ''}</summary>
    {locked ? <p className="py-3 text-sm">Beställartyp och momsvisning är låsta med avtalet. Sparade dokument behåller sina uppgifter.</p> : <div className="space-y-4 py-4">
      {!saved?.available && <p role="alert" className="text-sm">Momsvisningen behöver aktiveras i databasen.</p>}
      <fieldset className="grid gap-4 sm:grid-cols-2" disabled={busy || blocked || !saved?.available}>
        <label className="block text-sm">Beställartyp<select aria-label="Projektets beställartyp" className="mt-1 min-h-11 w-full rounded-md border border-[#B9C3C4] bg-white px-3" value={value.customerType} onChange={event => { setValue(defaultCustomerPresentation(event.target.value as ProjectCustomerType)); setCustomerId(''); setConfirm(false) }}>{Object.entries(customerTypeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="block text-sm">Prisvisning<select aria-label="Projektets momsvisning" className="mt-1 min-h-11 w-full rounded-md border border-[#B9C3C4] bg-white px-3" value={value.vatBasis} disabled={value.customerType === 'private'} onChange={event => setValue({ ...value, vatBasis: event.target.value as 'incl' | 'excl' })}><option value="incl">Inklusive moms</option><option value="excl">Exklusive moms</option></select></label>
        <label className="block text-sm sm:col-span-2">Kundregister{workspace.customerLink?.customerNumber ? ` · Kund ${workspace.customerLink.customerNumber}` : ''}<select aria-label="Projektets kund" className="mt-1 min-h-11 w-full rounded-md border border-[#B9C3C4] bg-white px-3" value={customerId} onChange={event => { setCustomerId(event.target.value); setConfirm(false) }}><option value="">Behåll nuvarande beställare</option>{registry?.customers.filter(customer => customer.isActive && customer.customerType === value.customerType).map(customer => <option key={customer.id} value={customer.id}>{customer.customerNumber} · {customer.name}</option>)}</select></label>
      </fieldset>
      {registryError && <button type="button" className="gizmo-button" onClick={() => setAttempt(value => value + 1)}><RefreshCw size={16} />Hämta kundlista igen</button>}
      {blocked && <p className="text-sm">Spara pågående ändringar innan du ändrar beställarvalet.</p>}
      {error && <p role="alert" className="text-sm text-[#A52E42]">{error}</p>}
      {confirm ? <div role="alertdialog" aria-label="Bekräfta beställarval" className="space-y-3 border-l-4 border-[#AD8529] bg-[#F8F5E8] p-3 text-sm"><p>Uppdatera beställartyp och momsvisning i projektets utkast? Prisbelopp och intern kalkyl ändras inte. {value.customerType === 'private' && fallback.customerType !== 'private' ? 'Organisationsuppgifterna tas bort från utkasten vid byte till privatperson. ' : ''}{selected ? `Beställaren ersätts med ${selected.name}. Tidigare kundlänkar återkallas vid byte av kund.` : 'Befintlig beställare behålls.'} Skickade och låsta dokument ändras inte.</p><div className="flex flex-wrap gap-2"><button className="gizmo-button" disabled={busy || blocked} onClick={() => void save()}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}Bekräfta och spara</button><button className="gizmo-button" disabled={busy} onClick={() => setConfirm(false)}>Avbryt</button></div></div> : <button type="button" className="gizmo-button" disabled={busy || blocked || !saved?.available || (!dirty && Boolean(saved.value))} onClick={() => setConfirm(true)}><Save size={16} />Spara beställarval</button>}
      {error && <button type="button" className="gizmo-button" disabled={busy} onClick={() => { if (window.confirm('Hämta projektets sparade beställarval och ersätta ditt osparade val?')) void onReload() }}><RefreshCw size={16} />Hämta sparade uppgifter</button>}
    </div>}
  </details>
}
