'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Copy, ExternalLink, Loader2, Pencil, Plus, RefreshCw, Save, Search, UserRoundCheck } from 'lucide-react'
import { useToast } from '@/components/ui/AppToastProvider'
import type { ContractParties } from '@/lib/action-cases/customerContractParties'
import type { OrganizationCustomerInput } from '@/lib/customers/domain'
import { billingCustomerFromBuyer, billingCustomerInput, emptyBillingCustomer, type ProjectBillingWorkspace } from '@/lib/action-cases/projectBilling'

const field = 'mt-1 block min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm'

export default function ProjectBillingEditor({ caseId, parties, active, onDirtyChange }: {
  caseId: string; parties: ContractParties; active: boolean; onDirtyChange: (dirty: boolean) => void
}) {
  const toast = useToast()
  const [enabled, setEnabled] = useState(active)
  const [attempt, setAttempt] = useState(0)
  const [workspace, setWorkspace] = useState<ProjectBillingWorkspace | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const [busy, setBusy] = useState('')
  const [mode, setMode] = useState<'existing' | 'create' | 'update'>('existing')
  const [selectedId, setSelectedId] = useState('')
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState<OrganizationCustomerInput | null>(null)
  const pending = useRef<{ key: string; id: string } | null>(null)
  const running = useRef(false)
  const customer = workspace?.registry.customers.find((row) => row.id === workspace.customerId)
  const dirty = mode !== 'existing' || Boolean(workspace && selectedId !== (workspace.customerId ?? ''))
  useEffect(() => { if (active) setEnabled(true) }, [active])
  useEffect(() => { onDirtyChange(dirty || Boolean(busy)) }, [dirty, busy, onDirtyChange])
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    setLoading(true)
    setFailed(false)
    void (async () => {
      try {
        const response = await fetch(`/api/action-cases/${caseId}/billing`, { cache: 'no-store', signal: controller.signal })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || 'Faktureringsuppgifterna kunde inte hämtas.')
        if (!controller.signal.aborted) {
          setWorkspace(result)
          setSelectedId(result.customerId ?? '')
          setMode('existing')
          setDraft(null)
          setSaveFailed(false)
          pending.current = null
        }
      } catch (error) {
        if (!controller.signal.aborted) { setFailed(true); toast.error(error, 'Faktureringsuppgifterna kunde inte hämtas.') }
      } finally { if (!controller.signal.aborted) setLoading(false) }
    })()
    return () => controller.abort()
  }, [caseId, enabled, attempt, toast])

  function refresh() {
    if (dirty && !window.confirm('Hämta sparade faktureringsuppgifter? Dina osparade ändringar ersätts.')) return
    setAttempt((value) => value + 1)
  }
  function cancel() {
    setMode('existing'); setDraft(null); setSelectedId(workspace?.customerId ?? ''); setSaveFailed(false); pending.current = null
  }
  async function save() {
    if (!workspace || running.current) return
    const selected = workspace.registry.customers.find((row) => row.id === selectedId && row.isActive)
    if (mode !== 'create' && !selected) return
    const payload = { mode, revision: workspace.revision,
      ...(mode === 'create' ? {} : { customerId: selected!.id, customerVersion: selected!.version }),
      ...(mode === 'existing' ? {} : { customer: draft }) }
    const key = JSON.stringify(payload)
    if (pending.current?.key !== key) pending.current = { key, id: crypto.randomUUID() }
    running.current = true; setBusy('save'); setSaveFailed(false)
    try {
      const response = await fetch(`/api/action-cases/${caseId}/billing`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(45000),
        body: JSON.stringify({ ...payload, requestId: pending.current.id }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Faktureringsuppgifterna kunde inte sparas. Dina ändringar är kvar.')
      setWorkspace(result); setSelectedId(result.customerId ?? ''); setMode('existing'); setDraft(null); pending.current = null
      toast.success('Fakturakunden har sparats. Avtalets beställare och mottagare är oförändrade.')
    } catch (error) { setSaveFailed(true); toast.error(error, 'Faktureringsuppgifterna kunde inte sparas. Dina ändringar är kvar.') }
    finally { running.current = false; setBusy('') }
  }
  async function exportCustomer() {
    if (!workspace || !customer || dirty || running.current) return
    running.current = true; setBusy('export')
    try {
      const response = await fetch(`/api/integrations/fortnox/customers/${customer.id}/export`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(45000),
        body: JSON.stringify({ orgId: workspace.registry.organization.id, version: customer.version }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Kunden kunde inte exporteras till Fortnox.')
      toast.success('Kunden är kopplad till Fortnox.')
      setAttempt((value) => value + 1)
    } catch (error) { toast.error(error, 'Kunden kunde inte exporteras till Fortnox.') }
    finally { running.current = false; setBusy('') }
  }

  const customers = workspace?.registry.customers.filter((row) => row.isActive) ?? []
  const matches = customers.filter((row) => [row.name, row.email, row.customerNumber, row.fortnoxCustomerNumber]
    .some((value) => value?.toLowerCase().includes(search.trim().toLowerCase())))
  const selected = customers.find((row) => row.id === selectedId)
  const duplicates = draft ? customers.filter((row) => row.id !== (mode === 'update' ? customer?.id : null) && (
    row.name.toLowerCase() === draft.name.trim().toLowerCase() || Boolean(draft.email && row.email?.toLowerCase() === draft.email.trim().toLowerCase()))) : []
  const input = (key: keyof OrganizationCustomerInput, label: string, type = 'text') => <label className="block min-w-0 text-sm" key={key}>
    {label}<input className={field} type={type} maxLength={500} value={String(draft?.[key] ?? '')}
      onChange={(event) => setDraft((current) => current ? { ...current, [key]: event.target.value } : current)} />
  </label>

  return <section className="py-5" aria-label="Faktureringsuppgifter">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="text-lg font-semibold">Fakturakund</h3>
        <p className="mt-1 text-sm text-slate-600">Separat från beställare och avtalssignering. Ett byte ändrar inte avtalet eller kundens åtkomst.</p></div>
      <button className="gizmo-button" title="Hämta sparade faktureringsuppgifter" aria-label="Hämta sparade faktureringsuppgifter" disabled={loading || Boolean(busy)} onClick={refresh}><RefreshCw size={17} /></button>
    </div>
    <div role="status" className="flex h-10 items-center gap-2 text-sm text-slate-600">
      {(loading || busy) && <Loader2 size={16} className="animate-spin" />}
      {loading ? 'Hämtar faktureringsuppgifter…' : busy === 'save' ? 'Sparar fakturakund…' : busy === 'export' ? 'Exporterar kund…' : saveFailed ? 'Kunde inte spara · Dina ändringar är kvar' : dirty ? 'Osparade faktureringsuppgifter' : workspace?.customerId ? 'Fakturakund kopplad' : 'Ingen fakturakund kopplad'}
    </div>
    {failed && <button className="gizmo-button" disabled={loading || Boolean(busy)} onClick={refresh}><RefreshCw size={16} /> Försök hämta igen</button>}
    {workspace && !workspace.available && <p className="text-sm text-amber-800">Fakturakopplingen behöver aktiveras av administratören.</p>}
    {workspace?.available && <>
      {customer && <div className="mb-5 border-y border-slate-200 py-4">
        <strong className="block break-words">{customer.name} · Kund {customer.customerNumber}{!customer.isActive ? ' · Inaktiv' : ''}</strong>
        <p className="mt-2 break-words text-sm">{(customer.invoiceSameAsCustomer ? customer.email : customer.invoiceEmail) || 'Fakturamejl saknas'}</p>
        <p className="mt-1 break-words text-sm text-slate-600">{(customer.invoiceSameAsCustomer ? [customer.address, customer.addressLine2, customer.postalCode, customer.city] : [customer.invoiceName, customer.invoiceAddress, customer.invoiceAddressLine2, customer.invoicePostalCode, customer.invoiceCity]).filter(Boolean).join(' · ') || 'Fakturaadress saknas'}</p>
        {customer.invoiceReference && <p className="mt-1 break-words text-sm">Referens: {customer.invoiceReference}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {workspace.registry.organization.canManage && <button className="gizmo-button" disabled={dirty || Boolean(busy) || loading || !customer.isActive} onClick={() => { setSelectedId(customer.id); setDraft(billingCustomerInput(customer)); setMode('update') }}><Pencil size={16} /> Redigera fakturakund</button>}
          {customer.fortnoxCustomerNumber ? <span className="text-sm text-slate-600">Kopplad till Fortnox · Kund {customer.fortnoxCustomerNumber}</span>
            : workspace.registry.organization.canManage && customer.isActive && <button className="gizmo-button" disabled={dirty || Boolean(busy) || loading} onClick={() => void exportCustomer()}><ExternalLink size={16} /> Exportera kund till Fortnox</button>}
        </div>
        {customer.fortnoxCustomerNumber && <p className="mt-2 text-xs text-slate-600">Ändringar här uppdaterar inte automatiskt den befintliga kunden i Fortnox.</p>}
      </div>}
      <fieldset disabled={Boolean(busy) || loading} className="min-w-0 space-y-4">
        <legend className="sr-only">Välj eller registrera fakturakund</legend>
        {mode === 'existing' ? <>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm"><span className="flex items-center gap-2"><Search size={16} /> Sök kund</span>
              <input className={field} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Namn, e-post eller kundnummer" /></label>
            <label className="block text-sm">Fakturakund i kundregistret
              <select className={field} value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
                <option value="">{matches.length ? 'Välj kund…' : 'Inga matchande kunder'}</option>
                {[...new Map([...(selected ? [selected] : []), ...matches].map((row) => [row.id, row])).values()].map((row) => <option key={row.id} value={row.id}>{row.customerNumber} · {row.name}</option>)}
              </select></label>
          </div>
          <div className="flex flex-wrap gap-3">
            <button className="gizmo-button" disabled={!selected || !dirty} onClick={() => void save()}><UserRoundCheck size={16} /> Koppla fakturakund</button>
            {workspace.registry.organization.canManage && <button className="gizmo-button" disabled={dirty} onClick={() => { setDraft(emptyBillingCustomer()); setMode('create') }}><Plus size={16} /> Ny fakturakund</button>}
            {dirty && <button className="gizmo-button" onClick={cancel}><ArrowLeft size={16} /> Avbryt</button>}
          </div>
        </> : draft && <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h4 className="font-semibold">{mode === 'create' ? 'Ny fakturakund' : 'Redigera fakturakund'}</h4>
            {mode === 'create' && <button className="gizmo-button" onClick={() => setDraft(billingCustomerFromBuyer(parties))}><Copy size={16} /> Använd beställare 1:s uppgifter</button>}
          </div>
          {mode === 'update' && <p className="text-sm text-amber-800">Ändringen sparas i organisationens gemensamma kundregister. Signerade avtal ändras inte.</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">Kundtyp<select className={field} value={draft.customerType} onChange={(event) => setDraft({ ...draft, customerType: event.target.value as OrganizationCustomerInput['customerType'], identityNumber: null })}><option value="private">Privatperson</option><option value="business">Företag</option></select></label>
            {input('name', 'Kundnamn *')}
            {input('identityNumber', draft.customerType === 'private' ? 'Personnummer (valfritt)' : 'Organisationsnummer *')}
            {input('email', 'Kontaktmejl', 'email')}{input('phone', 'Telefon', 'tel')}
            {input('address', 'Gata/box')}{input('addressLine2', 'Adressrad 2')}
            {input('postalCode', 'Postnummer')}{input('city', 'Ort')}{input('countryCode', 'Landskod *')}
          </div>
          <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" checked={draft.invoiceSameAsCustomer} onChange={(event) => setDraft({ ...draft, invoiceSameAsCustomer: event.target.checked,
            ...(!event.target.checked && !draft.invoiceName ? { invoiceName: draft.name, invoiceEmail: draft.email, invoiceAddress: draft.address, invoiceAddressLine2: draft.addressLine2, invoicePostalCode: draft.postalCode, invoiceCity: draft.city, invoiceCountryCode: draft.countryCode } : {}) })} /> Faktureringsuppgifter samma som kundens</label>
          {!draft.invoiceSameAsCustomer && <div className="grid gap-4 border-t border-slate-200 pt-4 sm:grid-cols-2">
            {input('invoiceName', 'Fakturanamn *')}{input('invoiceEmail', 'Fakturamejl', 'email')}
            {input('invoiceAddress', 'Fakturaadress')}{input('invoiceAddressLine2', 'Fakturaadress rad 2')}
            {input('invoicePostalCode', 'Faktura postnummer')}{input('invoiceCity', 'Faktura ort')}{input('invoiceCountryCode', 'Faktura landskod *')}
          </div>}
          {input('invoiceReference', 'Fakturareferens (valfritt)')}
          {duplicates.length > 0 && <p role="status" className="text-sm text-amber-800">Liknande kund finns: {duplicates.map((row) => `${row.customerNumber} · ${row.name}`).join(', ')}. Kontrollera innan du skapar en ny kund.</p>}
          <div className="flex flex-wrap gap-3"><button className="gizmo-button gizmo-button-primary" disabled={!draft.name?.trim()} onClick={() => void save()}><Save size={16} /> {mode === 'create' ? 'Skapa och koppla fakturakund' : 'Spara fakturakund'}</button>
            <button className="gizmo-button" onClick={cancel}><ArrowLeft size={16} /> Avbryt</button></div>
        </>}
      </fieldset>
    </>}
  </section>
}
