'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AlertCircle, ChevronLeft, ChevronRight, FileText, Loader2, Paperclip, Plus, RefreshCw, Search, Wallet } from 'lucide-react'
import ActionButton from '@/components/ui/ActionButton'
import type { ActionCaseView } from '@/lib/action-cases/contracts'
import type { SupplierInvoice } from '@/lib/supplier-invoices/contracts'
import { formatInvoiceAmount, getProjectInvoiceEconomy, invoiceAllocatedOre, invoiceSignedAmount, invoiceUnallocatedOre, summarizeSupplierInvoices } from '@/lib/supplier-invoices/domain'
import SupplierInvoiceEditor, { INVOICE_APPROVALS, invoiceToday } from './SupplierInvoiceEditor'

type Props = { cases: ActionCaseView[]; caseId?: string; initialInvoices?: SupplierInvoice[] }
type Filter = 'all' | 'unallocated' | 'unpaid' | 'overdue' | 'disputed' | 'void'
const PAGE_SIZES = [25, 50, 100] as const
const button = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50'
const moneyOrDash = (value: number | null) => value === null ? '–' : formatInvoiceAmount(value)

function Metric({ label, value, detail, icon, tone = 'text-slate-950' }: { label: string; value: number | null; detail: string; icon?: ReactNode; tone?: string }) {
  return <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-4"><div className="flex items-start justify-between gap-2"><p className="text-xs font-semibold text-slate-500">{label}</p>{icon ? <span className="text-slate-400">{icon}</span> : null}</div><p className={`mt-2 break-words text-xl font-semibold tabular-nums ${tone}`}>{moneyOrDash(value)}</p><p className="mt-2 text-xs leading-5 text-slate-500">{detail}</p></div>
}

export function SupplierInvoiceProjectEconomy({ actionCase, invoices }: { actionCase: ActionCaseView; invoices: SupplierInvoice[] }) {
  const economy = getProjectInvoiceEconomy(actionCase, invoices)
  return <div className="mt-5">
    <div className="grid gap-3 sm:grid-cols-3">
      <Metric label="Intern kalkyl exkl. moms" value={economy.estimatedCostOre} detail="Projektets beräknade interna kostnad" />
      <Metric label="Leverantörskostnad exkl. moms" value={economy.actualCostOre} detail={`${economy.invoiceCount} registrerade fakturor och krediter`} icon={<Wallet size={17} />} />
      <Metric label="Skillnad mot kalkyl" value={economy.remainingEstimateOre} detail={economy.remainingEstimateOre !== null && economy.remainingEstimateOre < 0 ? 'Leverantörskostnaden överstiger kalkylen' : 'Kalkyl minus registrerade leverantörskostnader'} tone={economy.remainingEstimateOre !== null && economy.remainingEstimateOre < 0 ? 'text-rose-700' : 'text-slate-950'} />
    </div>
    <p className="mt-3 text-xs leading-5 text-slate-500">Kalkylen kan innehålla eget arbete. Utfallet här visar enbart fördelade leverantörsfakturor, inklusive bestridda fakturor och avdrag för krediter. Eget arbete och framtida kostnader behöver följas upp separat; skillnaden är ingen slutprognos.</p>
    <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200"><table className="w-full min-w-[590px] border-collapse text-sm"><caption className="sr-only">Kalkyl och registrerade leverantörskostnader per åtgärd</caption><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-3 py-1.5 text-left font-semibold">Åtgärd</th><th className="px-3 py-1.5 text-right font-semibold">Intern kalkyl</th><th className="px-3 py-1.5 text-right font-semibold">Leverantörskostnad</th><th className="px-3 py-1.5 text-right font-semibold">Skillnad</th></tr></thead><tbody>{economy.rows.map((row) => <tr key={row.itemId ?? 'project'} className="border-t border-slate-100"><th scope="row" className="px-3 py-1.5 text-left font-medium text-slate-800">{row.title}</th><td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-slate-600">{moneyOrDash(row.estimatedCostOre)}</td><td className="whitespace-nowrap px-3 py-1.5 text-right font-semibold tabular-nums text-slate-950">{formatInvoiceAmount(row.actualCostOre)}</td><td className={`whitespace-nowrap px-3 py-1.5 text-right tabular-nums ${row.remainingEstimateOre !== null && row.remainingEstimateOre < 0 ? 'text-rose-700' : 'text-slate-600'}`}>{moneyOrDash(row.remainingEstimateOre)}</td></tr>)}</tbody></table></div>
  </div>
}

function overdue(invoice: SupplierInvoice, today: string) {
  return invoice.approvalStatus !== 'void' && invoice.documentKind === 'invoice' && invoice.paymentStatus === 'unpaid' && invoice.dueDate < today
}

export default function SupplierInvoiceWorkspace({ cases, caseId, initialInvoices }: Props) {
  const [invoices, setInvoices] = useState<SupplierInvoice[]>(initialInvoices ?? [])
  const [projectCases, setProjectCases] = useState(cases)
  const [loading, setLoading] = useState(initialInvoices === undefined)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [search, setSearch] = useState('')
  const [projectFilter, setProjectFilter] = useState(caseId ?? '')
  const [filter, setFilter] = useState<Filter>('all')
  const [pageSize, setPageSize] = useState<number>(50)
  const [page, setPage] = useState(0)
  const [editor, setEditor] = useState<{ invoice: SupplierInvoice | null; key: string } | null>(null)
  const today = invoiceToday()

  function refresh() {
    setLoading(initialInvoices === undefined)
    setError(null)
    setReload((value) => value + 1)
  }

  useEffect(() => {
    if (initialInvoices !== undefined) return
    const controller = new AbortController()
    void fetch('/api/supplier-invoices', { cache: 'no-store', signal: controller.signal }).then(async (response) => {
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || 'Kunde inte läsa leverantörsfakturorna.')
      if (!Array.isArray(result.invoices)) throw new Error('Fakturorna kunde inte läsas. Försök igen.')
      setInvoices(result.invoices)
    }).catch((caught) => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'Kunde inte läsa fakturorna.') }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    // Refresh project choices after an action case was created in the adjacent workspace.
    if (!caseId) void fetch('/api/action-cases', { cache: 'no-store', signal: controller.signal }).then(async (response) => {
      if (response.ok) { const result = await response.json(); if (Array.isArray(result.workspace?.cases)) setProjectCases(result.workspace.cases) }
    }).catch(() => undefined)
    return () => controller.abort()
  }, [reload, caseId, initialInvoices])

  const availableCases = caseId ? cases : projectCases
  const selectedProjectId = caseId || projectFilter
  const actionCase = availableCases.find((project) => project.id === selectedProjectId)
  const summary = summarizeSupplierInvoices(invoices, today)
  const shown = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('sv-SE')
    return invoices.filter((invoice) => {
      if (projectFilter && !invoice.allocations.some((allocation) => allocation.caseId === projectFilter)) return false
      if (filter === 'void') { if (invoice.approvalStatus !== 'void') return false }
      else {
        if (invoice.approvalStatus === 'void') return false
        if (filter === 'unallocated' && invoiceUnallocatedOre(invoice) <= 0) return false
        if (filter === 'unpaid' && invoice.paymentStatus !== 'unpaid') return false
        if (filter === 'overdue' && !overdue(invoice, today)) return false
        if (filter === 'disputed' && invoice.approvalStatus !== 'disputed') return false
      }
      return !term || [invoice.supplierName, invoice.supplierOrgNumber, invoice.invoiceNumber, invoice.notes, ...invoice.allocations.map((allocation) => availableCases.find((project) => project.id === allocation.caseId)?.title)].some((value) => value?.toLocaleLowerCase('sv-SE').includes(term))
    }).sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate) || b.createdAt.localeCompare(a.createdAt))
  }, [invoices, projectFilter, filter, search, availableCases, today])
  const lastPage = Math.max(0, Math.ceil(shown.length / pageSize) - 1)
  const currentPage = Math.min(page, lastPage)
  const pageStart = currentPage * pageSize
  const pageInvoices = shown.slice(pageStart, pageStart + pageSize)

  return <section className="mt-7 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6" aria-label={caseId ? 'Projektekonomi och leverantörsfakturor' : 'Leverantörsfakturor'}>
    <header className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><div className="flex items-center gap-2 text-violet-700"><FileText size={18} /><p className="text-xs font-semibold uppercase tracking-wide">{caseId ? 'Projektekonomi' : 'Ekonomi i Uppgifter'}</p></div><h2 className="mt-2 text-xl font-semibold text-slate-950">{caseId ? 'Ekonomi och leverantörsfakturor' : 'Leverantörsfakturor'}</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">{caseId ? 'Följ projektets leverantörskostnader och jämför med den interna kalkylen.' : 'Registrera underlaget en gång. Fördela kostnaden på rätt projekt och åtgärd.'}</p></div><div className="flex flex-wrap gap-2"><ActionButton type="button" tone="secondary" busy={loading} busyLabel="Läser fakturor…" icon={<RefreshCw size={17} />} className="min-h-11 rounded-lg px-4 text-sm font-semibold" onClick={refresh} aria-label="Uppdatera leverantörsfakturor">Uppdatera</ActionButton><button type="button" disabled={loading || Boolean(error)} onClick={() => setEditor({ invoice: null, key: crypto.randomUUID() })} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-violet-700 px-4 text-sm font-semibold text-white hover:bg-violet-800 disabled:opacity-40"><Plus size={17} /> Ny faktura</button></div></header>

    {error ? <div role="alert" className="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm leading-6 text-rose-900"><div className="flex items-start gap-2"><AlertCircle size={18} className="mt-1 shrink-0" /><p>{error}</p></div><ActionButton type="button" tone="secondary" busy={loading} busyLabel="Läser fakturor…" icon={<RefreshCw size={16} />} onClick={refresh} className="mt-3 min-h-11 rounded-lg px-4 text-sm font-semibold">Försök igen</ActionButton></div> : loading ? <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-slate-500" role="status"><Loader2 size={19} className="animate-spin" /> Läser leverantörsfakturor…</div> : <>
      {selectedProjectId && actionCase ? <SupplierInvoiceProjectEconomy actionCase={actionCase} invoices={invoices} /> : <><div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Registrerad nettokostnad" value={summary.registeredNetCostOre} detail="Alla fakturor minus krediter, exkl. moms" icon={<Wallet size={17} />} /><Metric label="Obetalt inkl. moms" value={summary.unpaidGrossOre} detail="Manuell status, inklusive oreglerade krediter" /><Metric label="Förfallna fakturor inkl. moms" value={summary.overdueGrossOre} detail="Obetalda fakturor vars förfallodatum passerat" tone={summary.overdueGrossOre > 0 ? 'text-rose-700' : 'text-slate-950'} /><Metric label="Kvar att fördela exkl. moms" value={summary.unallocatedNetOre} detail="Belopp som ännu saknar projektfördelning" tone={summary.unallocatedNetOre !== 0 ? 'text-amber-700' : 'text-slate-950'} /></div><p className="mt-3 text-xs leading-5 text-slate-500">Beloppen bygger på registrerade uppgifter. Granskning och betalning anges separat. Makulerade fakturor räknas inte. Registrering sker manuellt tills Fortnox är anslutet för leverantörsfakturor.</p></>}

      <div className="mt-6 flex flex-wrap items-end gap-3"><label className="min-w-48 flex-1 text-xs font-semibold text-slate-600">Sök faktura<span className="relative mt-1 block"><Search size={16} className="absolute left-3 top-3.5 text-slate-400" /><input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0) }} placeholder="Leverantör, fakturanummer eller projekt" className="min-h-11 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm font-normal text-slate-950" /></span></label>{!caseId ? <label className="min-w-44 text-xs font-semibold text-slate-600">Projekt<select value={projectFilter} onChange={(e) => { setProjectFilter(e.target.value); setPage(0) }} className="mt-1 block min-h-11 w-full max-w-xs rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal text-slate-950"><option value="">Alla projekt</option>{availableCases.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select></label> : null}<label className="min-w-44 text-xs font-semibold text-slate-600">Visa<select value={filter} onChange={(e) => { setFilter(e.target.value as Filter); setPage(0) }} className="mt-1 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal text-slate-950"><option value="all">Alla aktiva fakturor</option><option value="unallocated">Kvar att fördela</option><option value="unpaid">Obetalda / oreglerade</option><option value="overdue">Förfallna</option><option value="disputed">Bestridda</option><option value="void">Makulerade</option></select></label></div>
      <p className="mt-3 text-xs text-slate-500">{shown.length} fakturor{selectedProjectId ? ' kopplade till projektet' : ''} · Alla belopp i SEK · Öppna en faktura för detaljer.</p>
      {shown.length ? <>
        <div className="mt-3 max-h-[60vh] overflow-auto rounded-lg border border-slate-200 focus-visible:outline-2 focus-visible:outline-violet-600" role="region" aria-label="Fakturalista, rulla för att visa fler kolumner" tabIndex={0}>
          <table data-testid="invoice-table" className="w-full min-w-[1052px] table-fixed border-collapse whitespace-nowrap text-[13px] leading-5">
            <caption className="sr-only">Leverantörsfakturor. {selectedProjectId ? 'Beloppet visar projektets andel exklusive moms.' : 'Belopp exklusive moms.'} Öppna en faktura för detaljer.</caption>
            <colgroup><col style={{ width: 180 }} /><col style={{ width: 104 }} /><col style={{ width: 88 }} /><col style={{ width: 88 }} /><col style={{ width: 130 }} /><col style={{ width: 82 }} /><col style={{ width: 78 }} /><col style={{ width: 112 }} /><col style={{ width: 146 }} /><col style={{ width: 44 }} /></colgroup>
            <thead className="text-xs text-slate-500"><tr className="h-8 border-b border-slate-200">
              <th scope="col" className="sticky left-0 top-0 z-30 bg-slate-50 px-2 py-0 text-left font-semibold">Leverantör</th>
              <th scope="col" className="sticky top-0 z-20 bg-slate-50 px-2 py-0 text-left font-semibold">Fakturanr</th>
              <th scope="col" className="sticky top-0 z-20 bg-slate-50 px-2 py-0 text-left font-semibold">Fakturadatum</th>
              <th scope="col" className="sticky top-0 z-20 bg-slate-50 px-2 py-0 text-left font-semibold">Förfaller</th>
              <th scope="col" className="sticky top-0 z-20 bg-slate-50 px-2 py-0 text-left font-semibold">Projekt</th>
              <th scope="col" className="sticky top-0 z-20 bg-slate-50 px-2 py-0 text-left font-semibold">Granskning</th>
              <th scope="col" className="sticky top-0 z-20 bg-slate-50 px-2 py-0 text-left font-semibold">Betalning</th>
              <th scope="col" className="sticky top-0 z-20 bg-slate-50 px-2 py-0 text-right font-semibold" title="Ofördelat nettobelopp på hela fakturan">Kvar att fördela</th>
              <th scope="col" className="sticky top-0 z-20 bg-slate-50 px-2 py-0 text-right font-semibold">{selectedProjectId ? 'Projektandel exkl. moms' : 'Belopp exkl. moms'}</th>
              <th scope="col" className="sticky top-0 z-20 bg-slate-50 px-2 py-0 text-center font-semibold" title="Bilagor"><Paperclip size={13} className="mx-auto" aria-hidden="true" /><span className="sr-only">Bilagor</span></th>
            </tr></thead>
            <tbody>{pageInvoices.map((invoice) => {
              const unallocated = invoiceUnallocatedOre(invoice)
              const isOverdue = overdue(invoice, today)
              const linkedCases = [...new Set(invoice.allocations.map((allocation) => allocation.caseId))]
              const projectNames = linkedCases.map((projectId) => availableCases.find((project) => project.id === projectId)?.title ?? 'Projekt').join(' · ') || 'Ofördelad'
              const amount = selectedProjectId ? invoiceAllocatedOre(invoice, selectedProjectId) : invoice.netAmountOre
              const openInvoice = () => setEditor({ invoice, key: invoice.id })
              const paymentLabel = invoice.paymentStatus === 'paid' ? invoice.documentKind === 'credit' ? 'Reglerad' : 'Betald' : isOverdue ? 'Förfallen' : invoice.documentKind === 'credit' ? 'Oreglerad' : 'Obetald'
              return <tr key={invoice.id} data-invoice-id={invoice.id} onClick={openInvoice} className="group h-8 cursor-pointer border-b border-slate-100 bg-white last:border-b-0 hover:bg-slate-50">
                <td className="sticky left-0 z-10 bg-white px-2 py-0 group-hover:bg-slate-50"><button type="button" aria-label={`Öppna faktura ${invoice.invoiceNumber} från ${invoice.supplierName}`} title={invoice.supplierName} onClick={(event) => { event.stopPropagation(); openInvoice() }} style={{ minHeight: 0, height: 30 }} className="block w-full truncate rounded-none p-0 text-left font-semibold text-slate-950 focus-visible:outline-2 focus-visible:outline-violet-600">{invoice.supplierName}</button></td>
                <td className={`px-2 py-0 ${invoice.documentKind === 'credit' ? 'text-emerald-700' : 'text-slate-700'}`}><span className="block truncate" title={`${invoice.documentKind === 'credit' ? 'Kreditfaktura' : 'Faktura'} ${invoice.invoiceNumber}`}>{invoice.documentKind === 'credit' ? 'K ' : ''}{invoice.invoiceNumber}</span></td>
                <td className="px-2 py-0 text-xs tabular-nums text-slate-600">{invoice.invoiceDate}</td>
                <td className={`px-2 py-0 text-xs tabular-nums ${isOverdue ? 'text-rose-700' : 'text-slate-600'}`}>{invoice.dueDate}</td>
                <td className="px-2 py-0 text-xs text-slate-600"><span className="block truncate" title={projectNames}>{projectNames}</span></td>
                <td className={`px-2 py-0 text-xs ${invoice.approvalStatus === 'void' ? 'text-slate-500' : invoice.approvalStatus === 'disputed' ? 'font-medium text-rose-700' : invoice.approvalStatus === 'approved' ? 'text-emerald-700' : 'text-slate-600'}`}>{INVOICE_APPROVALS[invoice.approvalStatus]}</td>
                <td className={`px-2 py-0 text-xs ${isOverdue ? 'font-medium text-rose-700' : invoice.paymentStatus === 'paid' ? 'text-emerald-700' : 'text-slate-600'}`}>{paymentLabel}</td>
                <td className={`px-2 py-0 text-right text-xs tabular-nums ${unallocated > 0 && invoice.approvalStatus !== 'void' ? 'text-amber-800' : 'text-slate-400'}`}>{invoice.approvalStatus === 'void' || unallocated === 0 ? '–' : formatInvoiceAmount(unallocated)}</td>
                <td className={`px-2 py-0 text-right font-semibold tabular-nums ${invoice.documentKind === 'credit' ? 'text-emerald-700' : 'text-slate-950'}`}>{formatInvoiceAmount(invoiceSignedAmount(invoice, amount))}</td>
                <td className="px-2 py-0 text-center text-xs tabular-nums text-slate-500" title={`${invoice.attachments.length} bilagor`}>{invoice.attachments.length || '–'}</td>
              </tr>
            })}</tbody>
          </table>
        </div>
        <nav aria-label="Sidindelning för leverantörsfakturor" className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-slate-600">
          <p aria-live="polite" className="tabular-nums">{pageStart + 1}–{Math.min(pageStart + pageSize, shown.length)} av {shown.length}</p>
          <div className="flex flex-wrap items-center gap-3"><label className="inline-flex items-center gap-2">Rader per sida<select aria-label="Fakturor per sida" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(0) }} className="rounded-md border border-slate-300 bg-white px-2 text-xs font-normal text-slate-800" style={{ minHeight: 32 }}>{PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}</select></label><div className="inline-flex items-center gap-1"><button type="button" aria-label="Föregående sida" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} className="inline-flex w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-35" style={{ minHeight: 32 }}><ChevronLeft size={16} /></button><span className="min-w-16 text-center tabular-nums">{currentPage + 1} / {lastPage + 1}</span><button type="button" aria-label="Nästa sida" disabled={currentPage >= lastPage} onClick={() => setPage(currentPage + 1)} className="inline-flex w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-35" style={{ minHeight: 32 }}><ChevronRight size={16} /></button></div></div>
        </nav>
      </> : <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50/50 px-5 py-10 text-center"><FileText size={27} className="mx-auto text-slate-400" /><h3 className="mt-3 text-base font-semibold text-slate-800">{invoices.length ? 'Inga fakturor matchar urvalet' : 'Registrera den första fakturan'}</h3><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">{invoices.length ? caseId ? 'Lägg till en faktura och fördela den på projektet, eller ändra filtret.' : 'Ändra sökningen eller filtret för att visa fler fakturor.' : 'Klistra in text eller fyll i uppgifterna manuellt. Bifoga fakturan och koppla kostnaden till ett projekt.'}</p><button type="button" onClick={() => setEditor({ invoice: null, key: crypto.randomUUID() })} className={`${button} mt-4`}><Plus size={17} /> Ny faktura</button></div>}
    </>}
    {editor ? <SupplierInvoiceEditor key={editor.key} initial={editor.invoice} invoices={invoices} cases={availableCases} defaultCaseId={selectedProjectId || undefined} onClose={() => setEditor(null)} onSaved={(workspace) => setInvoices(workspace.invoices)} /> : null}
  </section>
}
