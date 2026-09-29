'use client'

import Image from 'next/image'
import { useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  ListChecks,
  FileText,
  FolderOpen,
  Loader2,
  Mail,
  MapPin,
  Printer,
  ShieldCheck
} from 'lucide-react'
import { useToast } from '@/components/ui/AppToastProvider'
import type { ActionCasePortal } from '@/lib/action-cases/contracts'
import {
  customerOfferTotal,
  money,
  type CustomerOffer
} from '@/lib/action-cases/customerOffers'
import CustomerOfferDocument from './CustomerOfferDocument'
import { CustomerPlannedItems } from './CustomerPlanningEditor'

const button =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-50'
export default function ActionCaseCustomerPortal({
  portal,
  token,
  preview = false,
  previewCaseId
}: {
  portal: ActionCasePortal
  token?: string
  preview?: boolean
  previewCaseId?: string
}) {
  const [view, setView] = useState<'overview' | 'offer' | 'files' | 'work' | 'planning'>(
    'overview'
  )
  const [offers, setOffers] = useState(portal.customerOffers?.offers ?? [])
  const [offerId, setOfferId] = useState(offers[0]?.id ?? '')
  const [selection, setSelection] = useState<string[]>([])
  const [signerName, setSignerName] = useState(portal.participant.name)
  const [confirmed, setConfirmed] = useState(false)
  const [challengeId, setChallengeId] = useState(''),
    [code, setCode] = useState('')
  const [busy, setBusy] = useState(false),
    running = useRef(false),
    heading = useRef<HTMLHeadingElement>(null)
  const toast = useToast(),
    c = portal.actionCase,
    latest = offers[0],
    offer = offers.find((o) => o.id === offerId) ?? latest
  const accepted = offers.find((o) => o.status === 'accepted')
  const plannedItems = portal.customerOffers?.plannedItems ?? []
  const offeredOptions = latest?.snapshot.items.filter((i) => i.kind === 'option') ?? []
  const workCount = latest
    ? latest.snapshot.items.filter((i) => i.kind === 'included' || (i.kind === 'option' && accepted?.acceptedOptionIds.includes(i.id))).length
    : c.items.length
  const sharedFiles = c.attachments.filter(
    (f) => !latest?.files.some((copy) => copy.id === f.id)
  )
  const actionable =
    latest?.status === 'published' &&
    latest.snapshot.validUntil >=
      new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' })
  function navigate(next: typeof view) {
    setView(next)
    requestAnimationFrame(() => {
      heading.current?.focus()
      heading.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    })
  }
  function select(ids: string[]) {
    setSelection(ids)
    setChallengeId('')
    setCode('')
    setConfirmed(false)
  }
  async function respond(operation: 'challenge' | 'accept') {
    if (!offer || !token || preview || running.current) return
    running.current = true
    setBusy(true)
    try {
      const response = await fetch(
        `/api/action-cases/public/${token}/offers/${offer.id}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operation,
            selection,
            signerName,
            confirmed,
            challengeId,
            code
          })
        }
      )
      const data = await response.json()
      if (!response.ok)
        throw new Error(data.error || 'Kunde inte hantera godkännandet.')
      if (operation === 'challenge') {
        setChallengeId(data.challengeId)
        toast.success('En kod har skickats till beställarens e-post.')
      } else {
        if (data.offer?.id !== offer.id || data.offer.status !== 'accepted')
          throw new Error('Godkännandet kunde inte bekräftas. Försök igen.')
        setOffers((current) =>
          current.map((o) => (o.id === offer.id ? data.offer : o))
        )
        setChallengeId('')
        toast.success('Offerten är godkänd. Bekräftelsen finns i ditt avtal.')
      }
    } catch (error) {
      toast.error(error, 'Kunde inte hantera godkännandet.')
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  const fileUrl = (o: CustomerOffer, id: string) =>
    preview
      ? `/api/action-cases/${previewCaseId}/customer-offers/${o.id}/files/${id}`
      : `/api/action-cases/public/${token}/offers/${o.id}/files/${id}`
  const sharedUrl = (id: string) =>
    preview
      ? `/api/action-cases/${previewCaseId}/attachments/${id}`
      : `/api/action-cases/public/${token}/attachments/${id}`
  return (
    <main className="mx-auto max-w-5xl break-words px-4 pb-16 sm:px-6">
      <header className="border-b border-slate-200 py-7">
        <p className="text-sm font-medium text-slate-500">
          Ditt projekt{preview ? ' · Förhandsgranskning' : ''}
        </p>
        <h1 ref={heading} tabIndex={-1} className="mt-2 outline-none">
          {c.title}
        </h1>
        <p className="mt-2 flex items-center gap-2 text-sm text-slate-600">
          <MapPin size={16} className="shrink-0" />
          {c.propertyAddress}
        </p>
      </header>
      {view !== 'overview' && (
        <div className="flex flex-wrap justify-between gap-3 py-5 print:hidden">
          <button className={button} onClick={() => navigate('overview')}>
            <ArrowLeft size={17} /> Projektöversikt
          </button>
          {view === 'offer' && offer && (
            <button className={button} onClick={() => window.print()}>
              <Printer size={17} /> Skriv ut
            </button>
          )}
        </div>
      )}
      {view === 'overview' && (
        <>
          <section className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 py-6">
            <div className="flex items-start gap-3">
              {accepted ? (
                <CheckCircle2 className="mt-1 text-emerald-700" size={23} />
              ) : (
                <ClipboardList className="mt-1 text-violet-700" size={23} />
              )}
              <div>
                <h2 className="text-lg">
                  {accepted
                    ? 'Ditt avtal är klart'
                    : actionable
                      ? 'Din offert är klar att granska'
                      : latest
                        ? 'Ingen offert väntar på ditt godkännande'
                        : 'Ditt uppdrag förbereds'}
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  {accepted
                    ? `${money(accepted.acceptedTotalOre)} inklusive moms`
                    : actionable
                      ? `Giltig till ${latest.snapshot.validUntil}`
                      : 'Du hittar delat underlag här.'}
                </p>
              </div>
            </div>
            {latest && (
              <button
                className={`${button} bg-slate-950 text-white`}
                onClick={() => {
                  setOfferId(latest.id)
                  navigate('offer')
                }}
              >
                {accepted ? 'Visa avtal' : 'Visa offert'}
                <ArrowRight size={17} />
              </button>
            )}
          </section>
          <div className="grid divide-y divide-slate-200 border-b border-slate-200 md:grid-cols-2 md:divide-y-0 lg:grid-cols-4">
            <button
              onClick={() => navigate(latest ? 'offer' : 'work')}
              className="min-w-0 p-6 text-left hover:bg-white"
            >
              <FileText size={23} className="text-violet-700" />
              <h2 className="mt-4 text-base">
                {accepted ? 'Offert och avtal' : 'Mitt uppdrag'}
              </h2>
              <p className="mt-2 text-xl font-semibold">
                {accepted
                  ? money(accepted.acceptedTotalOre)
                  : latest
                    ? money(latest.snapshot.baseAmountOre)
                    : `${c.items.length} delade arbeten`}
              </p>
              <p className="mt-2 text-sm text-slate-500">
                {accepted
                  ? 'Avtalat inklusive moms'
                  : latest
                    ? 'Grundpris inklusive moms'
                    : 'Omfattning och underlag'}
              </p>
              <ArrowRight className="mt-5" size={18} />
            </button>
            <button
              onClick={() => navigate('work')}
              className="min-w-0 p-6 text-left hover:bg-white"
            >
              <ClipboardList size={23} className="text-violet-700" />
              <h2 className="mt-4 text-base">Avtalets omfattning</h2>
              <p className="mt-2 text-xl font-semibold">
                {workCount} {workCount === 1 ? 'arbete' : 'arbeten'}
              </p>
              <p className="mt-2 text-sm text-slate-500">
                Grundåtagande och avgränsningar
              </p>
              <ArrowRight className="mt-5" size={18} />
            </button>
            <button onClick={() => navigate('planning')} className="min-w-0 p-6 text-left hover:bg-white">
              <ListChecks size={23} className="text-violet-700" />
              <h2 className="mt-4 text-base">Val och tillval</h2>
              <p className="mt-2 text-xl font-semibold">{plannedItems.length} {plannedItems.length === 1 ? 'planerat' : 'planerade'}</p>
              <p className="mt-2 text-sm text-slate-500">{offeredOptions.length} alternativ i {accepted ? 'avtalshistoriken' : 'offerten'}</p>
              <ArrowRight className="mt-5" size={18} />
            </button>
            <button
              onClick={() => navigate('files')}
              className="min-w-0 p-6 text-left hover:bg-white"
            >
              <FolderOpen size={23} className="text-violet-700" />
              <h2 className="mt-4 text-base">Bilder och dokument</h2>
              <p className="mt-2 text-xl font-semibold">
                {sharedFiles.length + (latest?.files.length ?? 0)} filer
              </p>
              <p className="mt-2 text-sm text-slate-500">
                Projektmaterial och offertbilagor
              </p>
              <ArrowRight className="mt-5" size={18} />
            </button>
          </div>
          {latest && (
            <section className="py-6">
              <h2 className="text-base">Din kontakt</h2>
              <p className="mt-2 text-sm">{latest.snapshot.issuerName}</p>
              <a
                href={`mailto:${latest.snapshot.replyEmail}`}
                className="mt-2 inline-flex items-center gap-2 break-all text-sm text-violet-700"
              >
                <Mail size={17} />
                {latest.snapshot.replyEmail}
              </a>
            </section>
          )}
        </>
      )}
      {view === 'offer' && offer && (
        <>
          {offers.length > 1 && (
            <label className="mb-5 block text-sm print:hidden">
              Offertversion
              <select
                value={offer.id}
                onChange={(e) => {
                  setOfferId(e.target.value)
                  select([])
                }}
                className="ml-3 rounded-md border border-slate-300 p-2"
              >
                {offers.map((o) => (
                  <option key={o.id} value={o.id}>
                    Version {o.version} ·{' '}
                    {
                      {
                        published: 'Publicerad',
                        accepted: 'Godkänd',
                        withdrawn: 'Återkallad',
                        superseded: 'Ersatt'
                      }[o.status]
                    }
                  </option>
                ))}
              </select>
            </label>
          )}
          {offer.status !== 'accepted' &&
            (!actionable || offer.id !== latest?.id) && (
              <p className="mb-4 border-l-4 border-amber-500 bg-amber-50 p-4 text-sm">
                Denna version kan inte längre godkännas.
              </p>
            )}
          <div className="bg-white px-5 sm:px-8">
            <CustomerOfferDocument
              offer={offer}
              selected={selection}
              onSelect={select}
              readOnly={
                busy || preview || offer.id !== latest?.id || !actionable
              }
              fileUrl={(id) => fileUrl(offer, id)}
            />
            {!preview &&
              actionable &&
              offer.id === latest?.id &&
              offer.status === 'published' && (
                <section className="py-6 print:hidden">
                  <h3 className="text-lg font-semibold">Godkänn offerten</h3>
                  <label className="mt-4 block text-sm">
                    Ditt fullständiga namn *
                    <input
                      value={signerName}
                      disabled={busy || Boolean(challengeId)}
                      onChange={(e) => setSignerName(e.target.value)}
                      className="mt-2 block w-full max-w-md border border-slate-300 px-3 py-2"
                      autoComplete="name"
                    />
                  </label>
                  <label className="mt-4 flex items-start gap-3 text-sm leading-6">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      disabled={busy || Boolean(challengeId)}
                      onChange={(e) => setConfirmed(e.target.checked)}
                      className="mt-1 h-5 w-5 shrink-0"
                    />
                    <span>
                      Jag är beställaren eller behörig företrädare och godkänner
                      version {offer.version}, valda tillval, villkor och
                      bilagor. Totalt{' '}
                      {money(customerOfferTotal(offer.snapshot, selection))}{' '}
                      inklusive moms.
                    </span>
                  </label>
                  {challengeId ? (
                    <div className="mt-5">
                      <p className="text-sm text-slate-600">
                        Ange den sexsiffriga koden från mejlet. Koden gäller
                        dina val ovan.
                      </p>
                      <label className="mt-3 block text-sm">
                        E-postkod
                        <input
                          value={code}
                          onChange={(e) =>
                            setCode(
                              e.target.value.replace(/\D/g, '').slice(0, 6)
                            )
                          }
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          className="mt-2 block w-44 border border-slate-300 px-3 py-2"
                        />
                      </label>
                      <div className="mt-4 flex flex-wrap gap-3">
                        <button
                          disabled={busy || code.length !== 6}
                          onClick={() => void respond('accept')}
                          className={`${button} bg-slate-950 text-white`}
                        >
                          {busy ? (
                            <Loader2 className="animate-spin" size={18} />
                          ) : (
                            <ShieldCheck size={18} />
                          )}
                          Bekräfta godkännandet
                        </button>
                        <button
                          disabled={busy}
                          className={button}
                          onClick={() => {
                            setChallengeId('')
                            setCode('')
                          }}
                        >
                          Begär ny kod
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      disabled={
                        busy || !confirmed || signerName.trim().length < 2
                      }
                      onClick={() => void respond('challenge')}
                      className={`${button} mt-5 bg-slate-950 text-white`}
                    >
                      {busy ? (
                        <Loader2 className="animate-spin" size={18} />
                      ) : (
                        <Mail size={18} />
                      )}
                      Skicka kod till min e-post
                    </button>
                  )}
                </section>
              )}
          </div>
        </>
      )}
      {view === 'planning' && <div className="bg-white px-5 sm:px-8">
        <CustomerPlannedItems items={plannedItems} />
        {offeredOptions.length > 0 && <section className="border-t border-slate-200 py-6">
          <h2 className="text-xl">{accepted ? 'Val i huvudavtalet' : 'Val vid offertens godkännande'}</h2>
          {offeredOptions.map((item) => <div key={item.id} className="border-b border-slate-200 py-4"><div className="flex flex-wrap justify-between gap-3"><h3 className="font-semibold">{item.title}</h3><span className="text-sm">{money(item.amountOre)}</span></div><p className="mt-2 text-sm">{accepted ? accepted.acceptedOptionIds.includes(item.id) ? 'Ingår i godkänt avtal' : 'Inte beställt' : 'Beställs endast om det väljs vid offertens godkännande'}</p></div>)}
          <button className={`${button} mt-5`} onClick={() => { setOfferId(latest.id); navigate('offer') }}><FileText size={17} /> {accepted ? 'Visa huvudavtal' : 'Granska offert och välj'}</button>
        </section>}
      </div>}
      {view === 'work' && (
        <section className="bg-white px-5 py-6 sm:px-8">
          <h2 className="text-xl">Arbeten</h2>
          {latest
            ? latest.snapshot.items.filter((i) => i.kind !== 'option' || accepted?.acceptedOptionIds.includes(i.id)).map((i) => (
                <article key={i.id} className="border-b border-slate-200 py-5">
                  <div className="flex flex-wrap justify-between gap-2">
                    <h3 className="font-semibold">{i.title}</h3>
                    <span className="text-sm text-slate-500">
                      {i.kind === 'included'
                        ? 'Grundåtagande'
                        : i.kind === 'excluded'
                          ? 'Utanför vårt åtagande'
                          : accepted?.acceptedOptionIds.includes(i.id)
                            ? 'Valt tillval'
                            : 'Tillval'}
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
                    {i.scope}
                  </p>
                </article>
              ))
            : c.items.map((i) => (
                <article key={i.id} className="border-b border-slate-200 py-5">
                  <h3 className="font-semibold">{i.title}</h3>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
                    {i.scope}
                  </p>
                </article>
              ))}
          {!latest && !c.items.length && (
            <p className="mt-4 text-slate-600">
              Ingen omfattning har delats ännu.
            </p>
          )}
        </section>
      )}
      {view === 'files' && (
        <section>
          <h2 className="text-xl">Bilder och dokument</h2>
          {latest?.files.length ? (
            <div className="mt-5 divide-y divide-slate-200">
              {latest.files.map((f) => (
                <a
                  className="flex items-center gap-3 py-4 text-sm text-violet-700"
                  key={f.id}
                  href={fileUrl(latest, f.id)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <FileText size={20} className="shrink-0" />
                  <span className="break-words">
                    {f.fileName} · Offertversion {latest.version}
                  </span>
                </a>
              ))}
            </div>
          ) : null}
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sharedFiles.map((f) => (
              <a
                key={f.id}
                href={sharedUrl(f.id)}
                target="_blank"
                rel="noreferrer"
                className="overflow-hidden rounded-lg border border-slate-200 bg-white"
              >
                {f.type === 'image' ? (
                  <div className="relative aspect-[4/3] bg-slate-100">
                    <Image
                      fill
                      unoptimized
                      src={sharedUrl(f.id)}
                      alt={f.title || f.fileName}
                      className="object-cover"
                    />
                  </div>
                ) : (
                  <div className="flex h-24 items-center justify-center bg-slate-50">
                    <FileText size={28} />
                  </div>
                )}
                <p className="break-words p-4 text-sm">
                  {f.title || f.fileName}
                </p>
              </a>
            ))}
          </div>
          {!latest?.files.length && !sharedFiles.length && (
            <p className="py-8 text-slate-600">
              Inget material har delats ännu.
            </p>
          )}
        </section>
      )}
    </main>
  )
}
