'use client'

import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  Eye,
  FilePlus2,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Send,
  Trash2
} from 'lucide-react'
import type {
  ActionCaseView,
  ActionCasePortal
} from '@/lib/action-cases/contracts'
import {
  money,
  offerPublishIssues,
  parseKronor,
  type CustomerOffer,
  type CustomerOfferDraft,
  type CustomerOfferSnapshot,
  type CustomerOfferWorkspace
} from '@/lib/action-cases/customerOffers'
import { useToast } from '@/components/ui/AppToastProvider'
import CustomerOfferDocument from './CustomerOfferDocument'
import ActionCaseCustomerPortal from './ActionCaseCustomerPortal'

const field =
  'mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-50'
const button =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-50'
function PriceInput({
  value,
  onChange,
  label,
  disabled
}: {
  value: number | null
  onChange: (v: number | null) => void
  label: string
  disabled?: boolean
}) {
  const formatted =
    value === null
      ? ''
      : (value % 100 === 0
          ? String(value / 100)
          : (value / 100).toFixed(2)
        ).replace('.', ',')
  const [raw, setRaw] = useState<string | null>(null)
  return (
    <label className="block text-sm font-medium">
      {label}
      <input
        className={field}
        aria-label={label}
        type="text"
        inputMode="decimal"
        disabled={disabled}
        value={raw ?? formatted}
        onFocus={() => setRaw(formatted)}
        onBlur={() => setRaw(null)}
        onChange={(e) => {
          const next = e.target.value.replace(/\s/g, '')
          if (!/^(\d+([,.]\d{0,2})?)?$/.test(next)) return
          try {
            const amount = parseKronor(next.replace(/[,.]$/, ''))
            setRaw(next)
            onChange(amount)
          } catch {
            /* Keep the previous value outside the supported amount range. */
          }
        }}
      />
    </label>
  )
}
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
    [draft, setDraft] = useState(initial.draft)
  const [view, setView] = useState<'edit' | 'document' | 'customer'>('edit')
  const heading = useRef<HTMLHeadingElement>(null)
  const previousView = useRef(view)
  const [busy, setBusy] = useState(''),
    running = useRef(false),
    toast = useToast()
  const [confirmed, setConfirmed] = useState(false),
    [selected, setSelected] = useState<string[]>([])
  const customer = actionCase.participants.find((p) => p.role === 'customer')
  const dirty = JSON.stringify(draft) !== JSON.stringify(workspace.draft)
  const locked = workspace.offers.some((o) => o.status === 'accepted')
  const issues = [
    ...offerPublishIssues(draft),
    ...(!customer?.email?.trim()
      ? ['Ange beställarens e-postadress i uppdraget.']
      : [])
  ]
  const files = actionCase.attachments.filter((f) => !f.isQuoteDocument)
  const update = (patch: Partial<CustomerOfferDraft>) => {
    setDraft((d) => ({ ...d, ...patch }))
    setConfirmed(false)
  }
  useEffect(() => {
    if (previousView.current === view) return
    previousView.current = view
    heading.current?.focus({ preventScroll: true })
    heading.current?.scrollIntoView({ block: 'start', behavior: 'instant' })
  }, [view])
  useEffect(() => {
    if (!dirty) return
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', prevent)
    return () => window.removeEventListener('beforeunload', prevent)
  }, [dirty])
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
      setConfirmed(false)
      toast.success(
        operation === 'publish' || operation === 'send'
          ? 'Offerten har skickats.'
          : operation === 'withdraw'
            ? 'Offerten återkallades.'
            : operation === 'refresh'
              ? 'Statusen uppdaterades.'
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
    const items = [...draft.items],
      other = index + delta
    if (other < 0 || other >= items.length) return
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
    customerOffers: { enabled: true, offers: workspace.offers },
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
            if (dirty && !window.confirm('Lämna osparade ändringar?'))
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
            Kundvy och offert
          </h1>
          <p className="text-sm text-slate-500" role="status">
            {busy
              ? 'Arbetar…'
              : dirty
                ? 'Osparade ändringar'
                : workspace.revision
                  ? 'Sparat'
                  : 'Nytt utkast'}
          </p>
        </div>
      </header>
      <nav
        className="flex gap-2 overflow-x-auto border-b border-slate-200 py-3"
        aria-label="Kundvy och offert"
      >
        {[
          ['edit', 'Redigera offert'],
          ['document', 'Granska offertutkast'],
          ['customer', 'Kundens startsida']
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setView(key as typeof view)}
            aria-pressed={view === key}
            className={`${button} shrink-0 ${view === key ? 'bg-violet-50' : 'bg-white'}`}
          >
            {key === 'edit' ? <FilePlus2 size={17} /> : <Eye size={17} />}
            {label}
          </button>
        ))}
      </nav>
      {view === 'customer' ? (
        <ActionCaseCustomerPortal
          key={JSON.stringify(workspace.offers)}
          portal={portal}
          preview
          previewCaseId={actionCase.id}
        />
      ) : view === 'document' ? (
        <>
          <div className="mt-5 bg-white px-6">
            <CustomerOfferDocument
              offer={draftOffer}
              selected={selected}
              onSelect={setSelected}
              fileUrl={(id) =>
                `/api/action-cases/${actionCase.id}/attachments/${id}`
              }
            />
          </div>
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
                <PriceInput
                  label="Grundpris inkl. moms (kr) *"
                  value={draft.baseAmountOre}
                  onChange={(baseAmountOre) => update({ baseAmountOre })}
                />
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
            <section className="border-t border-slate-200 pt-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg">Omfattning och tillval</h2>
                <button
                  className={button}
                  onClick={() =>
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
                  }
                >
                  <Plus size={17} /> Hämta från arbeten
                </button>
              </div>
              {draft.items.map((item, index) => (
                <div
                  key={item.id}
                  className="mt-5 border-t border-slate-200 pt-5"
                >
                  <div className="flex items-start gap-2">
                    <span className="pt-3 text-sm text-slate-500">
                      {index + 1}.
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
                              ? index === 0
                              : index === draft.items.length - 1
                          }
                          className="inline-flex h-11 w-9 items-center justify-center border border-slate-200 disabled:opacity-30"
                          onClick={() => move(index, delta)}
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
                        onClick={() => {
                          if (
                            window.confirm('Ta bort arbetet ur offertutkastet?')
                          )
                            update({
                              items: draft.items.filter((i) => i.id !== item.id)
                            })
                        }}
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="text-sm">
                      Ingår som
                      <select
                        className={field}
                        value={item.kind}
                        onChange={(e) =>
                          update({
                            items: draft.items.map((i) =>
                              i.id === item.id
                                ? {
                                    ...i,
                                    kind: e.target.value as typeof i.kind,
                                    amountOre: null
                                  }
                                : i
                            )
                          })
                        }
                      >
                        <option value="included">Grundåtagande</option>
                        <option value="option">Tillval</option>
                        <option value="excluded">Utanför vårt åtagande</option>
                      </select>
                    </label>
                    {item.kind === 'option' && (
                      <PriceInput
                        label="Tillvalspris inkl. moms (kr) *"
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
                        kind: 'included',
                        amountOre: null
                      }
                    ]
                  })
                }
              >
                <Plus size={17} /> Lägg till arbete
              </button>
            </section>
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
              <label className="block text-sm">
                Betalningsvillkor *
                <textarea
                  className={field}
                  rows={3}
                  value={draft.paymentTerms}
                  onChange={(e) => update({ paymentTerms: e.target.value })}
                />
              </label>
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
                {money(draft.baseAmountOre)}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                Grundpris inklusive moms
              </p>
              {locked ? (
                <p className="mt-5 border-l-4 border-emerald-600 bg-emerald-50 p-3 text-sm">
                  Avtalet är godkänt. Denna version är låst.
                </p>
              ) : (
                <>
                  <button
                    disabled={
                      Boolean(busy) || (!dirty && workspace.revision > 0)
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
                        {issues.length} saker kvar inför utskick
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
