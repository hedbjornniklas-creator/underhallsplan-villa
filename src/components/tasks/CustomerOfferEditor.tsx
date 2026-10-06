'use client'

import Image from 'next/image'
import PendingLink from '@/components/ui/PendingLink'
import { useEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CalendarClock,
  Check,
  Eye,
  FilePlus2,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Send,
  Trash2,
  WalletCards
} from 'lucide-react'
import type {
  ActionCaseView,
  ActionCasePortal
} from '@/lib/action-cases/contracts'
import {
  customerOfferBaseAmount,
  money,
  offerPublishIssues,
  type CustomerOffer,
  type CustomerOfferDraft,
  type CustomerOfferSnapshot,
  type CustomerOfferWorkspace
} from '@/lib/action-cases/customerOffers'
import { useToast } from '@/components/ui/AppToastProvider'
import CustomerOfferDocument from './CustomerOfferDocument'
import ActionCaseCustomerPortal from './ActionCaseCustomerPortal'
import PriceInput from './CustomerOfferPriceInput'
import CustomerOfferCostCalculator from './CustomerOfferCostCalculator'
import type { CustomerOfferCosting } from '@/lib/action-cases/customerOfferCosting'
import CustomerContractFields from './CustomerContractFields'
import CustomerPlanningEditor from './CustomerPlanningEditor'
import { emptyContractDetails, type ContractFieldKey } from '@/lib/action-cases/customerContract'
import { PaymentPlanDocument, PaymentPlanEditor } from './CustomerPaymentPlan'
import ProjectEditorRow from './ProjectEditorRow'
import { retainNewerDraft } from '@/lib/action-cases/draftSave'
import type { ProjectScheduleRow } from '@/lib/action-cases/projectSchedule'
import CustomerOfferSourcePicker from './CustomerOfferSourcePicker'
import { ContractCustomerEditor, ContractContractorEditor } from './CustomerContractPartiesEditor'
import { emptyContractParties, type ContractContractor } from '@/lib/action-cases/customerContractParties'
import ContractCustomerRegistry from './ContractCustomerRegistry'

const field =
  'mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-50'
const button =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-50'
export type CustomerEditorView = 'edit' | 'contract' | 'document' | 'offerDocument' | 'customer' | 'planning' | 'payments'
export default function CustomerOfferEditor({
  actionCase,
  initial,
  issuerName,
  replyEmail,
  embedded = false,
  active = true,
  view: controlledView,
  onViewChange,
  onWorkspaceChange,
  onCustomerChanged,
  onDirtyChange,
  sharedSchedule,
  sourcePending = false,
  contractorSource
}: {
  actionCase: ActionCaseView
  initial: CustomerOfferWorkspace
  issuerName: string
  replyEmail: string
  embedded?: boolean
  active?: boolean
  view?: CustomerEditorView
  onViewChange?: (view: CustomerEditorView) => void
  onWorkspaceChange?: (workspace: CustomerOfferWorkspace) => void
  onCustomerChanged?: () => void
  onDirtyChange?: (dirty: boolean) => void
  sharedSchedule?: ProjectScheduleRow[]
  sourcePending?: boolean
  contractorSource?: Partial<ContractContractor>
}) {
  const initialCustomer = initial.recipient ?? actionCase.participants.find((p) => p.role === 'customer')
  const [workspace, setWorkspace] = useState(initial),
    [draft, setDraft] = useState(() => ({ ...initial.draft,
      contractDetails: initial.draft.contractDetails ?? emptyContractDetails(),
      contractParties: initial.draft.contractParties ?? emptyContractParties(initialCustomer?.name ?? actionCase.customerName,
        initialCustomer?.email ?? '', initialCustomer?.phone ?? '', { companyName: issuerName, email: replyEmail, ...contractorSource })
    }))
  const [costing, setCosting] = useState<CustomerOfferCosting>(initial.costing ?? {})
  const customer = workspace.recipient ?? actionCase.participants.find((p) => p.role === 'customer')
  const [internalView, setInternalView] = useState<CustomerEditorView>('edit')
  const view = controlledView ?? internalView
  const setView = (next: CustomerEditorView) => { setInternalView(next); onViewChange?.(next) }
  const [itemView, setItemView] = useState<'included' | 'excluded'>('included')
  const [removeId, setRemoveId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>('customer')
  const [planningDirty, setPlanningDirty] = useState(false)
  const planningDirtyRef = useRef(planningDirty)
  planningDirtyRef.current = planningDirty
  const [planning, setPlanning] = useState(initial.planning)
  const [planningReset, setPlanningReset] = useState(0)
  const heading = useRef<HTMLHeadingElement>(null)
  const previousView = useRef(view)
  const [busy, setBusy] = useState(''),
    running = useRef(false),
    toast = useToast()
  const [confirmed, setConfirmed] = useState(false)
  const [confirmItemized, setConfirmItemized] = useState(false)
  const [sourceReviewCount, setSourceReviewCount] = useState(-1)
  const parties = draft.contractParties ?? emptyContractParties(customer?.name ?? actionCase.customerName, customer?.email ?? '', customer?.phone ?? '', { companyName: issuerName, email: replyEmail, ...contractorSource })
  const contractView = view === 'contract'
  const dirty = JSON.stringify(draft) !== JSON.stringify(workspace.draft) ||
    JSON.stringify(costing) !== JSON.stringify(workspace.costing ?? {})
  useEffect(() => { onDirtyChange?.(dirty || planningDirty || Boolean(busy)) }, [dirty, planningDirty, busy, onDirtyChange])
  useEffect(() => { onWorkspaceChange?.({ ...workspace, planning }) }, [workspace, planning, onWorkspaceChange])
  const locked = workspace.offers.some((o) => o.status === 'accepted')
  const issues = [
    ...offerPublishIssues(draft),
    ...(sourcePending ? ['Projektarbete har ändringar som inte har sparats klart.'] : []),
    ...(sourceReviewCount > 0 ? [`Granska ändrat underlag för ${sourceReviewCount} arbetsdelar under Uppdraget.`] : []),
    ...(sourceReviewCount === -2 ? ['Jämförelsen med Projektarbete misslyckades. Försök igen under Uppdraget.'] : []),
    ...(!customer?.email?.trim()
      ? ['Ange beställarens e-postadress i uppdraget.']
      : [])
  ]
  const files = actionCase.attachments.filter((f) => !f.isQuoteDocument)
  const baseAmount = customerOfferBaseAmount(draft)
  const legacyChoices = draft.items.filter((i) => i.kind === 'option')
  const missingPriceCount = draft.items.filter(
    (i) => i.kind === 'included' && i.amountOre === null
  ).length
  const update = (patch: Partial<CustomerOfferDraft>) => {
    setDraft((d) => ({ ...d, ...patch }))
    if (patch.items) {
      const ids = new Set(patch.items.map((item) => item.id))
      setCosting((current) => Object.fromEntries(Object.entries(current).filter(([id]) => ids.has(id))))
    }
    setConfirmed(false)
  }
  useEffect(() => {
    if (embedded || !active || previousView.current === view) return
    previousView.current = view
    heading.current?.focus({ preventScroll: true })
    heading.current?.scrollIntoView({ block: 'start', behavior: 'instant' })
  }, [view, active, embedded])
  useEffect(() => {
    if (!dirty && !planningDirty) return
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', prevent)
    return () => window.removeEventListener('beforeunload', prevent)
  }, [dirty, planningDirty])
  async function action(
    operation: string,
    extra: Record<string, unknown> = {}
  ) {
    if (running.current) return false
    if (operation === 'save' && draft.contractParties &&
      (draft.contractParties.customers[0].name.trim() !== customer?.name ||
        draft.contractParties.email.trim().toLowerCase() !== customer?.email?.trim().toLowerCase()) &&
      (sourcePending || planningDirty)) {
      toast.error('Spara pågående projektarbete och planering innan du ändrar beställarens kontaktuppgifter.')
      return false
    }
    running.current = true
    setBusy(operation)
    try {
      const response = await fetch(
        `/api/action-cases/${actionCase.id}/customer-offers`,
        {
          method: operation === 'refresh' ? 'GET' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body:
            operation === 'refresh'
              ? undefined
              : JSON.stringify({
                  operation,
                  draft,
                  ...(workspace.costingAvailable ? { costing } : {}),
                  revision: workspace.revision,
                  confirmed,
                  ...extra
                })
        }
      )
      const data = await response.json()
      if (!response.ok)
        throw new Error(data.error || 'Offerten kunde inte hanteras.')
      if (operation === 'bind_customer' || data.recipient?.name !== workspace.recipient?.name ||
        data.recipient?.email !== workspace.recipient?.email) onCustomerChanged?.()
      setWorkspace(data)
      setDraft((current) => operation === 'save' ? retainNewerDraft(current, draft, data.draft) : data.draft)
      setCosting((current) => operation === 'save' ? retainNewerDraft(current, costing, data.costing ?? {}) : data.costing ?? {})
      if (operation === 'separate_choices' || operation === 'bind_customer' ||
        ((operation === 'save' || operation === 'refresh') && !planningDirtyRef.current)) {
        setPlanning(data.planning)
        setPlanningReset((value) => value + 1)
      }
      if (operation === 'separate_choices') setView('planning')
      setConfirmed(false)
      toast.success(
        operation === 'publish' || operation === 'send'
          ? 'Avtalet har skickats.'
          : operation === 'withdraw'
            ? 'Avtalet återkallades.'
            : operation === 'refresh'
              ? 'Statusen uppdaterades.'
              : operation === 'separate_choices'
                ? 'Valen har flyttats. Grundpriset är oförändrat. Inget har delats eller beställts.'
                : operation === 'bind_customer'
                  ? 'Kunden är kopplad. Avtalsutkastet och mottagaren har sparats.'
                : 'Ändringarna sparades.'
      )
      return true
    } catch (error) {
      toast.error(error, 'Offerten kunde inte hanteras.')
      // A publication may have committed even when the mail response was lost.
      if (operation === 'publish' || operation === 'send') {
        try {
          const response = await fetch(
            `/api/action-cases/${actionCase.id}/customer-offers`
          )
          if (response.ok) {
            const data = await response.json()
            setWorkspace(data)
          }
        } catch {
          /* Keep local draft and retry the same version. */
        }
      }
      return false
    } finally {
      running.current = false
      setBusy('')
    }
  }
  function move(index: number, delta: number) {
    const items = [...draft.items]
    const peers = items.map((item, position) => ({ item, position })).filter(({ item }) => item.kind === items[index].kind)
    const other = peers[peers.findIndex(({ position }) => position === index) + delta]?.position
    if (other === undefined) return
    ;[items[index], items[other]] = [items[other], items[index]]
    update({ items })
  }
  const snapshot: CustomerOfferSnapshot = {
    ...draft,
    projectTitle: actionCase.title,
    propertyAddress: actionCase.propertyAddress,
    customerName: customer?.name ?? actionCase.customerName,
    customerEmail: customer?.email ?? '',
    issuerName,
    replyEmail
  }
  const draftOffer: CustomerOffer = {
    id: 'draft',
    version: 0,
    status: 'published',
    snapshot,
    files: files
      .filter((f) => draft.attachmentIds.includes(f.id))
      .map((f) => ({
        id: f.id,
        fileName: f.fileName,
        contentType: f.contentType,
        fileSizeBytes: f.fileSizeBytes
      })),
    publishedAt: '',
    sentAt: null,
    acceptedAt: null,
    acceptedBy: null,
    acceptedOptionIds: [],
    acceptedTotalOre: null
  }
  const previewOffer = workspace.offers.find((o) => o.status === 'accepted') ?? draftOffer
  const portal: ActionCasePortal = {
    accessState: 'open',
    participant: customer ?? {
      id: '',
      role: 'customer',
      name: actionCase.customerName,
      email: null,
      companyName: null,
      phone: null
    },
    customerOffers: { enabled: true, offers: workspace.offers, plannedItems: planning?.sharedItems },
    actionCase: {
      schedule: sharedSchedule,
      id: actionCase.id,
      title: workspace.offers[0]?.snapshot.projectTitle ?? actionCase.title,
      propertyAddress:
        workspace.offers[0]?.snapshot.propertyAddress ??
        actionCase.propertyAddress,
      description: null,
      status: actionCase.status,
      items: [],
      attachments: actionCase.attachments.filter(
        (f) => customer && f.grantedParticipantIds.includes(customer.id)
      )
    }
  }
  const Container = embedded ? 'div' : 'main'
  const Heading = embedded ? 'h2' : 'h1'
  const contractSection = (id: string, title: string, keys: ContractFieldKey[], advice = false) => {
    const complete = keys.filter((key) => draft.contractDetails?.fields[key].status !== 'unreviewed' && draft.contractDetails?.fields[key].text.trim()).length
    return <ProjectEditorRow title={title} summary={advice ? draft.contractDetails?.advice.status === 'none' ? 'Ingen avrådan lämnad' : draft.contractDetails?.advice.status === 'given' ? 'Avrådan lämnad' : 'Behöver kontrolleras' : `${complete}/${keys.length} uppgifter ifyllda`}
      open={expanded === id} onToggle={() => setExpanded(expanded === id ? null : id)}>
      <CustomerContractFields value={draft.contractDetails} fieldKeys={keys} showAdvice={advice} inline onChange={(contractDetails) => update({ contractDetails })} />
    </ProjectEditorRow>
  }
  const priceSection = <ProjectEditorRow title="Priset" summary={`${draft.pricingMode === 'itemized' ? 'Fast pris per arbetsdel' : 'Fast klumpsumma'} · ${money(baseAmount)}`}
    open={expanded === 'price'} onToggle={() => setExpanded(expanded === 'price' ? null : 'price')}>
    <label className="block text-sm">Prissättning av grundåtagandet
      <select className={field} value={draft.pricingMode ?? 'total'} onChange={(e) => {
        const pricingMode = e.target.value as CustomerOfferDraft['pricingMode']
        if (pricingMode === 'itemized' && draft.baseAmountOre !== null) { setConfirmItemized(true); return }
        setConfirmItemized(false); update({ pricingMode, baseAmountOre: baseAmount })
      }}><option value="total">Fast klumpsumma</option><option value="itemized">Fast pris per arbetsdel</option></select>
    </label>
    {confirmItemized && <div role="alert" className="mt-3 border-l-4 border-amber-500 bg-amber-50 p-4 text-sm">
      <p>Klumpsumman {money(draft.baseAmountOre)} ersätts av summan av arbetsdelarnas priser. Beloppet fördelas inte automatiskt.</p>
      <div className="mt-3 flex flex-wrap gap-2"><button className={`${button} bg-white`} onClick={() => { update({ pricingMode: 'itemized' }); setConfirmItemized(false) }}><Check size={17} /> Byt till delpriser</button>
        <button className={button} onClick={() => setConfirmItemized(false)}><ArrowLeft size={17} /> Avbryt</button></div>
    </div>}
    {draft.pricingMode !== 'itemized' ? <PriceInput label="Grundpris inkl. moms (kr) *" value={draft.baseAmountOre} onChange={(baseAmountOre) => update({ baseAmountOre })} /> : draft.items.filter((i) => i.kind === 'included').map((item) => <div key={item.id} className="mt-4 border-t border-slate-200 pt-3">
      <PriceInput label={`${item.title || 'Arbetsdel'} - delpris inkl. moms (kr) *`} value={item.amountOre} onChange={(amountOre) => update({ items: draft.items.map((i) => i.id === item.id ? { ...i, amountOre } : i) })} />
      {workspace.costingAvailable && <CustomerOfferCostCalculator value={costing[item.id]} customerPrice={item.amountOre}
        onChange={(calculation) => { setCosting((current) => ({ ...current, [item.id]: calculation })); setConfirmed(false) }}
        onApply={(amountOre) => { update({ items: draft.items.map((i) => i.id === item.id ? { ...i, amountOre } : i) }); toast.success('Kundpriset har uppdaterats i utkastet.') }} />}
    </div>)}
  </ProjectEditorRow>
  return (
    <Container className={embedded ? 'gizmo-offer-editor break-words' : 'mx-auto max-w-6xl break-words px-4 pb-16 sm:px-6'}>
      {(!embedded || ['edit', 'contract', 'document', 'offerDocument'].includes(view)) && <header className="border-b border-slate-200 py-6">
        {!embedded && <PendingLink autoPending pendingLabel="Öppnar projektlistan…" icon={<ArrowLeft size={17} />}
          href="/uppdrag"
          onClick={(e) => {
            if ((dirty || planningDirty) && !window.confirm('Lämna osparade ändringar?'))
              e.preventDefault()
          }}
          className="inline-flex items-center gap-2 text-sm text-violet-700"
        >
          Till uppdrag
        </PendingLink>}
        {!embedded && <p className="mt-6 text-sm text-slate-500">
          {actionCase.propertyAddress}
        </p>}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-4">
          <Heading ref={heading} tabIndex={-1} className="scroll-mt-6">
            {({ edit: 'Offert', contract: 'Avtal', planning: 'Val och tillval', payments: 'Betalningsplan', document: 'Granska avtal', offerDocument: 'Granska offert', customer: 'Visa som beställare' })[view]}
          </Heading>
          <p className="text-sm text-slate-500" role="status">
            {busy
              ? 'Arbetar…'
              : dirty || planningDirty
                ? 'Osparade ändringar'
                : workspace.revision
                  ? 'Sparat'
                  : 'Nytt utkast'}
          </p>
        </div>
      </header>}
      {!embedded && <nav
        className="flex gap-2 overflow-x-auto border-b border-slate-200 py-3"
        aria-label="Offert och avtal"
      >
        {[
          ['edit', 'Offert'],
          ['contract', 'Avtal'],
          ['planning', 'Val och tillval'],
          ['payments', 'Betalningsplan'],
          ['document', 'Granska avtal'],
          ['customer', 'Visa som beställare']
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setView(key as typeof view)}
            aria-pressed={view === key}
            className={`${button} shrink-0 ${view === key ? 'bg-violet-50' : 'bg-white'}`}
          >
            {key === 'edit' ? <FilePlus2 size={17} /> : key === 'planning' ? <CalendarClock size={17} /> : key === 'payments' ? <WalletCards size={17} /> : <Eye size={17} />}
            {label}
          </button>
        ))}
      </nav>}
      {legacyChoices.length > 0 && !locked && view !== 'customer' && <section className="my-5 border-l-4 border-amber-500 bg-amber-50 p-4">
        <h2 className="text-base font-semibold">{legacyChoices.length} val behöver skiljas från grundavtalet</h2>
        <p className="mt-2 text-sm">Priser, alternativgrupper och interna kalkyler flyttas till Val och tillval. Grundpriset ändras inte och inget delas med kunden.</p>
        <p className="mt-2 text-sm">Kontrollera sedan inledning och avgränsningar så att grundavtalets omfattning är korrekt.</p>
        <button className={`${button} mt-4 bg-white`} disabled={Boolean(busy) || dirty || planningDirty || !workspace.revision}
          onClick={() => void action('separate_choices', { planningRevision: planning?.revision ?? 0 })}>
          {busy === 'separate_choices' ? <Loader2 size={17} className="animate-spin" /> : <CalendarClock size={17} />}
          Flytta till Val och tillval
        </button>
        {(dirty || planningDirty) && <p className="mt-2 text-sm">Spara ändringarna innan valen flyttas.</p>}
      </section>}
      <div hidden={view !== 'planning'}>
        <CustomerPlanningEditor key={planningReset} caseId={actionCase.id} initial={planning ?? { available: false, revision: 0, items: [], sharedItems: [] }} onDirty={setPlanningDirty} onSaved={setPlanning} />
      </div>
      {view === 'planning' ? null : view === 'payments' ? <section className="py-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-xl">Betalningsplan</h2><p className="mt-2 text-sm text-slate-600">{locked ? 'Avtalad betalningsplan · Låst med grundavtalet' : 'Internt utkast · Delas med grundavtalet, inte när du sparar'}</p></div>
          {!locked && <div className="flex flex-wrap items-center gap-3">
            <span role="status" className="text-sm text-slate-600">{busy ? 'Sparar…' : dirty ? 'Osparade ändringar' : workspace.revision > 0 ? 'Sparat internt' : 'Inte sparat ännu'}</span>
            <button className={`${button} bg-slate-950 text-white`} disabled={Boolean(busy) || (!dirty && workspace.revision > 0) || confirmItemized} onClick={() => void action('save')}>
              {busy === 'save' ? <Loader2 size={17} className="animate-spin" /> : <Save size={17} />} {busy === 'save' ? 'Sparar…' : 'Spara utkast'}
            </button>
          </div>}
        </div>
        {locked ? <>
          <PaymentPlanDocument plan={previewOffer.snapshot.paymentPlan} paymentTerms={previewOffer.snapshot.paymentTerms} />
          <p className="mt-4 text-sm text-slate-600">Version {previewOffer.version}. Ändringar av den avtalade planen kräver en separat överenskommelse och kan inte göras här.</p>
        </> : <>
          <fieldset disabled={Boolean(busy) && busy !== 'save'} className="min-w-0">
            <PaymentPlanEditor plan={draft.paymentPlan} baseAmount={baseAmount} paymentTerms={draft.paymentTerms}
              onChange={(paymentPlan) => update({ paymentPlan })} onTermsChange={(paymentTerms) => update({ paymentTerms })} />
          </fieldset>
          <div className="mt-6 flex flex-wrap gap-3 border-t border-slate-200 pt-5">
            <button className={`${button} bg-white`} onClick={() => setView('document')}><Eye size={17} /> Granska grundavtal</button>
            <button className={button} onClick={() => setView('contract')}><ArrowLeft size={17} /> Till avtal</button>
          </div>
        </>}
      </section> : view === 'customer' ? (
        <ActionCaseCustomerPortal
          key={JSON.stringify([workspace.offers, planning?.sharedItems])}
          portal={portal}
          preview
          previewCaseId={actionCase.id}
        />
      ) : view === 'document' || view === 'offerDocument' ? (
        <>
          {(locked || legacyChoices.length === 0) && <div className="mt-5 bg-white px-6">
            <CustomerOfferDocument
              offer={previewOffer}
              purpose={view === 'offerDocument' ? 'offer' : 'contract'}
              selected={[]}
              readOnly
              fileUrl={(id) =>
                locked ? `/api/action-cases/${actionCase.id}/customer-offers/${previewOffer.id}/files/${id}`
                  : `/api/action-cases/${actionCase.id}/attachments/${id}`
              }
            />
          </div>}
          <div className="py-5 print:hidden">
            <button
              className={`${button} bg-white`}
              onClick={() => setView(view === 'offerDocument' ? 'edit' : 'contract')}
            >
              <ArrowLeft size={17} /> Tillbaka till redigering
            </button>
          </div>
        </>
      ) : (
        <div className="grid gap-8 py-6 lg:grid-cols-[minmax(0,1fr)_280px]">
          <fieldset
            disabled={(Boolean(busy) && busy !== 'save') || locked}
            className="min-w-0 space-y-5"
          >
            <div hidden={contractView} className="space-y-5">
            <ProjectEditorRow title="Offertuppgifter" summary={`${parties.customers.map((row) => row.name).filter(Boolean).join(', ') || actionCase.customerName} · ${draft.validUntil ? `Giltig till ${draft.validUntil}` : 'Giltighetsdatum saknas'}`}
              open={expanded === 'offer-info'} onToggle={() => setExpanded(expanded === 'offer-info' ? null : 'offer-info')}>
            <section className="space-y-4">
              <h2 className="text-lg">
                Offert till {parties.customers.map((row) => row.name).filter(Boolean).join(', ') || actionCase.customerName}
              </h2>
              <p className="break-all text-sm text-slate-600">
                {customer?.email || 'Beställaren saknar e-postadress.'}
              </p>
              <label className="block text-sm font-medium">
                Rubrik *
                <input
                  className={field}
                  value={draft.title}
                  onChange={(e) => update({ title: e.target.value })}
                />
              </label>
              <label className="block text-sm font-medium">
                Inledning
                <textarea
                  className={field}
                  rows={3}
                  value={draft.introduction}
                  onChange={(e) => update({ introduction: e.target.value })}
                />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-medium">
                  Giltig till och med *
                  <input
                    className={field}
                    type="date"
                    value={draft.validUntil}
                    onChange={(e) => update({ validUntil: e.target.value })}
                  />
                </label>
              </div>
            </section>
            </ProjectEditorRow>
            </div>
            <div hidden={!contractView} className="space-y-5">
            <ProjectEditorRow title="Beställare" summary={parties.customers.map((row) => row.name || 'Namn saknas').join(' · ')}
              open={expanded === 'customer'} onToggle={() => setExpanded(expanded === 'customer' ? null : 'customer')}>
              <ContractCustomerRegistry orgId={workspace.customerLink?.organizationId ?? ''} link={workspace.customerLink} parties={parties}
                historical={workspace.offers.length > 0}
                busy={busy === 'bind_customer'} disabled={Boolean(busy) || sourcePending || planningDirty || locked || workspace.offers.length > 0}
                onBind={(binding, requestId) => action('bind_customer', { binding, requestId })} />
              <ContractCustomerEditor value={parties} onChange={(contractParties) => update({ contractParties })} />
            </ProjectEditorRow>
            <ProjectEditorRow title="Entreprenör" summary={parties.contractor.companyName || 'Företagsuppgifter saknas'}
              open={expanded === 'contractor'} onToggle={() => setExpanded(expanded === 'contractor' ? null : 'contractor')}>
              <ContractContractorEditor value={parties.contractor} source={contractorSource}
                onChange={(contractor) => update({ contractParties: { ...parties, contractor } })} />
            </ProjectEditorRow>
            {contractSection('controls', 'Övriga medverkande', ['controls'])}
            <ProjectEditorRow title="Fastigheten" summary={actionCase.propertyAddress || 'Adress saknas'} open={expanded === 'property'} onToggle={() => setExpanded(expanded === 'property' ? null : 'property')}>
              <p className="mb-4 text-sm">{actionCase.propertyAddress}</p>
              <CustomerContractFields value={draft.contractDetails} fieldKeys={['property']} showAdvice={false} inline onChange={(contractDetails) => update({ contractDetails })} />
            </ProjectEditorRow>
            <ProjectEditorRow title="Uppdraget" summary={`${draft.items.filter((item) => item.kind === 'included').length} arbetsdelar · ${money(baseAmount)}`}
              open={expanded === 'scope-summary'} onToggle={() => setExpanded(expanded === 'scope-summary' ? null : 'scope-summary')}>
              {draft.items.filter((item) => item.kind === 'included' || item.kind === 'excluded').map((item) => <div key={item.id} className="border-b border-slate-200 py-3 text-sm">
                <h3 className="font-semibold">{item.title}{item.kind === 'excluded' ? ' · Ingår inte' : ''}</h3>
                <p className="mt-1 whitespace-pre-wrap">{item.scope}</p>
                {([['scopeConditions', 'Förutsättningar'], ['scopeExclusions', 'Ingår inte'], ['scopeAdvice', 'Avrådan']] as const).map(([key, label]) => item[key]?.trim() ? <p key={key} className="mt-2 whitespace-pre-wrap"><strong>{label}: </strong>{item[key]}</p> : null)}
              </div>)}
              <button className={`${button} mt-4`} onClick={() => setView('edit')}><ArrowLeft size={17} /> Redigera omfattning i Offert</button>
            </ProjectEditorRow>
            </div>
            <section hidden={contractView}>
              <h2 className="text-lg">Uppdraget</h2>
              <CustomerOfferSourcePicker sources={actionCase.items} items={draft.items} itemized={draft.pricingMode === 'itemized'} blocked={sourcePending || locked || Boolean(busy)}
                onChange={(items) => { update({ items }); setItemView('included') }} onReviewCountChange={setSourceReviewCount} />
              <div role="tablist" aria-label="Omfattning" className="mt-4 flex flex-wrap gap-2 border-b border-slate-200 pb-3">
                {([['included', 'Grundåtagande'], ['excluded', 'Avgränsningar']] as const).map(([key, title]) => <button key={key} role="tab" aria-selected={itemView === key} className={`${button} ${itemView === key ? 'bg-violet-50' : 'bg-white'}`} onClick={() => setItemView(key)}>{title} ({draft.items.filter((i) => i.kind === key).length})</button>)}
              </div>
              {draft.items.filter((item) => item.kind === itemView).map((item, visibleIndex, visibleItems) => (
                <ProjectEditorRow
                  key={item.id}
                  title={`${visibleIndex + 1}. ${item.title || 'Ny arbetsdel'}`}
                  summary={item.scope.trim() ? 'Omfattning ifylld' : 'Omfattning saknas'}
                  amount={item.kind === 'excluded' ? 'Ingår inte' : draft.pricingMode === 'itemized' ? item.amountOre === null ? 'Pris saknas' : money(item.amountOre) : 'Ingår i grundpriset'}
                  open={expanded === item.id} onToggle={() => setExpanded(expanded === item.id ? null : item.id)}
                >
                  <div className="flex items-start gap-2">
                    <span className="pt-3 text-sm text-slate-500">
                      {visibleIndex + 1}.
                    </span>
                    <label className="min-w-0 flex-1 text-sm">
                      Arbetsrubrik *
                      <input
                        className={field}
                        value={item.title}
                        onChange={(e) =>
                          update({
                            items: draft.items.map((i) =>
                              i.id === item.id
                                ? { ...i, title: e.target.value }
                                : i
                            )
                          })
                        }
                      />
                    </label>
                    <div className="mt-6 flex gap-1">
                      {[-1, 1].map((delta) => (
                        <button
                          key={delta}
                          title={delta === -1 ? 'Flytta upp' : 'Flytta ned'}
                          aria-label={`${delta === -1 ? 'Flytta upp' : 'Flytta ned'} ${item.title}`}
                          disabled={
                            delta === -1
                              ? visibleIndex === 0
                              : visibleIndex === visibleItems.length - 1
                          }
                          className="inline-flex h-11 w-9 items-center justify-center border border-slate-200 disabled:opacity-30"
                          onClick={() => move(draft.items.findIndex((i) => i.id === item.id), delta)}
                        >
                          {delta === -1 ? (
                            <ArrowUp size={16} />
                          ) : (
                            <ArrowDown size={16} />
                          )}
                        </button>
                      ))}
                      <button
                        title="Ta bort arbete"
                        aria-label={`Ta bort ${item.title}`}
                        className="inline-flex h-11 w-9 items-center justify-center text-rose-700"
                        onClick={() => setRemoveId(item.id)}
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>
                  </div>
                  {removeId === item.id && <div role="alert" className="mt-3 border-l-4 border-amber-500 bg-amber-50 p-3 text-sm"><p>Ta bort {item.title || 'arbetet'} ur offertutkastet?</p><div className="mt-3 flex flex-wrap gap-2"><button className={button} onClick={() => { update({ items: draft.items.filter((i) => i.id !== item.id) }); setRemoveId(null) }}><Trash2 size={16} /> Ta bort från utkast</button><button className={button} onClick={() => setRemoveId(null)}>Avbryt</button></div></div>}
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="text-sm">
                      Ingår som
                      <select
                        className={field}
                        value={item.kind}
                        onChange={(e) => {
                          setItemView(e.target.value as typeof itemView)
                          update({
                            items: draft.items.map((i) =>
                              i.id === item.id
                                ? {
                                    ...i,
                                    kind: e.target.value as typeof i.kind,
                                    amountOre: null,
                                    optionGroup: null
                                  }
                                : i
                            )
                          })
                        }}
                      >
                        <option value="included">Grundåtagande</option>
                        <option value="excluded">Relevant avgränsning</option>
                      </select>
                    </label>
                  </div>
                  <label className="mt-3 block text-sm">
                    Omfattning och avgränsningar *
                    <textarea
                      className={field}
                      rows={3}
                      value={item.scope}
                      onChange={(e) =>
                        update({
                          items: draft.items.map((i) =>
                            i.id === item.id
                              ? { ...i, scope: e.target.value }
                              : i
                          )
                        })
                      }
                    />
                  </label>
                  {([['scopeConditions', 'Förutsättningar'], ['scopeExclusions', 'Ingår inte'], ['scopeAdvice', 'Avrådan']] as const).map(([key, label]) => item[key] !== undefined && (
                    <label key={key} className="mt-3 block text-sm">
                      {label} (valfritt)
                      <textarea className={field} rows={3} maxLength={6000} value={item[key]} onChange={(e) => update({ items: draft.items.map((i) => i.id === item.id ? { ...i, [key]: e.target.value } : i) })} />
                    </label>
                  ))}
                </ProjectEditorRow>
              ))}
              <button
                className={`${button} mt-5`}
                onClick={() => {
                  const id = crypto.randomUUID()
                  setExpanded(id)
                  update({
                    items: [
                      ...draft.items,
                      {
                        id,
                        title: '',
                        scope: '',
                        kind: itemView,
                        amountOre: null
                      }
                    ]
                  })
                }}
              >
                <Plus size={17} /> {itemView === 'included' ? 'Lägg till arbete' : 'Lägg till avgränsning'}
              </button>
            </section>
            <div hidden={contractView}>{priceSection}</div>
            <div hidden={!contractView} className="space-y-5">
            <ProjectEditorRow title="Avtalshandlingar och bilagor" summary={`${draft.attachmentIds.length} valda · ${draft.termsAttachmentId ? 'Avtalshandling vald' : 'Avtalshandling saknas'}`}
              open={expanded === 'files'} onToggle={() => setExpanded(expanded === 'files' ? null : 'files')}>
            <section>
              <label className="mb-4 block text-sm">Avtalsgrund
                <select className={field} value={draft.contractForm} onChange={(e) => update({ contractForm: e.target.value as CustomerOfferDraft['contractForm'] })}>
                  <option value="abs18">ABS 18 · Privatperson, småhus/tillbyggnad</option><option value="custom">Särskilda villkor</option>
                </select>
              </label>
              <CustomerContractFields value={draft.contractDetails} fieldKeys={['documents']} showAdvice={false} inline onChange={(contractDetails) => update({ contractDetails })} />
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {files.map((f) => (
                  <label
                    key={f.id}
                    className="flex items-start gap-3 border-b border-slate-200 py-3"
                  >
                    <input
                      type="checkbox"
                      className="mt-1 h-5 w-5 shrink-0"
                      checked={draft.attachmentIds.includes(f.id)}
                      onChange={(e) =>
                        update({
                          attachmentIds: e.target.checked
                            ? [...draft.attachmentIds, f.id]
                            : draft.attachmentIds.filter((id) => id !== f.id),
                          termsAttachmentId:
                            !e.target.checked &&
                            draft.termsAttachmentId === f.id
                              ? null
                              : draft.termsAttachmentId
                        })
                      }
                    />
                    <span className="min-w-0 flex-1">
                      {f.type === 'image' && (
                        <Image
                          unoptimized
                          width={480}
                          height={360}
                          src={`/api/action-cases/${actionCase.id}/attachments/${f.id}`}
                          alt=""
                          className="mb-2 aspect-[4/3] w-full rounded-md object-cover"
                        />
                      )}
                      <span className="block break-words text-sm">
                        {f.title || f.fileName}
                      </span>
                      <a
                        className="mt-1 inline-block text-sm text-violet-700"
                        href={`/api/action-cases/${actionCase.id}/attachments/${f.id}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Öppna
                      </a>
                    </span>
                  </label>
                ))}
              </div>
              {!files.length && (
                <p className="mt-3 text-sm text-slate-500">
                  Inga filer i projektets bibliotek.
                </p>
              )}
              <label className="mt-4 block text-sm">
                Avtalshandling (PDF){draft.contractForm === 'abs18' ? ' *' : ''}
                <select
                  className={field}
                  value={draft.termsAttachmentId ?? ''}
                  onChange={(e) =>
                    update({ termsAttachmentId: e.target.value || null })
                  }
                >
                  <option value="">Välj bland markerade bilagor</option>
                  {files
                    .filter(
                      (f) =>
                        draft.attachmentIds.includes(f.id) &&
                        f.contentType === 'application/pdf'
                    )
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.fileName}
                      </option>
                    ))}
                </select>
              </label>
            </section>
            </ProjectEditorRow>
            {contractSection('customer-work', 'Beställarens arbeten och samordning', ['customerWork'])}
            {contractSection('work-environment', 'Arbetsmiljö', ['workEnvironment'])}
            {contractSection('advice', 'Avrådande', [], true)}
            <ProjectEditorRow title="Priset" summary={`${draft.pricingMode === 'itemized' ? 'Fast pris per arbetsdel' : 'Fast klumpsumma'} · ${money(baseAmount)}`}
              open={expanded === 'contract-price'} onToggle={() => setExpanded(expanded === 'contract-price' ? null : 'contract-price')}>
              <p className="text-lg font-semibold">{money(baseAmount)} inklusive moms</p>
              <button className={`${button} mt-3`} onClick={() => setView('edit')}><ArrowLeft size={17} /> Redigera pris i Offert</button>
            </ProjectEditorRow>
            {contractSection('changes', 'Ändringar och tilläggsarbeten', ['changes'])}
            <ProjectEditorRow title="Tid för betalning" summary={`${draft.paymentPlan?.installments.length ?? 0} delbetalningar · ${draft.paymentTerms.trim() ? 'Villkor ifyllda' : 'Villkor saknas'}`}
              open={expanded === 'payment'} onToggle={() => setExpanded(expanded === 'payment' ? null : 'payment')}>
              <p className="whitespace-pre-wrap text-sm">{draft.paymentTerms || 'Betalningsvillkor saknas.'}</p>
              <button className={`${button} mt-3`} onClick={() => setView('payments')}><WalletCards size={17} /> Öppna betalningsplan</button>
            </ProjectEditorRow>
            </div>
            <ProjectEditorRow title="Tid för arbetenas påbörjande och avslutande" summary={draft.schedule.trim() ? 'Tider ifyllda' : 'Tider saknas'}
              open={expanded === 'schedule'} onToggle={() => setExpanded(expanded === 'schedule' ? null : 'schedule')}>
              <label className="block text-sm">Tider och förutsättningar *<textarea className={field} rows={3} value={draft.schedule} onChange={(e) => update({ schedule: e.target.value })} /></label>
            </ProjectEditorRow>
            {contractSection('delay', 'Vite vid försening', ['delay'])}
            {contractSection('inspection', 'Besiktning', ['inspection'])}
            {contractSection('insurance', 'Försäkringar och säkerhet', ['insurance', 'completionProtection', 'security'])}
            <ProjectEditorRow title="Övrigt" summary={draft.terms.trim() ? 'Villkor ifyllda' : 'Villkor saknas'} open={expanded === 'terms'} onToggle={() => setExpanded(expanded === 'terms' ? null : 'terms')}>
              <label className="block text-sm">Villkor och hänvisning till avtalshandling *<textarea className={field} rows={5} value={draft.terms} onChange={(e) => update({ terms: e.target.value })} /></label>
            </ProjectEditorRow>
          </fieldset>
          <aside className="min-w-0">
            <div className="lg:sticky lg:top-6">
              <h2 className="text-lg">{contractView ? 'Avtalsstatus' : 'Offertsammanställning'}</h2>
              <p className="mt-3 text-2xl font-semibold">
                {money(baseAmount)}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                {draft.pricingMode === 'itemized'
                  ? 'Summa grundåtagande inklusive moms'
                  : 'Grundpris inklusive moms'}
              </p>
              {draft.pricingMode === 'itemized' && baseAmount === null && (
                <p className="mt-2 text-sm text-amber-700">
                  {missingPriceCount} {missingPriceCount === 1 ? 'arbetsdel saknar' : 'arbetsdelar saknar'} pris
                </p>
              )}
              {locked ? (
                <p className="mt-5 border-l-4 border-emerald-600 bg-emerald-50 p-3 text-sm">
                  Avtalet är godkänt. Denna version är låst.
                </p>
              ) : (
                <>
                  <button
                    disabled={
                      Boolean(busy) || (!dirty && workspace.revision > 0)
                      || confirmItemized
                    }
                    className={`${button} mt-5 w-full bg-white`}
                    onClick={() => void action('save')}
                  >
                    {busy === 'save' ? (
                      <Loader2 size={17} className="animate-spin" />
                    ) : (
                      <Save size={17} />
                    )}
                    Spara utkast
                  </button>
                  <button
                    className={`${button} mt-3 w-full bg-white`}
                    onClick={() => setView(contractView ? 'document' : 'offerDocument')}
                  >
                    <Eye size={17} />
                    {contractView ? 'Granska avtal' : 'Granska offert'}
                  </button>
                  {!contractView && <button className={`${button} mt-3 w-full bg-slate-950 text-white`} onClick={() => { setExpanded('customer'); setView('contract') }}>Gå vidare till avtal <ArrowRight size={17} /></button>}
                  {contractView && <>
                  {issues.length > 0 && (
                    <details className="mt-5 text-sm">
                      <summary className="cursor-pointer font-semibold text-amber-700">
                        {issues.length} {issues.length === 1 ? 'sak' : 'saker'} kvar inför utskick
                      </summary>
                      <ul className="mt-3 space-y-2 text-slate-600">
                        {issues.map((i) => (
                          <li key={i}>{i}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                  <label className="mt-5 flex items-start gap-2 text-sm leading-6">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                      className="mt-1 h-5 w-5 shrink-0"
                      disabled={Boolean(busy)}
                    />
                    <span>
                      Jag har granskat avtalet, mottagaren och
                      avtalshandlingarna. Omfattning, priser och villkor är
                      klara för utskick.
                    </span>
                  </label>
                  <button
                    disabled={
                      Boolean(busy) ||
                      confirmItemized ||
                      dirty ||
                      !workspace.revision ||
                      issues.length > 0 ||
                      sourceReviewCount < 0 ||
                      !confirmed ||
                      !customer?.email
                    }
                    onClick={() => void action('publish')}
                    className={`${button} mt-4 w-full bg-slate-950 text-white`}
                  >
                    {busy === 'publish' ? (
                      <Loader2 className="animate-spin" size={17} />
                    ) : (
                      <Send size={17} />
                    )}
                    Skicka avtal
                  </button>
                  <p className="mt-3 break-all text-sm text-slate-500">Mottagare: {customer?.email || 'Saknas'}</p>
                  </>}
                </>
              )}
              {contractView && <section className="mt-7 border-t border-slate-200 pt-5">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">Publicerade versioner</h3>
                  <button
                    className="inline-flex h-11 w-11 items-center justify-center"
                    aria-label="Uppdatera avtalsstatus"
                    title="Uppdatera avtalsstatus"
                    disabled={Boolean(busy)}
                    onClick={() => {
                      if (
                        !dirty ||
                        window.confirm(
                          'Hämta den sparade versionen? Dina osparade ändringar ersätts.'
                        )
                      )
                        void action('refresh')
                    }}
                  >
                    <RefreshCw
                      size={17}
                      className={busy === 'refresh' ? 'animate-spin' : ''}
                    />
                  </button>
                </div>
                {workspace.offers.length === 0 && (
                  <p className="mt-2 text-sm text-slate-500">
                    Inget avtal publicerat.
                  </p>
                )}
                {workspace.offers.map((o) => (
                  <div key={o.id} className="border-b border-slate-200 py-4">
                    <strong className="text-sm">
                      Version {o.version} ·{' '}
                      {
                        {
                          published: 'Publicerad',
                          accepted: 'Godkänd',
                          withdrawn: 'Återkallad',
                          superseded: 'Ersatt'
                        }[o.status]
                      }
                    </strong>
                    <p className="mt-1 text-sm text-slate-500">
                      {o.sentAt ? 'Mejl skickat' : 'Utskick inte bekräftat'}
                    </p>
                    {o.status === 'published' && !o.sentAt && (
                      <button
                        className={`${button} mt-2 w-full`}
                        disabled={Boolean(busy) || dirty}
                        onClick={() => void action('send', { id: o.id })}
                      >
                        <Send size={16} />
                        Försök skicka igen
                      </button>
                    )}
                    {o.status === 'published' && (
                      <button
                        className="mt-2 text-sm text-rose-700"
                        disabled={Boolean(busy) || dirty}
                        onClick={() => {
                          if (
                            window.confirm(
                              'Återkalla avtalet? Kunden kan inte längre godkänna det.'
                            )
                          )
                            void action('withdraw', { id: o.id })
                        }}
                      >
                        Återkalla avtal
                      </button>
                    )}
                    {o.status === 'accepted' && (
                      <p className="mt-2 flex gap-2 text-sm text-emerald-700">
                        <Check size={16} />
                        {money(o.acceptedTotalOre)}
                      </p>
                    )}
                  </div>
                ))}
              </section>}
            </div>
          </aside>
        </div>
      )}
    </Container>
  )
}
