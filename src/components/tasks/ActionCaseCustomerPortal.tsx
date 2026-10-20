'use client'
import { ProjectScheduleDocument } from './ProjectScheduleEditor'
import { isImageAttachment } from '@/lib/action-cases/attachmentImages'

import Image from 'next/image'
import { useRef, useState } from 'react'
import {
  CalendarClock,
  Eye,
  ListChecks,
  FileText,
  FolderOpen,
  Loader2,
  Mail,
  MapPin,
  Printer,
  WalletCards,
  ShieldCheck,
  Download
} from 'lucide-react'
import { useToast } from '@/components/ui/AppToastProvider'
import type { ActionCasePortal } from '@/lib/action-cases/contracts'
import {
  customerOfferTotal,
  customerPriceLabel,
  money,
  type CustomerOffer
} from '@/lib/action-cases/customerOffers'
import CustomerOfferDocument from './CustomerOfferDocument'
import { CustomerPlannedItems } from './CustomerPlanningEditor'
import CustomerChoiceCategories from './CustomerChoiceCategories'
import { choiceDecisionDates } from '@/lib/action-cases/customerPlanning'
import { PaymentPlanDocument } from './CustomerPaymentPlan'
import { customerSections, defaultCustomerVisibility } from '@/lib/action-cases/customerSharing'

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
  const [view, setView] = useState<'offer' | 'planning' | 'payments' | 'schedule' | 'files'>('offer')
  const visibility = portal.sharing?.tabs ?? defaultCustomerVisibility()
  const availableViews = customerSections.filter(s => visibility[s.key]).map(s => s.view)
  const activeView = availableViews.includes(view) ? view : availableViews[0]
  const externalContracts = portal.customerOffers?.externalContracts ?? []
  const [offers, setOffers] = useState(() => [
    ...(portal.customerOffers?.offers ?? []),
    ...externalContracts.map((entry) => ({ ...entry.document, status: entry.releasedAt ? 'superseded' as const : 'published' as const })),
  ].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)))
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
  const external = externalContracts.find((entry) => entry.document.id === offer?.id)
  const latestExternal = externalContracts.find((entry) => entry.document.id === latest?.id)
  const plannedItems = portal.customerOffers?.plannedItems ?? []
  const [plannedChoices, setPlannedChoices] = useState(portal.customerOffers?.plannedChoices)
  const decisionDates = choiceDecisionDates(plannedItems, plannedChoices)
  const offeredOptions = latest?.snapshot.items.filter((i) => i.kind === 'option') ?? []
  const contract = latestExternal && !latestExternal.releasedAt ? latest : accepted ?? offers.find((o) => o.status === 'published')
  const payment = portal.sharing ? portal.sharedPayment : contract ? { version: contract.version, stage: latestExternal ? latestExternal.signedCopyRegisteredAt ? 'signed' : 'shared' : accepted ? 'accepted' : 'proposed', plan: contract.snapshot.paymentPlan, terms: contract.snapshot.paymentTerms, conditions: contract.snapshot.paymentConditions } : undefined
  const contractTiming = portal.sharing ? portal.sharedContractSchedule : contract?.snapshot.schedule ? { version: contract.version, accepted: Boolean(accepted), text: contract.snapshot.schedule } : undefined
  const contact = portal.customerContact ?? (latest ? { issuerName: latest.snapshot.issuerName, replyEmail: latest.snapshot.replyEmail } : undefined)
  const sharedFiles = c.attachments.filter(
    (f) => !latest?.files.some((copy) => copy.id === f.id)
  )
  const actionable =
    !latestExternal &&
    latest?.status === 'published' &&
    latest.snapshot.validUntil >=
      new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' })
  function navigate(next: typeof view) {
    if (!availableViews.includes(next)) return
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
    if (!offer || external || !token || preview || running.current) return
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
    externalContracts.some((entry) => entry.document.id === o.id)
      ? preview ? `/api/action-cases/${previewCaseId}/contract-signing/${o.id}/${id === 'pdf' ? 'customer-pdf' : id}` : `/api/action-cases/public/${token}/contract-signing/${o.id}/${id}`
      : preview
      ? `/api/action-cases/${previewCaseId}/customer-offers/${o.id}/files/${id}`
      : `/api/action-cases/public/${token}/offers/${o.id}/files/${id}`
  const sharedUrl = (id: string) =>
    preview
      ? `/api/action-cases/${previewCaseId}/attachments/${id}`
      : `/api/action-cases/public/${token}/attachments/${id}`
  const Container = preview ? 'div' : 'main'
  const Heading = preview ? 'h2' : 'h1'
  return (
    <Container className="mx-auto max-w-5xl break-words px-4 pb-16 sm:px-6">
      {preview && <div className="mt-6 flex items-center gap-2 border-l-4 border-amber-400 bg-amber-50 px-4 py-3 text-sm font-semibold text-slate-900">
        <Eye size={18} className="shrink-0" aria-hidden="true" />
        Förhandsgranskning som beställare
      </div>}
      <header className="border-b border-slate-200 py-7">
        <p className="text-sm font-medium text-slate-500">
          Ditt projekt
        </p>
        <Heading ref={heading} tabIndex={-1} className="mt-2 outline-none">
          {c.title}
        </Heading>
        <p className="mt-2 flex items-center gap-2 text-sm text-slate-600">
          <MapPin size={16} className="shrink-0" />
          {c.propertyAddress}
        </p>
      </header>
      <nav aria-label="Ditt projekt" className="grid grid-cols-2 gap-1 border-b border-slate-200 py-3 lg:grid-cols-5 print:hidden">
        {([
          ['offer', 'Avtal', FileText],
          ['planning', 'Val och tillval', ListChecks],
          ['payments', 'Betalningsplan', WalletCards],
          ['schedule', 'Tidsplan', CalendarClock],
          ['files', 'Bilder och filer', FolderOpen]
        ] as const).filter(([key]) => availableViews.includes(key)).map(([key, label, Icon]) => <button key={key}
          aria-pressed={activeView === key} onClick={() => navigate(key)}
          className={`${button} min-w-0 border-transparent ${activeView === key ? 'bg-violet-50 text-violet-800' : 'hover:bg-white'}`}>
          <Icon size={18} className="shrink-0" />{label}
        </button>)}
      </nav>
      {!availableViews.length && <p className="py-8 text-sm text-slate-600">Inga delar av projektet är tillgängliga.</p>}
      {activeView === 'offer' && !offer && <section className="py-8">
        <h2 className="text-xl">Avtal</h2>
        <p className="mt-3 text-sm text-slate-600">Grundavtalet förbereds. Inget avtal finns att godkänna ännu.</p>
      </section>}
      {activeView === 'offer' && offer && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 py-5">
            <div>
              <h2 className="text-xl">{external ? external.signedCopyRegisteredAt ? 'Avtal · Underskriven kopia registrerad' : 'Avtal för underskrift' : offer.status === 'accepted' ? 'Godkänt avtal' : 'Grundavtal'}</h2>
              <p className="mt-1 text-sm text-slate-600">{offer.snapshot.items.some((i) => i.kind === 'option')
                ? 'Tidigare publicerad version. Ursprunglig omfattning och val visas oförändrade.'
                : 'Omfattning, pris och villkor. Val och tillval beställs separat.'}</p>
            </div>
            {external ? <a className={`${button} print:hidden`} href={fileUrl(offer, 'pdf')} target="_blank" rel="noopener noreferrer"><Download size={17} /> Hämta PDF för underskrift</a> : <button className={`${button} print:hidden`} onClick={() => window.print()}><Printer size={17} /> Skriv ut avtal</button>}
          </div>
          {offers.length > 1 && (
            <label className="mb-5 block text-sm print:hidden">
              Avtalsversion
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
                    {externalContracts.some((entry) => entry.document.id === o.id) ? 'PDF' : 'Digitalt'} · Version {o.version} ·{' '}
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
          {external && <p className="mb-4 border-l-4 border-teal-700 bg-slate-50 p-3 text-sm">
            {external.releasedAt ? 'Äldre avtalsversion. Ett nytt internt utkast har öppnats; det ändrar inte denna kopia.' : external.signedCopyRegisteredAt
              ? 'Entreprenören har registrerat en underskriven kopia för denna version efter manuell kontroll. Ingen digital signering har gjorts här.'
              : 'Avtalet signeras på papper eller i en annan tjänst. Denna version är låst, men ännu inte registrerad som underskriven.'}
          </p>}
          {!external && offer.status !== 'accepted' &&
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
                Boolean(external) || busy || preview || offer.id !== latest?.id || !actionable
              }
              fileUrl={(id) => fileUrl(offer, id)}
            />
            {!preview &&
              actionable &&
              offer.id === latest?.id &&
              offer.status === 'published' && (
                <section className="py-6 print:hidden">
                  <h3 className="text-lg font-semibold">Godkänn avtalet med e-postkod</h3>
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
                      version {offer.version}{offer.snapshot.items.some((i) => i.kind === 'option') ? ', valda tillval' : ''}, villkor och
                      bilagor. {offer.snapshot.contractPricing ? <>Prisgrunder: {customerPriceLabel(offer.snapshot)}. {offer.snapshot.contractPricing.mode !== 'fixed' ? 'Den löpande delen debiteras enligt avtalets timpriser och arvoden.' : 'Inklusive moms.'}</> : <>Totalt {money(customerOfferTotal(offer.snapshot, selection))} inklusive moms.</>}
                    </span>
                  </label>
                  {challengeId ? (
                    <div className="mt-5">
                      <p className="text-sm text-slate-600">
                        Ange den sexsiffriga koden från mejlet. Koden gäller
                        denna avtalsversion och {offer.snapshot.contractPricing?.mode !== 'fixed' && offer.snapshot.contractPricing ? 'prisgrunderna ovan' : 'beloppet ovan'}.
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
      {activeView === 'planning' && <div className="bg-white px-5 sm:px-8">
        <p className="border-b border-slate-200 py-5 text-sm text-slate-600">
          {accepted
            ? 'Grundavtalet är godkänt. Val och tillval nedan är ännu inte beställda och ändrar inte avtalssumman.'
            : 'Valen kan förberedas nu. Du behöver inte välja något här för att godkänna grundavtalet.'}
          {' '}En senare beställning behöver en separat överenskommelse om omfattning, pris och tid.
        </p>
        {plannedChoices ? <CustomerChoiceCategories shared={plannedChoices} onSaved={setPlannedChoices} token={token} previewCaseId={preview ? previewCaseId : undefined} readOnly={preview || !token} />
          : <CustomerPlannedItems items={plannedItems} />}
        {offeredOptions.length > 0 && <details className="border-t border-slate-200 py-5">
          <summary className="cursor-pointer text-sm font-semibold">Val i tidigare avtalsversion</summary>
          {offeredOptions.map((item) => <div key={item.id} className="border-b border-slate-200 py-4">
            <h3 className="font-semibold">{item.title}</h3>
            <p className="mt-2 text-sm">{money(item.amountOre)} · {accepted?.acceptedOptionIds.includes(item.id) ? 'Ingår i det godkända avtalet' : 'Se ursprunglig avtalsversion'}</p>
          </div>)}
          <button className={`${button} mt-4`} onClick={() => { setOfferId(latest.id); navigate('offer') }}>Visa avtalsversion</button>
        </details>}
      </div>}
      {activeView === 'payments' && <section className="py-6">
        <h2 className="text-xl">Betalningsplan</h2>
        {payment ? <>
          <p className="mt-3 text-sm font-medium">{payment.stage === 'signed' ? 'Betalningsplan · Underskriven kopia registrerad' : payment.stage === 'shared' ? 'Delad betalningsplan · Väntar på underskrift' : payment.stage === 'accepted' ? 'Avtalad betalningsplan' : 'Föreslagen betalningsplan · Avtalet är inte godkänt'} · Version {payment.version}</p>
          <p className="mt-2 text-sm text-slate-600">Grundavtalet · Inklusive moms. Detta är en betalningsplan, inte fakturor eller betalningskvitton.</p>
          <PaymentPlanDocument plan={payment.plan} paymentTerms={payment.terms} conditions={payment.conditions} />
        </> : <p className="mt-3 text-sm text-slate-600">Ingen betalningsplan har delats ännu.</p>}
      </section>}
      {activeView === 'schedule' && <section className="py-6">
        <h2 className="text-xl">Tidsplan</h2>
        {portal.actionCase.schedule?.length ? <ProjectScheduleDocument rows={portal.actionCase.schedule} /> : null}
        {contractTiming ? <>
          <p className="mt-3 text-sm font-medium">{contractTiming.accepted ? 'Avtalade tider' : 'Föreslagna tider · Avtalet är inte godkänt'}</p>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{contractTiming.text}</p>
          <p className="mt-4 text-sm text-slate-500">Avtalsversion {contractTiming.version}</p>
        </> : <p className="mt-3 text-sm text-slate-600">Inga avtalstider har delats ännu.</p>}
        {decisionDates.length > 0 && <div className="mt-6 border-t border-slate-200 pt-5">
          <h3 className="font-semibold">Önskade beslutsdatum</h3>
          {decisionDates.map((i) =>
            <div key={i.id} className="flex flex-wrap justify-between gap-3 border-b border-slate-200 py-3 text-sm">
              <span>{i.title}</span><time dateTime={i.decisionBy}>{i.decisionBy}</time>
            </div>)}
        </div>}
      </section>}
      {activeView === 'files' && (
        <section>
          <h2 className="pt-6 text-xl">Bilder och filer</h2>
          {latest?.files.length ? (
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {latest.files.map((f) => (
                <a
                  className="overflow-hidden rounded-md border border-slate-200 text-sm text-violet-700"
                  key={f.id}
                  href={fileUrl(latest, f.id)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {isImageAttachment(f) ? <div className="relative aspect-[4/3] bg-slate-100"><Image fill unoptimized src={fileUrl(latest, f.id)} alt={f.fileName} className="object-contain" /></div> : <div className="flex h-24 items-center justify-center bg-slate-50"><FileText size={28} /></div>}
                  <span className="block break-words p-3">
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
                {isImageAttachment(f) ? (
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
      {contact && <footer className="mt-8 border-t border-slate-200 py-5 print:hidden">
        <h2 className="text-sm font-semibold">Din kontakt</h2>
        <p className="mt-2 text-sm">{contact.issuerName}</p>
        <a href={`mailto:${contact.replyEmail}`} className="mt-2 inline-flex items-center gap-2 break-all text-sm text-violet-700">
          <Mail size={17} className="shrink-0" />{contact.replyEmail}
        </a>
      </footer>}
    </Container>
  )
}
