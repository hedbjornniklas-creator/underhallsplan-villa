'use client'

import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowLeft,
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
import { emptyContractDetails } from '@/lib/action-cases/customerContract'
import { PaymentPlanDocument, PaymentPlanEditor } from './CustomerPaymentPlan'

const field =
  'mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-50'
const button =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-50'
export default function CustomerOfferEditor({
  actionCase,
  initial,
  issuerName,
  replyEmail
}: {
  actionCase: ActionCaseView
  initial: CustomerOfferWorkspace
  issuerName: string
  replyEmail: string
}) {
  const [workspace, setWorkspace] = useState(initial),
    [draft, setDraft] = useState(() => initial.revision === 0
      ? { ...initial.draft, contractDetails: initial.draft.contractDetails ?? emptyContractDetails() }
      : initial.draft)
  const [costing, setCosting] = useState<CustomerOfferCosting>(initial.costing ?? {})
  const [view, setView] = useState<'edit' | 'document' | 'customer' | 'planning' | 'payments'>('edit')
  const [itemView, setItemView] = useState<'included' | 'excluded'>('included')
  const [removeId, setRemoveId] = useState<string | null>(null)
  const [planningDirty, setPlanningDirty] = useState(false)
  const [planning, setPlanning] = useState(initial.planning)
  const [planningReset, setPlanningReset] = useState(0)
  const heading = useRef<HTMLHeadingElement>(null)
  const previousView = useRef(view)
  const [busy, setBusy] = useState(''),
    running = useRef(false),
    toast = useToast()
  const [confirmed, setConfirmed] = useState(false)
  const [confirmItemized, setConfirmItemized] = useState(false)
  const customer = actionCase.participants.find((p) => p.role === 'customer')
  const dirty = JSON.stringify(draft) !== JSON.stringify(workspace.draft) ||
    JSON.stringify(costing) !== JSON.stringify(workspace.costing ?? {})
  const locked = workspace.offers.some((o) => o.status === 'accepted')
  const issues = [
    ...offerPublishIssues(draft),
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
    if (previousView.current === view) return
    previousView.current = view
    heading.current?.focus({ preventScroll: true })
    heading.current?.scrollIntoView({ block: 'start', behavior: 'instant' })
  }, [view])
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
    if (running.current) return
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
      setWorkspace(data)
      setDraft(data.draft)
      setCosting(data.costing ?? {})
      if (!planningDirty) {
        setPlanning(data.planning)
        setPlanningReset((value) => value + 1)
      }
      if (operation === 'separate_choices') setView('planning')
      setConfirmed(false)
      toast.success(
        operation === 'publish' || operation === 'send'
          ? 'Offerten har skickats.'
          : operation === 'withdraw'
            ? 'Offerten återkallades.'
            : operation === 'refresh'
              ? 'Statusen uppdaterades.'
              : operation === 'separate_choices'
                ? 'Valen har flyttats. Grundpriset är oförändrat. Inget har delats eller beställts.'
                : 'Offertutkastet sparades.'
      )
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
  return (
    <main className="mx-auto max-w-6xl break-words px-4 pb-16 sm:px-6">
      <header className="border-b border-slate-200 py-6">
        <a
          href="/uppdrag"
          onClick={(e) => {
            if ((dirty || planningDirty) && !window.confirm('Lämna osparade ändringar?'))
              e.preventDefault()
          }}
          className="inline-flex items-center gap-2 text-sm text-violet-700"
        >
          <ArrowLeft size={17} /> Till uppdrag
        </a>
        <p className="mt-6 text-sm text-slate-500">
          {actionCase.propertyAddress}
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-4">
          <h1 ref={heading} tabIndex={-1} className="scroll-mt-6">
            Offert och avtal
          </h1>
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
      </header>
      <nav
        className="flex gap-2 overflow-x-auto border-b border-slate-200 py-3"
        aria-label="Offert och avtal"
      >
        {[
          ['edit', 'Grundavtal'],
          ['planning', 'Val och tillval'],
          ['payments', 'Betalningsplan'],
          ['document', 'Granska grundavtal'],
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
      </nav>
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
          {!locked && <button className={`${button} bg-slate-950 text-white`} disabled={Boolean(busy) || (!dirty && workspace.revision > 0) || confirmItemized} onClick={() => void action('save')}>
            {busy === 'save' ? <Loader2 size={17} className="animate-spin" /> : <Save size={17} />} Spara utkast
          </button>}
        </div>
        {locked ? <>
          <PaymentPlanDocument plan={previewOffer.snapshot.paymentPlan} paymentTerms={previewOffer.snapshot.paymentTerms} />
          <p className="mt-4 text-sm text-slate-600">Version {previewOffer.version}. Ändringar av den avtalade planen kräver en separat överenskommelse och kan inte göras här.</p>
        </> : <>
          <fieldset disabled={Boolean(busy)} className="min-w-0">
            <PaymentPlanEditor plan={draft.paymentPlan} baseAmount={baseAmount} paymentTerms={draft.paymentTerms}
              onChange={(paymentPlan) => update({ paymentPlan })} onTermsChange={(paymentTerms) => update({ paymentTerms })} />
          </fieldset>
          <div className="mt-6 flex flex-wrap gap-3 border-t border-slate-200 pt-5">
            <button className={`${button} bg-white`} onClick={() => setView('document')}><Eye size={17} /> Granska grundavtal</button>
            <button className={button} onClick={() => setView('edit')}><ArrowLeft size={17} /> Till grundavtal</button>
          </div>
        </>}
      </section> : view === 'customer' ? (
        <ActionCaseCustomerPortal
          key={JSON.stringify([workspace.offers, planning?.sharedItems])}
          portal={portal}
          preview
          previewCaseId={actionCase.id}
        />
      ) : view === 'document' ? (
        <>
          {(locked || legacyChoices.length === 0) && <div className="mt-5 bg-white px-6">
            <CustomerOfferDocument
              offer={previewOffer}
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
              onClick={() => setView('edit')}
            >
              <ArrowLeft size={17} /> Tillbaka till redigering
            </button>
          </div>
        </>
      ) : (
        <div className="grid gap-8 py-6 lg:grid-cols-[minmax(0,1fr)_280px]">
          <fieldset
            disabled={Boolean(busy) || locked}
            className="min-w-0 space-y-7"
          >
            <section className="space-y-4">
              <h2 className="text-lg">
                Offert till {customer?.name ?? actionCase.customerName}
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
                  Prissättning av grundåtagandet
                  <select
                    className={field}
                    value={draft.pricingMode ?? 'total'}
                    onChange={(e) => {
                      const pricingMode = e.target
                        .value as CustomerOfferDraft['pricingMode']
                      if (
                        pricingMode === 'itemized' &&
                        draft.baseAmountOre !== null
                      ) {
                        setConfirmItemized(true)
                        return
                      }
                      setConfirmItemized(false)
                      update({ pricingMode, baseAmountOre: baseAmount })
                    }}
                  >
                    <option value="total">Fast klumpsumma</option>
                    <option value="itemized">Fast pris per arbetsdel</option>
                  </select>
                </label>
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
              {confirmItemized && (
                <div role="alert" className="border-l-4 border-amber-500 bg-amber-50 p-4 text-sm">
                  <p>
                    Klumpsumman {money(draft.baseAmountOre)} ersätts av summan av
                    arbetsdelarnas priser. Beloppet fördelas inte automatiskt.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button className={`${button} bg-white`} onClick={() => {
                      update({ pricingMode: 'itemized' })
                      setConfirmItemized(false)
                    }}><Check size={17} /> Byt till delpriser</button>
                    <button className={button} onClick={() => setConfirmItemized(false)}>
                      <ArrowLeft size={17} /> Avbryt
                    </button>
                  </div>
                </div>
              )}
              {draft.pricingMode !== 'itemized' && (
                <PriceInput
                  label="Grundpris inkl. moms (kr) *"
                  value={draft.baseAmountOre}
                  onChange={(baseAmountOre) => update({ baseAmountOre })}
                />
              )}
            </section>
            <section className="border-t border-slate-200 pt-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg">Avtalets omfattning</h2>
                <button
                  className={button}
                  onClick={() => {
                    setItemView('included')
                    update({
                      items: [
                        ...draft.items,
                        ...actionCase.items
                          .filter(
                            (i) => !draft.items.some((d) => d.id === i.id)
                          )
                          .map((i) => ({
                            id: i.id,
                            title: i.title,
                            scope: i.scope ?? '',
                            kind: 'included' as const,
                            amountOre: null
                          }))
                      ]
                    })
                  }}
                >
                  <Plus size={17} /> Hämta från arbeten
                </button>
              </div>
              <div role="tablist" aria-label="Omfattning" className="mt-4 flex flex-wrap gap-2 border-b border-slate-200 pb-3">
                {([['included', 'Grundåtagande'], ['excluded', 'Avgränsningar']] as const).map(([key, title]) => <button key={key} role="tab" aria-selected={itemView === key} className={`${button} ${itemView === key ? 'bg-violet-50' : 'bg-white'}`} onClick={() => setItemView(key)}>{title} ({draft.items.filter((i) => i.kind === key).length})</button>)}
              </div>
              {draft.items.filter((item) => item.kind === itemView).map((item, visibleIndex, visibleItems) => (
                <div
                  key={item.id}
                  className="mt-5 border-t border-slate-200 pt-5"
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
                    {(item.kind === 'included' && draft.pricingMode === 'itemized') && (
                      <PriceInput
                        label="Delpris inkl. moms (kr) *"
                        value={item.amountOre}
                        onChange={(amountOre) =>
                          update({
                            items: draft.items.map((i) =>
                              i.id === item.id ? { ...i, amountOre } : i
                            )
                          })
                        }
                      />
                    )}
                  </div>
                  {workspace.costingAvailable && item.kind === 'included' && draft.pricingMode === 'itemized' && (
                    <CustomerOfferCostCalculator
                      value={costing[item.id]}
                      customerPrice={item.amountOre}
                      onChange={(calculation) => {
                        setCosting((current) => ({ ...current, [item.id]: calculation }))
                        setConfirmed(false)
                      }}
                      onApply={(amountOre) => {
                        update({ items: draft.items.map((i) => i.id === item.id ? { ...i, amountOre } : i) })
                        toast.success('Kundpriset har uppdaterats i utkastet.')
                      }}
                    />
                  )}
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
                </div>
              ))}
              <button
                className={`${button} mt-5`}
                onClick={() =>
                  update({
                    items: [
                      ...draft.items,
                      {
                        id: crypto.randomUUID(),
                        title: '',
                        scope: '',
                        kind: itemView,
                        amountOre: null
                      }
                    ]
                  })
                }
              >
                <Plus size={17} /> {itemView === 'included' ? 'Lägg till arbete' : 'Lägg till avgränsning'}
              </button>
            </section>
            <CustomerContractFields value={draft.contractDetails} onChange={(contractDetails) => update({ contractDetails })} />
            <section className="space-y-4 border-t border-slate-200 pt-6">
              <h2 className="text-lg">Tider och villkor</h2>
              <label className="block text-sm">
                Avtalsgrund
                <select
                  className={field}
                  value={draft.contractForm}
                  onChange={(e) =>
                    update({
                      contractForm: e.target
                        .value as CustomerOfferDraft['contractForm']
                    })
                  }
                >
                  <option value="abs18">
                    ABS 18 · Privatperson, småhus/tillbyggnad
                  </option>
                  <option value="custom">Särskilda villkor</option>
                </select>
              </label>
              <label className="block text-sm">
                Tider och förutsättningar *
                <textarea
                  className={field}
                  rows={3}
                  value={draft.schedule}
                  onChange={(e) => update({ schedule: e.target.value })}
                />
              </label>
              <div className="border-y border-slate-200 py-4 text-sm">
                <h3 className="font-semibold">Betalning</h3>
                <p className="mt-2 whitespace-pre-wrap">{draft.paymentTerms || 'Betalningsvillkor saknas.'}</p>
                <button className={`${button} mt-3`} onClick={() => setView('payments')}><WalletCards size={17} /> Öppna betalningsplan</button>
              </div>
              <label className="block text-sm">
                Villkor och hänvisning till avtalshandling *
                <textarea
                  className={field}
                  rows={5}
                  value={draft.terms}
                  onChange={(e) => update({ terms: e.target.value })}
                />
              </label>
            </section>
            <section className="border-t border-slate-200 pt-6">
              <h2 className="text-lg">Offertbilagor</h2>
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
          </fieldset>
          <aside className="min-w-0">
            <div className="lg:sticky lg:top-6">
              <h2 className="text-lg">Offertstatus</h2>
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
                    onClick={() => setView('document')}
                  >
                    <Eye size={17} />
                    Granska offertutkast
                  </button>
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
                      Jag har granskat kundofferten, mottagaren och
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
                    Skicka offert
                  </button>
                </>
              )}
              <section className="mt-7 border-t border-slate-200 pt-5">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">Publicerade versioner</h3>
                  <button
                    className="inline-flex h-11 w-11 items-center justify-center"
                    aria-label="Uppdatera offertstatus"
                    title="Uppdatera offertstatus"
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
                    Ingen offert publicerad.
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
                              'Återkalla offerten? Kunden kan inte längre godkänna den.'
                            )
                          )
                            void action('withdraw', { id: o.id })
                        }}
                      >
                        Återkalla offert
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
              </section>
            </div>
          </aside>
        </div>
      )}
    </main>
  )
}
