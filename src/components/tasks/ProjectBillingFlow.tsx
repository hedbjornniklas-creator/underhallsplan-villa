'use client'
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, FileDown, Link2, LockKeyhole, Pencil, Plus, RefreshCw, Undo2, X } from 'lucide-react'
import { billingBasisRemaining, billingBudget, billingCostCharge, billingEntryBalance, billingErrors, billingFixedRemaining, billingMatchesTarget, billingMoney as money, billingParseAmount, billingPosted, billingSameSource, billingTotals,
  type BillingAgreement, type BillingBasis, type BillingWorkspace } from '@/lib/action-cases/billingFlow'
import { useQuestionAutosave } from './useQuestionAutosave'
import ProjectInvoiceBasis from './ProjectInvoiceBasis'
import './project-billing-flow.css'

type Command = Record<string, unknown>
type Payload = { requestId: string; revision: number; contextHash: string; command: Command }
type Pane = { kind: 'agreement' | 'cost' | 'fixed' | 'basis' | 'invoice' | 'opening' | 'budget' | 'match' | 'credit' | 'waive' | 'legacy' | 'cancel' | 'release' | 'reopen' | 'waiveCost'; id: string }
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' })
const amountText = (ore: number) => String(ore / 100).replace('.', ',')
function basisStatus(data: BillingWorkspace, basis: BillingBasis) {
  if (basis.historical) return 'Historisk registrering'
  if (basis.status === 'cancelled') return 'Makulerat'
  const remaining = basis.lines.some(l => billingBasisRemaining(data.flow, basis.id, l.id))
  const posted = basis.lines.some(l => billingPosted(data.flow, basis.id, l.id))
  const released = data.flow.releases.some(r => r.basisId === basis.id)
  if (!remaining) return released ? posted ? 'Delfakturerat / rest frigjord' : 'Frigjort' : 'Fakturerat'
  return posted ? 'Delvis fakturerat' : basis.status === 'exported' ? 'PDF skapad / reserverat' : 'Reserverat'
}
async function json(response: Response) {
  const result = await response.json()
  if (!response.ok) throw Object.assign(new Error(result.error || 'Åtgärden kunde inte bekräftas.'), { status: response.status, code: result.code })
  return result
}

function Drawer({ title, children, footer, onClose }: { title: string; children: ReactNode; footer?: ReactNode; onClose: () => void }) {
  const heading = useId(), ref = useRef<HTMLDivElement>(null), closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose }, [onClose])
  useEffect(() => {
    const oldFocus = document.activeElement as HTMLElement | null, root = ref.current
    root?.querySelector<HTMLElement>('input,select,textarea,button')?.focus()
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current() }
      if (e.key !== 'Tab' || !root) return
      const nodes = [...root.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]')].filter(n => n.getClientRects().length)
      const first = nodes[0], last = nodes.at(-1)
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('keydown', key); oldFocus?.focus() }
  }, [])
  return createPortal(<div className="gbf-overlay uppdrag-scope" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}><div ref={ref} className="gbf-drawer gizmo-workspace" role="dialog" aria-modal="true" aria-labelledby={heading}>
    <header><h2 id={heading}>{title}</h2><button type="button" className="gizmo-text-button" title="Stäng" aria-label="Stäng sidopanel" onClick={onClose}><X size={21} /></button></header>
    <div className="gbf-drawer-body">{children}</div>{footer && <footer>{footer}</footer>}
  </div></div>, document.body)
}

export default function ProjectBillingFlow({ caseId, active, onDirty, onActivated }: {
  caseId: string; active: boolean; onDirty: (value: boolean) => void; onActivated?: (active: boolean) => void
}) {
  const [data, setData] = useState<BillingWorkspace | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [unavailable, setUnavailable] = useState(false)
  const [tab, setTab] = useState('costs'), [selected, setSelected] = useState(''), [checked, setChecked] = useState<Record<string, string>>({}), [pane, setPane] = useState<Pane | null>(null)
  const [legacyOpen, setLegacyOpen] = useState(false)
  const [pending, setPending] = useState<Payload | null>(null), [costDirty, setCostDirty] = useState(false), [legacyDirty, setLegacyDirty] = useState(false), [resume, setResume] = useState<string | null>(null), [readRequired, setReadRequired] = useState(false)
  const dataRef = useRef(data), pendingRef = useRef(pending), running = useRef(false), loadToken = useRef(0)
  dataRef.current = data; pendingRef.current = pending
  const commandKey = (user: string) => `billing-command:${user}:${caseId}`
  const costKey = (user: string) => `billing-cost:${user}:${caseId}:selected`
  const load = useCallback(async () => {
    const token = ++loadToken.current
    const result = await json(await fetch(`/api/action-cases/${caseId}/billing-flow`, { cache: 'no-store', signal: AbortSignal.timeout(30_000) })) as BillingWorkspace
    if (token !== loadToken.current) return result
    dataRef.current = result; setData(result); setReadRequired(false); setUnavailable(false)
    setSelected(s => result.flow.agreements.some(a => a.id === s) ? s : result.flow.agreements.at(-1)?.id || '')
    onActivated?.(result.revision > 0)
    try {
      setResume(localStorage.getItem(costKey(result.userId)))
      if (!pendingRef.current) {
        const saved = JSON.parse(localStorage.getItem(commandKey(result.userId)) || 'null')
        if (saved?.requestId && Number.isInteger(saved.revision) && saved.command && saved.contextHash) { pendingRef.current = saved; setPending(saved) }
      }
    } catch { /* Remote state remains authoritative. */ }
    return result
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId, onActivated])
  const invalidateLoad = useCallback(() => { loadToken.current++ }, [])
  useEffect(() => {
    if (!active || running.current || costDirty || pendingRef.current) return
    setError(''); void load().catch(e => { setError(e.message); setUnavailable(e.code === 'BILLING_SCHEMA_REQUIRED') })
    return invalidateLoad
  }, [active, load, costDirty, invalidateLoad])
  useEffect(() => { onDirty(busy || !!pending || costDirty || legacyDirty) }, [busy, pending, costDirty, legacyDirty, onDirty])
  useEffect(() => {
    if (!pending && !costDirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn)
  }, [pending, costDirty])

  async function perform(command: Command, attempt?: Payload) {
    if (running.current || !dataRef.current) throw new Error('En sparning pågår. Vänta tills den är bekräftad.')
    if (readRequired) throw new Error('Hämta aktuella uppgifter innan du fortsätter.')
    const d = dataRef.current, payload = attempt ?? { requestId: crypto.randomUUID(), revision: d.revision, contextHash: d.contextHash, command }
    if (pendingRef.current && pendingRef.current.requestId !== payload.requestId) throw new Error('Bekräfta den tidigare sparningen med Försök igen först.')
    running.current = true; setBusy(true); setError(''); pendingRef.current = payload; setPending(payload)
    try {
      try { localStorage.setItem(commandKey(d.userId), JSON.stringify(payload)) } catch { /* The request remains in memory. */ }
      const response = await fetch(`/api/action-cases/${caseId}/billing-flow`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(45_000) })
      const result = await json(response)
      if (result.revision !== payload.revision + 1) throw new Error('Sparningen kunde inte bekräftas.')
      pendingRef.current = null; setPending(null)
      try { localStorage.removeItem(commandKey(d.userId)) } catch { /* No server effect. */ }
      setReadRequired(true)
      const fresh = await load()
      return fresh
    } catch (e) {
      const failure = e as Error & { status?: number }
      if (failure.status && failure.status < 500) {
        pendingRef.current = null; setPending(null); setReadRequired(true)
        try { localStorage.removeItem(commandKey(d.userId)) } catch { /* Keep the form visible. */ }
      }
      setError(failure.message); throw e
    } finally { running.current = false; setBusy(false) }
  }
  const tryCommand = async (command: Command) => {
    try { const fresh = await perform(command); setPane(null); setChecked({}); return fresh } catch { return null }
  }
  function open(kind: Pane['kind'], id = crypto.randomUUID()) {
    if (busy || costDirty || pending || readRequired) return
    setError(''); setPane({ kind, id })
  }
  async function print(b: BillingBasis) {
    try {
      if (b.status !== 'exported') await perform({ operation: 'export_basis', id: b.id })
      setBusy(true)
      const response = await fetch(`/api/action-cases/${caseId}/billing-flow/${b.id}/pdf`, { cache: 'no-store', signal: AbortSignal.timeout(60_000) })
      if (!response.ok) { await json(response); return }
      const url = URL.createObjectURL(await response.blob()), a = document.createElement('a')
      a.href = url; a.download = `Fakturaunderlag-${b.date.replaceAll('-', '')}-${b.id.slice(0, 8)}.pdf`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30_000)
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const tabId = useId(), agreement = data?.flow.agreements.find(a => a.id === selected), flow = data?.flow
  const entries = flow?.entries.filter(e => !e.superseded) ?? []
  const available = entries.map(e => ({ ...e, ...billingEntryBalance(flow!, e) })), editable = !!data?.canManage && !data.cancelled && !busy && !pending && !costDirty && !legacyDirty && !readRequired
  const costs = flow?.costs.filter(c => c.agreementId === selected) ?? []
  const budget = agreement && flow ? billingBudget(flow, agreement.key) : null
  const recovery = pending && pending.command.operation !== 'save_cost' ? <button type="button" className="gizmo-text-button" disabled={busy} onClick={() => void perform(pending.command, pending).then(() => { setPane(null); setCostDirty(false) }).catch(() => undefined)}>Bekräfta tidigare försök</button> : readRequired && !pending ? <button type="button" className="gizmo-text-button" disabled={busy} onClick={() => void load().catch(e => setError(e.message))}>Hämta aktuella uppgifter</button> : null
  const note = (operation: string) => ({ register_agreement: 'Överenskommelse registrerad', save_cost: 'Kostnad sparad', review_cost: 'Kostnad granskad', create_entry: 'Faktureringspost skapad', reserve_basis: 'Underlag reserverat', register_invoice: 'Faktura registrerad', record_opening_invoice: 'Tidigare kundfaktura registrerad', match_supplier: 'Leverantörsfaktura kopplad', credit_entry: 'Kreditpost skapad', confirm_legacy: 'Tidigare fakturering avstämd', budget_review: 'Budgetavstämning', close_economy: 'Faktureringsavstämning klar', reopen_economy: 'Faktureringsavstämning återöppnad', cancel_basis: 'Underlag makulerat', export_basis: 'PDF-underlag fryst', waive_entry: 'Debitering avstådd', waive_cost: 'Kostnad undantagen från debitering', unreview_cost: 'Kostnad öppnad för rättning' }[operation] || operation)
  return <section className="gbf" aria-label="Projektets fakturering">
    <header className="gbf-toolbar"><h3>Fakturering</h3><button type="button" className="gizmo-text-button" title="Hämta aktuella uppgifter" aria-label="Uppdatera fakturering" disabled={busy || costDirty || !!pending} onClick={() => void load().catch(e => setError(e.message))}><RefreshCw size={17} /></button></header>
    {error && <div role="alert" className="gbf-error">{error}{pending && <button type="button" className="gizmo-text-button" disabled={busy} onClick={() => void perform(pending.command, pending).catch(() => undefined)}>Försök igen</button>}{readRequired && !pending && <button type="button" className="gizmo-text-button" onClick={() => void load().catch(e => setError(e.message))}>Hämta aktuellt</button>}</div>}
    {pending && !error && <p role="status">{busy ? 'Sparar…' : 'En tidigare sparning behöver bekräftas.'}{!busy && <button type="button" className="gizmo-text-button" onClick={() => void perform(pending.command, pending).catch(() => undefined)}>Försök igen</button>}</p>}
    {!data && !error && <p role="status">Hämtar fakturering…</p>}
    {data && flow && <>
      {!data.canManage && <p className="gbf-status">Skrivskyddat. Projektansvarig hanterar faktureringen.</p>}
      {flow.economyClosed && <div className="gbf-status"><LockKeyhole size={16} />Faktureringsavstämning klar{editable && <button type="button" className="gizmo-text-button" onClick={() => open('reopen')}>Öppna avstämningen igen</button>}</div>}
      {data.legacyCount > 0 && !flow.legacyConfirmed && <div className="gbf-warning">{data.legacyCount} tidigare fakturaunderlag behöver stämmas av.{editable && <button type="button" className="gizmo-button" onClick={() => open('legacy')}>Stäm av tidigare fakturering</button>}</div>}
      <dl className="gbf-summary"><div><dt>Att debitera exkl. moms</dt><dd>{money(available.reduce((s, e) => s + Math.max(0, e.availableOre), 0))}</dd></div><div><dt>Att kreditera exkl. moms</dt><dd>{money(-available.reduce((s, e) => s + Math.min(0, e.availableOre), 0))}</dd></div><div><dt>Fakturerat netto exkl. moms</dt><dd>{money(available.reduce((s, e) => s + e.invoicedOre, 0))}</dd></div></dl>
      <div role="tablist" aria-label="Faktureringsvyer" className="gizmo-register-tabs gizmo-payment-tabs gbf-tabs" onKeyDown={e => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
        const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]')], index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        e.preventDefault(); buttons[e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length]?.click()
        buttons.find(b => b.getAttribute('aria-selected') === 'true')?.blur()
        setTimeout(() => buttons.find(b => b.getAttribute('aria-selected') === 'true')?.focus(), 0)
      }}>{[['costs', 'Kostnader'], ['queue', 'Att fakturera'], ['bases', 'Underlag och fakturor'], ['history', 'Historik']].map(([key, label]) => <button key={key} id={`${tabId}-${key}`} type="button" role="tab" tabIndex={tab === key ? 0 : -1} aria-controls={`${tabId}-panel`} aria-selected={tab === key} className="gizmo-register-tab" onClick={() => setTab(key)}>{label}</button>)}</div>
      <div id={`${tabId}-panel`} role="tabpanel" aria-labelledby={`${tabId}-${tab}`}>
      {tab === 'costs' && <>
        <div className="gbf-toolbar"><label className="gbf-choice">ÄTA eller avtalsdel<select value={selected} onChange={e => setSelected(e.target.value)}><option value="">Välj överenskommelse</option>{flow.agreements.map(a => <option key={a.id} value={a.id}>{a.title}{a.version > 1 ? ` / version ${a.version}` : ''}</option>)}</select></label><button type="button" className="gizmo-button" disabled={!editable || flow.economyClosed} onClick={() => open('agreement')}><Plus size={16} />Hämta överenskommelse</button></div>
        {agreement && <>
          <div className="gbf-status"><strong>{agreement.mode === 'fixed' ? 'Fast pris' : agreement.mode === 'budget' ? 'Löpande med planeringsbudget' : 'Löpande räkning'}</strong><span>{agreement.reference}</span>{agreement.mode === 'fixed' && <span>{money(agreement.fixedGrossOre!)} inkl. moms</span>}</div>
          {budget && <div className={budget.needsReview && !budget.covered ? 'gbf-warning' : 'gbf-status'}><span>Planeringsbudget {money(budget.budgetOre)} exkl. moms</span><span>{budget.remainingKnown ? 'Prognos' : 'Registrerat hittills'} {money(budget.forecastOre)} exkl. moms</span>{!budget.remainingKnown && <span>Återstående arbete ej bedömt</span>}{budget.needsReview && !budget.covered && <strong>Avstämning krävs</strong>}<button type="button" className="gizmo-text-button" disabled={!editable} onClick={() => open('budget')}>Dokumentera avstämning</button></div>}
          <div className="gbf-toolbar"><h4>Kostnader</h4><div><button type="button" className="gizmo-button" disabled={!editable} onClick={() => open('cost')}><Plus size={16} />Lägg till kostnad</button>{agreement.mode === 'fixed' && <button type="button" className="gizmo-text-button" disabled={!editable || flow.economyClosed} onClick={() => open('fixed')}>Gör avtalad del fakturerbar</button>}</div></div>
          {resume && !pane && <button type="button" className="gizmo-text-button" disabled={!editable} onClick={() => open('cost', resume)}>Återuppta kostnadsutkast</button>}
          <div className="gbf-table"><table><thead><tr><th>Kostnad / källa</th><th>Datum</th><th>Internt exkl. moms</th><th>Kund exkl. moms</th><th>Granskning</th><th /></tr></thead><tbody>{costs.map(c => {
            let customer: number | null = null
            try { if (agreement.mode !== 'fixed') customer = billingCostCharge(c, agreement) } catch { /* Missing contractual rate stays unknown. */ }
            const stale = c.supplier && !billingSameSource(data.suppliers.find(s => s.key === c.supplier!.key), c.supplier)
            return <tr key={c.id}><td>{c.description}<small>{c.supplier?.title || (c.kind === 'hours' ? `${c.hoursUnits! / 10000} timmar` : 'Manuell kostnad')}</small></td><td>{c.date}</td><td>{c.internalNetOre === null ? 'Okänd' : money(c.internalNetOre)}</td><td>{c.waived ? 'Ej kunddebitering' : agreement.mode === 'fixed' ? 'Ingår i fast pris' : customer === null ? 'Prisgrund saknas' : money(customer)}</td><td>{stale ? 'Källan ändrad' : c.waived ? 'Undantagen' : c.reviewed ? 'Granskad' : 'Ej granskad'}</td><td><div className="gbf-row-actions"><button type="button" className="gizmo-text-button" title="Öppna kostnad" aria-label={`Öppna ${c.description}`} disabled={!editable} onClick={() => open('cost', c.id)}><Pencil size={16} /></button><button type="button" className="gizmo-text-button" title="Koppla eller uppdatera leverantörsfaktura" aria-label={`Koppla faktura till ${c.description}`} disabled={!editable || c.kind !== 'purchase'} onClick={() => open('match', c.id)}><Link2 size={16} /></button></div></td></tr>
          })}</tbody></table></div>
          {!costs.length && <p className="gbf-empty">Inga registrerade kostnader på denna överenskommelse.</p>}
        </>}
      </>}
      {tab === 'queue' && <>
        <div className="gbf-table"><table><thead><tr><th>Välj</th><th>Faktureringspost</th><th>Att hantera exkl. moms</th><th>Reserverat</th><th>Fakturerat netto</th><th /></tr></thead><tbody>{available.map(e => <tr key={e.id}><td><input type="checkbox" aria-label={`Välj ${e.description}`} checked={e.id in checked} disabled={!editable || !e.availableOre} onChange={ev => setChecked(s => { const next = { ...s }; if (ev.target.checked) next[e.id] = amountText(e.availableOre); else delete next[e.id]; return next })} /></td><td>{e.description}<small>{flow.agreements.find(a => a.id === e.agreementId)?.title}{e.blocked ? ' / inväntar registrerad kredit' : ''}</small></td><td>{e.id in checked ? <input className="gbf-amount" aria-label={`Belopp för ${e.description}`} inputMode="decimal" value={checked[e.id]} onChange={ev => setChecked(s => ({ ...s, [e.id]: ev.target.value }))} /> : money(e.availableOre)}</td><td>{money(e.reservedOre)}</td><td>{money(e.invoicedOre)}</td><td><div className="gbf-row-actions"><button type="button" className="gizmo-text-button" title="Avstå återstående debitering" aria-label={`Avstå ${e.description}`} disabled={!editable || !e.availableOre} onClick={() => open('waive', e.id)}><X size={16} /></button><button type="button" className="gizmo-text-button" title="Kreditera eller rätta" aria-label={`Kreditera ${e.description}`} disabled={!editable || e.netOre <= 0 || !e.invoicedOre} onClick={() => open('credit', e.id)}><Undo2 size={16} /></button></div></td></tr>)}</tbody></table></div>
        {!available.length && <p className="gbf-empty">Inga faktureringsposter skapade.</p>}
        <div className="gbf-toolbar"><span>{Object.keys(checked).length} valda poster</span><button type="button" className="gizmo-button" disabled={!editable || !Object.keys(checked).length || flow.economyClosed} onClick={() => open('basis')}>Skapa fakturaunderlag</button></div>
      </>}
      {tab === 'bases' && <>
        <div className="gbf-toolbar"><h4>Fakturaunderlag</h4><div><button type="button" className="gizmo-text-button" disabled={!editable || !flow.agreements.some(a => a.mode === 'fixed') || flow.economyClosed} onClick={() => open('opening')}>Registrera tidigare fastprisfaktura</button><button type="button" className="gizmo-button" disabled={!editable || flow.economyClosed || !flow.bases.some(b => b.lines.some(l => billingBasisRemaining(flow, b.id, l.id)))} onClick={() => open('invoice')}>Registrera Fortnox-faktura</button></div></div>
        <div className="gbf-table"><table><thead><tr><th>Underlag</th><th>Datum</th><th>Exkl. moms</th><th>Återstår exkl. moms</th><th>Läge</th><th /></tr></thead><tbody>{flow.bases.map(b => <tr key={b.id}>
          <td>{b.title}<small>{b.id.slice(0, 8)}</small></td><td>{b.date}</td><td>{money(billingTotals(b.lines).netOre)}</td><td>{money(b.lines.reduce((s, l) => s + billingBasisRemaining(flow, b.id, l.id), 0))}</td><td>{basisStatus(data, b)}</td>
          <td><div className="gbf-row-actions"><button type="button" className="gizmo-text-button" title="Hämta PDF" aria-label={`PDF ${b.title}`} disabled={busy || !!pending || costDirty || b.historical || b.status === 'cancelled' || !data.canManage && b.status !== 'exported'} onClick={() => void print(b)}><FileDown size={17} /></button><button type="button" className="gizmo-text-button" title="Makulera ofakturerat underlag" aria-label={`Makulera ${b.title}`} disabled={!editable || b.status === 'cancelled' || flow.invoices.some(i => i.lines.some(l => l.basisId === b.id))} onClick={() => open('cancel', b.id)}><X size={16} /></button></div></td>
        </tr>)}</tbody></table></div>
        <div className="gbf-toolbar"><span>Ofakturerade rester kan återföras till Att fakturera.</span>{flow.bases.filter(b => !b.historical && b.lines.some(l => billingBasisRemaining(flow, b.id, l.id))).map(b => <button type="button" key={b.id} className="gizmo-text-button" disabled={!editable} onClick={() => open('release', b.id)}>Frigör rest: {b.title}</button>)}</div>
        <h4>Registrerade kundfakturor</h4><div className="gbf-table"><table><thead><tr><th>Fakturanummer</th><th>Datum</th><th>Gizmo-poster exkl. moms</th><th>Övrigt på fakturan exkl. moms</th></tr></thead><tbody>{flow.invoices.map(i => <tr key={i.id}><td>{i.kind === 'credit' ? 'Kredit ' : ''}{i.number}</td><td>{i.date}</td><td>{money(i.lines.reduce((s, l) => s + l.netOre, 0))}</td><td>{money(i.externalNetOre)}</td></tr>)}</tbody></table></div>
      </>}
      {tab === 'history' && <div className="gbf-table"><table><thead><tr><th>Händelse</th><th>Utförd av</th><th>Tid</th></tr></thead><tbody>{data.history.map(e => <tr key={e.id}><td>{note(e.operation)}</td><td>{e.actor}</td><td>{new Date(e.at).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' })}</td></tr>)}</tbody></table></div>}
      </div>
      <div className="gbf-close"><button type="button" className="gizmo-text-button" disabled={!editable || flow.economyClosed} onClick={() => void tryCommand({ operation: 'close_economy', confirmed: true })}><Check size={16} />Bekräfta faktureringsavstämning klar</button></div>
      {pane?.kind === 'cost' && <CostDrawer key={pane.id} caseId={caseId} id={pane.id} data={data} agreementId={selected} perform={perform} recovery={recovery} readRequired={readRequired} onReload={load} onDirty={setCostDirty} onClose={() => { setPane(null); setCostDirty(false); void load().catch(e => setError(e.message)) }} />}
      {pane && pane.kind !== 'cost' && <BillingCommandDrawer key={`${pane.kind}:${pane.id}`} pane={pane} data={data} agreement={agreement} selection={checked} busy={busy || !!pending || readRequired} error={error} recovery={recovery} onSubmit={tryCommand} onClose={() => { if (!running.current) setPane(null) }} />}
    </>}
    {(data?.legacyCount || unavailable) && <details className="gbf-legacy" onToggle={e => setLegacyOpen(e.currentTarget.open)}><summary>{unavailable ? 'Befintliga fakturaunderlag' : 'Tidigare manuella fakturaunderlag'}</summary>{legacyOpen && <ProjectInvoiceBasis caseId={caseId} active={active} onDirty={setLegacyDirty} readOnly={!!data?.revision} />}</details>}
  </section>
}

type CostForm = { id: string; agreementId: string; description: string; date: string; kind: 'purchase' | 'hours'; internal: string; hours: string; evidence: string; missingEvidenceReason: string; supplierKey: string; contextHash: string }
function CostDrawer({ caseId, id, data, agreementId, perform, readRequired, recovery, onReload, onDirty, onClose }: { caseId: string; id: string; data: BillingWorkspace; agreementId: string; perform: (command: Command, attempt?: Payload) => Promise<BillingWorkspace>; readRequired: boolean; recovery: ReactNode; onReload: () => Promise<BillingWorkspace>; onDirty: (v: boolean) => void; onClose: () => void }) {
  const saved = data.flow.costs.find(c => c.id === id), a = data.flow.agreements.find(a => a.id === (saved?.agreementId || agreementId))
  const key = `billing-cost:${data.userId}:${caseId}:${id}`, [form, setForm] = useState<CostForm | null>(null), [finishing, setFinishing] = useState(false), [error, setError] = useState(''), [closeQuestion, setCloseQuestion] = useState(false), [reason, setReason] = useState('')
  const [waiveConfirm, setWaiveConfirm] = useState(false)
  function command(f: CostForm) {
    const hours = f.hours.trim().replace(',', '.')
    if (f.kind === 'hours' && !/^\d{1,6}(?:\.\d{1,4})?$/.test(hours)) throw new Error('Ange antal timmar, högst fyra decimaler.')
    return { operation: 'save_cost', id: f.id, agreementId: f.agreementId, description: f.description, date: f.date, kind: f.kind, internalNetOre: billingParseAmount(f.internal),
      hoursUnits: f.kind === 'hours' ? Math.round(Number(hours) * 10000) : null, evidence: f.evidence, missingEvidenceReason: f.missingEvidenceReason, ...(f.supplierKey ? { supplierKey: f.supplierKey } : {}) }
  }
  const autosave = useQuestionAutosave<CostForm>({ valid: f => { try { const c = command(f); return !!f.description.trim() && !!f.agreementId && /^20\d{2}-\d{2}-\d{2}$/.test(f.date) && (f.kind === 'hours' ? Number(c.hoursUnits) > 0 : c.internalNetOre !== null || !!f.supplierKey) } catch { return false } },
    save: async attempt => { const f = attempt.value; await perform(command(f), { command: command(f), requestId: attempt.requestId, revision: attempt.revision, contextHash: f.contextHash }) }, onSaved: () => undefined,
    staleMessage: 'Kostnadsutkastet är äldre än den sparade versionen. Hämta aktuella uppgifter.' })
  const queue = useRef(autosave); queue.current = autosave
  useEffect(() => {
    const seed: CostForm = { id, agreementId: saved?.agreementId || agreementId, description: saved?.description || '', date: saved?.date || today(), kind: saved?.kind || 'purchase', internal: saved?.internalNetOre == null ? '' : amountText(saved.internalNetOre), hours: saved?.hoursUnits == null ? '' : String(saved.hoursUnits / 10000), evidence: saved?.evidence || '', missingEvidenceReason: saved?.missingEvidenceReason || '', supplierKey: saved?.supplier?.key || '', contextHash: data.contextHash }
    const value = queue.current.seed(key, seed, data.revision); setForm(value)
    try { localStorage.setItem(`billing-cost:${data.userId}:${caseId}:selected`, id) } catch { /* Local fallback is optional. */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])
  useEffect(() => { queue.current.acknowledge(data.revision) }, [data.revision])
  useEffect(() => { onDirty(autosave.busy || autosave.dirty) }, [autosave.busy, autosave.dirty, onDirty])
  function edit(next: CostForm) { setForm(next); autosave.change(next) }
  async function leave() {
    if (finishing || autosave.busy) return
    if (await autosave.flush()) { clearResume(); onClose() } else setCloseQuestion(true)
  }
  function clearResume() { try { localStorage.removeItem(`billing-cost:${data.userId}:${caseId}:selected`) } catch { /* Optional local recovery. */ } }
  async function finish() {
    if (!form || !a || !(await autosave.flush())) return
    setFinishing(true); setError('')
    try {
      let fresh = data
      if (!fresh.flow.costs.find(c => c.id === id)?.reviewed) fresh = await perform({ operation: 'review_cost', id, confirmed: true })
      if (a.mode !== 'fixed' && !fresh.flow.costs.find(c => c.id === id)?.waived) {
        const current = fresh.flow.costs.find(c => c.id === id)!, rows = fresh.flow.entries.filter(e => e.costId === id && !e.superseded)
        if (!rows.length || rows.reduce((s, e) => s + e.netOre - (e.adjustedOre ?? 0), 0) !== billingCostCharge(current, a)) await perform({ operation: 'create_entry', id: crypto.randomUUID(), costId: id, agreementId: a.id, date: today(), reason: reason || 'Avstämning mot dokumenterad faktisk kostnad' })
      }
      try { localStorage.removeItem(`billing-cost:${data.userId}:${caseId}:selected`) } catch { /* No server effect. */ }
      onClose()
    } catch (e) { setError((e as Error).message) } finally { setFinishing(false) }
  }
  const customer = saved && a && a.mode !== 'fixed' ? (() => { try { return billingCostCharge(saved, a) } catch { return null } })() : null
  const rows = data.flow.entries.filter(e => e.costId === id && !e.superseded)
  const complete = saved?.reviewed && (a?.mode === 'fixed' || rows.length > 0 && rows.reduce((s, e) => s + e.netOre - (e.adjustedOre ?? 0), 0) === customer)
  const close = useCallback(() => { void leave() }, [finishing, autosave.busy, onClose]) // eslint-disable-line react-hooks/exhaustive-deps
  return <Drawer title={saved ? 'Kostnad' : 'Ny kostnad'} onClose={close} footer={<><span role="status">{autosave.busy ? 'Sparar…' : autosave.error || (autosave.dirty ? 'Ej sparat' : saved ? 'Sparat' : 'Nytt utkast')}</span><button type="button" className="gizmo-text-button" disabled={finishing || autosave.busy} onClick={() => void leave()}>Stäng</button><button type="button" className="gizmo-button" disabled={!form || finishing || autosave.busy || !!autosave.error || saved?.waived || complete || readRequired} onClick={() => void finish()}><Check size={16} />{complete ? a?.mode === 'fixed' ? 'Granskad' : 'Faktureringspost skapad' : a?.mode === 'fixed' ? 'Bekräfta granskning' : 'Granska och gör fakturerbart'}</button></>}>
    {(error || autosave.error) && <p role="alert" className="gbf-error">{error || autosave.error}{autosave.error && <button type="button" className="gizmo-text-button" onClick={() => void autosave.retry()}>Försök igen</button>}</p>}
    {recovery}
    {readRequired && <div className="gbf-warning">Hämta den sparade versionen efter en konflikt. Lokala ändringar i denna kostnad ersätts.<button type="button" className="gizmo-button" onClick={async () => {
      try { const fresh = await onReload(), c = fresh.flow.costs.find(c => c.id === id), next: CostForm = { id, agreementId: c?.agreementId || agreementId, description: c?.description || '', date: c?.date || today(), kind: c?.kind || 'purchase', internal: c?.internalNetOre == null ? '' : amountText(c.internalNetOre), hours: c?.hoursUnits == null ? '' : String(c.hoursUnits / 10000), evidence: c?.evidence || '', missingEvidenceReason: c?.missingEvidenceReason || '', supplierKey: c?.supplier?.key || '', contextHash: fresh.contextHash }; setForm(autosave.seed(key, next, fresh.revision, true)); setError('') } catch (e) { setError((e as Error).message) }
    }}>Ersätt med sparad kostnad</button></div>}
    {closeQuestion && <div className="gbf-warning">Utkastet är inte sparat på servern.<button type="button" className="gizmo-text-button" onClick={() => setCloseQuestion(false)}>Fortsätt redigera</button><button type="button" className="gizmo-button" onClick={onClose}>Stäng och behåll utkast</button></div>}
    {form && <fieldset disabled={finishing || saved?.reviewed || saved?.waived} className="gbf-fields">
      <label className="gbf-wide">Överenskommelse<input readOnly value={a?.title || ''} /></label>
      <label className="gbf-wide">Källa<select disabled={!!saved?.supplier} value={form.supplierKey} onChange={e => { const s = data.suppliers.find(s => s.key === e.target.value); edit({ ...form, supplierKey: e.target.value, description: s?.title || form.description, date: s?.date || form.date, internal: s ? amountText(s.netOre) : form.internal, kind: 'purchase' }) }}><option value="">Manuell registrering</option>{data.suppliers.filter(s => !s.legacy && !data.flow.costs.some(c => c.id !== id && c.supplier?.key === s.key) && a && billingMatchesTarget(s, a)).map(s => <option key={s.key} value={s.key}>{s.title} / {money(s.netOre)} exkl. moms{s.reviewed ? '' : ' / ej granskad'}</option>)}</select></label>
      <label>Typ<select disabled={!!form.supplierKey} value={form.kind} onChange={e => edit({ ...form, kind: e.target.value as CostForm['kind'] })}><option value="purchase">Inköp / UE / övrigt</option><option value="hours">Eget arbete</option></select></label><label>Datum<input type="date" value={form.date} onChange={e => edit({ ...form, date: e.target.value })} /></label>
      <label className="gbf-wide">Beskrivning<textarea rows={3} maxLength={1500} value={form.description} onChange={e => edit({ ...form, description: e.target.value })} /></label>
      <label>{form.kind === 'hours' ? 'Intern kostnad exkl. moms, valfri' : 'Faktisk kostnad exkl. moms'}<input inputMode="decimal" disabled={!!form.supplierKey} value={form.internal} onChange={e => edit({ ...form, internal: e.target.value })} /></label>
      {form.kind === 'hours' && <label>Antal timmar<input inputMode="decimal" value={form.hours} onChange={e => edit({ ...form, hours: e.target.value })} /></label>}
      <label className="gbf-wide">Underlag / hänvisning<textarea rows={2} maxLength={2000} value={form.evidence} onChange={e => edit({ ...form, evidence: e.target.value })} /></label>
      {!form.evidence && !saved?.supplier?.original && <label className="gbf-wide">Förklaring när originalunderlag saknas<textarea rows={2} maxLength={2000} value={form.missingEvidenceReason} onChange={e => edit({ ...form, missingEvidenceReason: e.target.value })} /></label>}
    </fieldset>}
    {saved && a && <dl className="gbf-summary"><div><dt>Prisgrund till kund</dt><dd>{a.mode === 'fixed' ? 'Ingår i fast pris' : saved.kind === 'hours' ? a.hourlyGrossOre === null ? 'Saknas' : `${money(a.hourlyGrossOre)} / tim inkl. moms` : a.markupPercent === null ? 'Saknas' : `Självkostnad + ${a.markupPercent} %`}</dd></div><div><dt>Kundbelopp exkl. moms</dt><dd>{customer === null ? a.mode === 'fixed' ? 'Fast pris' : 'Ej fastställt' : money(customer)}</dd></div></dl>}
    {(saved?.reviewed || saved?.waived) && <div className="gbf-fields"><label className="gbf-wide">Skäl till rättning<input value={reason} onChange={e => setReason(e.target.value)} /></label><button type="button" className="gizmo-text-button" disabled={!reason.trim() || finishing} onClick={async () => { try { await perform({ operation: 'unreview_cost', id, reason }); } catch (e) { setError((e as Error).message) } }}>Öppna för rättning</button></div>}
    {saved && !saved.waived && <button type="button" className="gizmo-text-button" disabled={finishing} onClick={() => setWaiveConfirm(true)}>Ingen kunddebitering för denna kostnad</button>}
    {waiveConfirm && <div className="gbf-warning"><label>Skäl att inte kunddebitera<textarea rows={2} value={reason} maxLength={2000} onChange={e => setReason(e.target.value)} /></label><button type="button" className="gizmo-text-button" disabled={finishing} onClick={() => setWaiveConfirm(false)}>Avbryt</button><button type="button" className="gizmo-button" disabled={!reason.trim() || finishing} onClick={async () => {
      setFinishing(true)
      try { if (!(await autosave.flush())) return; await perform({ operation: 'waive_cost', id, reason }); clearResume(); onClose() } catch (e) { setError((e as Error).message) } finally { setFinishing(false) }
    }}>Bekräfta ingen kunddebitering</button></div>}
  </Drawer>
}

function BillingCommandDrawer({ pane, data, agreement, selection, busy, error, recovery, onSubmit, onClose }: { pane: Pane; data: BillingWorkspace; agreement?: BillingAgreement; selection: Record<string, string>; busy: boolean; error: string; recovery: ReactNode; onSubmit: (c: Command) => Promise<BillingWorkspace | null>; onClose: () => void }) {
  const [form, setForm] = useState<Record<string, string>>({ date: today(), vatRate: '25', title: 'Fakturaunderlag', external: '0', remaining: '0', kind: 'invoice', net: agreement?.mode === 'fixed' ? amountText(Math.max(0, billingFixedRemaining(data.flow, agreement))) : '', approvedBy: '' })
  const [invoiceAmounts, setInvoiceAmounts] = useState<Record<string, string>>({}), [localError, setLocalError] = useState(''), [confirmed, setConfirmed] = useState(false), [rebill, setRebill] = useState(false)
  const [ids] = useState(() => ({ action: crypto.randomUUID(), replacement: crypto.randomUUID(), basis: crypto.randomUUID() }))
  const field = (key: string, label: string, props: { type?: string; multiline?: boolean; required?: boolean; readOnly?: boolean } = {}) => <label className={props.multiline ? 'gbf-wide' : ''}>{label}{props.multiline ? <textarea rows={3} maxLength={2000} required={props.required} value={form[key] || ''} onChange={e => setForm(s => ({ ...s, [key]: e.target.value }))} /> : <input type={props.type || 'text'} maxLength={2000} required={props.required} readOnly={props.readOnly} value={form[key] || ''} onChange={e => setForm(s => ({ ...s, [key]: e.target.value }))} />}</label>
  const candidate = data.candidates.find(c => c.key === form.key), selectedCost = data.flow.costs.find(c => c.id === pane.id)
  const selectedAgreement = data.flow.agreements.find(a => a.id === selectedCost?.agreementId)
  const invoiceNet = (() => { try { return Object.values(invoiceAmounts).reduce((s, v) => s + (billingParseAmount(v) ?? 0), 0) + (billingParseAmount(form.external || '') ?? 0) } catch { return null } })()
  const titles = { agreement: 'Registrera överenskommelse', fixed: 'Gör avtalad del fakturerbar', basis: 'Skapa fakturaunderlag', invoice: 'Registrera Fortnox-faktura', opening: 'Registrera tidigare kundfaktura', budget: 'Budgetavstämning', match: 'Koppla leverantörsfaktura', credit: 'Kredit eller omfakturering', waive: 'Avstå debitering', legacy: 'Stäm av tidigare fakturering', cancel: 'Makulera fakturaunderlag', release: 'Frigör ofakturerad rest', reopen: 'Återöppna faktureringsavstämning', waiveCost: 'Undanta kostnad från debitering', cost: 'Kostnad' }
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setLocalError('')
    try {
      let command: Command
      const n = (key: string) => billingParseAmount(form[key] || '')
      if (pane.kind === 'agreement') command = { operation: 'register_agreement', id: pane.id, key: candidate?.key, fingerprint: candidate?.fingerprint, vatRate: Number(form.vatRate), evidence: form.evidence || '', approvedBy: form.approvedBy, approvedOn: form.date }
      else if (pane.kind === 'fixed') command = { operation: 'create_entry', id: pane.id, agreementId: agreement?.id, costId: null, description: agreement?.title, netOre: n('net'), fulfilled: form.reason, date: form.date }
      else if (pane.kind === 'basis') command = { operation: 'reserve_basis', id: pane.id, title: form.title, date: form.date, note: form.note || '', lines: Object.entries(selection).map(([entryId, value]) => ({ id: crypto.randomUUID(), entryId, netOre: billingParseAmount(value) })) }
      else if (pane.kind === 'invoice') command = { operation: 'register_invoice', id: pane.id, number: form.number, issuer: data.issuer, date: form.date, kind: form.kind, confirmed, note: form.note || '', externalNetOre: n('external'), lines: data.flow.bases.filter(b => b.status !== 'cancelled').flatMap(b => b.lines.filter(l => `${b.id}:${l.id}` in invoiceAmounts).map(l => ({ basisId: b.id, lineId: l.id, netOre: billingParseAmount(invoiceAmounts[`${b.id}:${l.id}`]) }))) }
      else if (pane.kind === 'opening') command = { operation: 'record_opening_invoice', id: pane.id, basisId: ids.basis, number: form.number, date: form.date, confirmed, note: form.note || '', externalNetOre: n('external'), lines: Object.entries(invoiceAmounts).map(([agreementId, value]) => ({ id: crypto.randomUUID(), entryId: crypto.randomUUID(), agreementId, netOre: billingParseAmount(value) })) }
      else if (pane.kind === 'budget') command = { operation: 'budget_review', agreementId: agreement?.id, date: form.date, remainingOre: n('remaining'), participants: form.participants, decision: form.reason, evidence: form.evidence }
      else if (pane.kind === 'match') command = { operation: 'match_supplier', id: pane.id, supplierKey: form.supplierKey, reason: form.reason }
      else if (pane.kind === 'credit') command = { operation: 'credit_entry', id: ids.action, replacementId: ids.replacement, entryId: pane.id, netOre: n('net'), reason: form.reason, rebill, date: form.date }
      else if (pane.kind === 'waive') command = { operation: 'waive_entry', id: pane.id, netOre: n('net'), reason: form.reason }
      else if (pane.kind === 'legacy') command = { operation: 'confirm_legacy', note: form.reason }
      else if (pane.kind === 'cancel') command = { operation: 'cancel_basis', id: pane.id, confirmed, reason: form.reason }
      else if (pane.kind === 'release') command = { operation: 'release_basis', id: pane.id, confirmed, reason: form.reason, date: today(), releaseIds: data.flow.bases.find(b => b.id === pane.id)?.lines.filter(l => billingBasisRemaining(data.flow, pane.id, l.id)).map(() => crypto.randomUUID()) }
      else if (pane.kind === 'reopen') command = { operation: 'reopen_economy', reason: form.reason }
      else command = { operation: 'waive_cost', id: pane.id, reason: form.reason }
      await onSubmit(command)
    } catch (error) { const e = error as Error; setLocalError(billingErrors[e.message] || e.message) }
  }
  const formId = useId()
  return <Drawer title={titles[pane.kind]} onClose={onClose} footer={<><button type="button" className="gizmo-text-button" disabled={busy} onClick={onClose}>Avbryt</button><button type="submit" form={formId} className="gizmo-button" disabled={busy}>{busy ? 'Sparar…' : pane.kind === 'invoice' ? 'Bekräfta fakturering' : 'Bekräfta'}</button></>}>
    {(localError || error) && <p className="gbf-error" role="alert">{localError || error}</p>}
    {recovery}
    <form id={formId} onSubmit={e => void submit(e)}><fieldset disabled={busy} className="gbf-fields">
      {pane.kind === 'agreement' && <>
        <label className="gbf-wide">ÄTA eller avtalad del<select required value={form.key || ''} onChange={e => setForm(s => ({ ...s, key: e.target.value }))}><option value="">Välj</option>{data.candidates.map(c => <option key={c.key} value={c.key}>{c.title} / {c.group === 'change' ? 'ÄTA' : 'Grundavtal'}</option>)}</select></label>
        {candidate && <div className="gbf-wide gbf-status"><span>{candidate.mode === 'fixed' ? 'Fast pris' : candidate.mode === 'budget' ? 'Löpande med planeringsbudget' : 'Löpande räkning'}</span>{candidate.fixedGrossOre !== null && <strong>{money(candidate.fixedGrossOre)} inkl. moms</strong>}<span>{candidate.reference}</span></div>}
        <label>Kundmoms<select value={form.vatRate} onChange={e => setForm(s => ({ ...s, vatRate: e.target.value }))}>{[0, 6, 12, 25].map(r => <option key={r} value={r}>{r} %</option>)}</select></label>{field('date', 'Datum för godkännande', { type: 'date', required: true })}{field('approvedBy', 'Godkänt av beställare', { required: true })}{field('evidence', 'Hänvisning till beställning / avtal / mejl', { multiline: true, required: true })}
      </>}
      {['fixed', 'basis', 'invoice', 'opening', 'budget', 'credit'].includes(pane.kind) && field('date', 'Datum', { type: 'date', required: true })}
      {pane.kind === 'fixed' && <>{field('net', 'Fakturerbart belopp exkl. moms', { required: true })}{field('reason', 'Utfört arbete och uppfyllda faktureringsvillkor', { multiline: true, required: true })}{agreement?.conditions && <p className="gbf-wide gbf-status">{agreement.conditions}</p>}</>}
      {pane.kind === 'basis' && <>{field('title', 'Rubrik', { required: true })}{field('note', 'Notering till kundens underlag', { multiline: true })}<div className="gbf-wide">{Object.keys(selection).length} valda faktureringsposter</div></>}
      {pane.kind === 'invoice' && <>
        {field('number', 'Fortnox fakturanummer', { required: true })}<label>Typ<select value={form.kind} onChange={e => { setForm(s => ({ ...s, kind: e.target.value })); setInvoiceAmounts({}) }}><option value="invoice">Kundfaktura</option><option value="credit">Kreditfaktura</option></select></label>
        <div className="gbf-wide"><strong>{data.issuer.split('\n')[0]}</strong></div>
        <div className="gbf-wide gbf-table"><table><thead><tr><th>Välj</th><th>Underlag / post</th><th>Fakturerat nu exkl. moms</th></tr></thead><tbody>{data.flow.bases.filter(b => b.status !== 'cancelled' && b.issuer === data.issuer).flatMap(b => b.lines.map(l => ({ b, l, remaining: billingBasisRemaining(data.flow, b.id, l.id) }))).filter(({ remaining }) => form.kind === 'credit' ? remaining < 0 : remaining > 0).map(({ b, l, remaining }) => {
          const key = `${b.id}:${l.id}`
          return <tr key={key}><td><input type="checkbox" aria-label={`Fakturera ${l.description}`} checked={key in invoiceAmounts} onChange={e => setInvoiceAmounts(s => { const next = { ...s }; if (e.target.checked) next[key] = amountText(remaining); else delete next[key]; return next })} /></td><td>{l.description}<small>{b.title} / {b.id.slice(0, 8)}</small></td><td>{key in invoiceAmounts ? <input className="gbf-amount" aria-label={`Fakturerat belopp ${l.description}`} inputMode="decimal" value={invoiceAmounts[key]} onChange={e => setInvoiceAmounts(s => ({ ...s, [key]: e.target.value }))} /> : money(remaining)}</td></tr>
        })}</tbody></table></div>
        {field('external', 'Övrigt på samma faktura, exkl. moms')}{field('note', 'Förklaring för övrigt belopp', { multiline: true })}<output className="gbf-wide gbf-status">Totalt registrerat på fakturan exkl. moms: {invoiceNet === null ? 'Kontrollera beloppen' : money(invoiceNet)}</output><label className="gbf-wide gbf-check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} required />Jag har kontrollerat den verkliga fakturan och de valda beloppen.</label>
      </>}
      {pane.kind === 'opening' && <>
        {field('number', 'Tidigare Fortnox fakturanummer', { required: true })}
        <div className="gbf-wide gbf-table"><table><thead><tr><th>Välj</th><th>Överenskommelse</th><th>Tidigare fakturerat exkl. moms</th></tr></thead><tbody>{data.flow.agreements.filter(a => a.mode === 'fixed' && data.flow.agreements.filter(v => v.key === a.key).at(-1)?.id === a.id).map(a => <tr key={a.id}><td><input type="checkbox" aria-label={`Tidigare fakturerat ${a.title}`} checked={a.id in invoiceAmounts} onChange={e => setInvoiceAmounts(s => { const next = { ...s }; if (e.target.checked) next[a.id] = ''; else delete next[a.id]; return next })} /></td><td>{a.title}</td><td>{a.id in invoiceAmounts && <input required className="gbf-amount" inputMode="decimal" aria-label={`Tidigare belopp ${a.title}`} value={invoiceAmounts[a.id]} onChange={e => setInvoiceAmounts(s => ({ ...s, [a.id]: e.target.value }))} />}</td></tr>)}</tbody></table></div>
        {field('external', 'Övrigt på den tidigare fakturan exkl. moms')}{field('note', 'Hänvisning till tidigare faktura och avstämning', { multiline: true, required: true })}
        <label className="gbf-wide gbf-check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} required />Beloppen är redan fakturerade och ska räknas av, inte debiteras igen.</label>
      </>}
      {pane.kind === 'budget' && <>{field('remaining', 'Bedömd återstående kunddebitering exkl. moms', { required: true })}{field('participants', 'Deltagare i avstämningen', { required: true })}{field('reason', 'Besked om omfattning, kostnader och fortsatt arbete', { multiline: true, required: true })}{field('evidence', 'Hänvisning till kundens besked', { multiline: true, required: true })}</>}
      {pane.kind === 'match' && <><div className="gbf-wide gbf-status">{selectedCost?.description}</div><label className="gbf-wide">Leverantörsfaktura / fördelad del<select required value={form.supplierKey || ''} onChange={e => setForm(s => ({ ...s, supplierKey: e.target.value }))}><option value="">Välj</option>{data.suppliers.filter(s => !s.legacy && selectedAgreement && billingMatchesTarget(s, selectedAgreement) && !data.flow.costs.some(c => c.id !== pane.id && c.supplier?.key === s.key)).map(s => <option key={s.key} value={s.key}>{s.title} / {money(s.netOre)} exkl. moms</option>)}</select></label>{field('reason', 'Bekräftelse att detta avser samma kostnad', { multiline: true, required: true })}</>}
      {['credit', 'waive'].includes(pane.kind) && <>{field('net', pane.kind === 'credit' ? 'Kreditbelopp exkl. moms, positivt belopp' : 'Belopp att avstå exkl. moms', { required: true })}{field('reason', 'Skäl / överenskommelse', { multiline: true, required: true })}{pane.kind === 'credit' && <label className="gbf-wide gbf-check"><input type="checkbox" checked={rebill} onChange={e => setRebill(e.target.checked)} />Fakturan ska ersättas, inte prisminskas. Ny debitering öppnas först när krediten registrerats.</label>}</>}
      {['legacy', 'cancel', 'release', 'reopen', 'waiveCost'].includes(pane.kind) && field('reason', pane.kind === 'legacy' ? 'Avstämning av tidigare underlag och redan utfärdade fakturor' : 'Skäl', { multiline: true, required: true })}
      {pane.kind === 'cancel' && <label className="gbf-wide gbf-check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} required />Underlaget har inte använts för en verklig faktura.</label>}
      {pane.kind === 'release' && <label className="gbf-wide gbf-check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} required />Endast den ofakturerade resten frigörs. Gamla PDF:er och registrerade fakturabelopp behålls.</label>}
    </fieldset></form>
  </Drawer>
}
