'use client'

import { useId } from 'react'
import { Check, Download, FileText } from 'lucide-react'
import { CustomerContractDocument } from './CustomerContractFields'
import { PaymentPlanDocument } from './CustomerPaymentPlan'
import { ContractPartiesDocument } from './CustomerContractPartiesEditor'
import {
  customerOfferBaseAmount,
  customerOfferOptionGroup,
  customerOfferTotal,
  money,
  selectCustomerOfferOption,
  type CustomerOffer,
  type CustomerOfferItem
} from '@/lib/action-cases/customerOffers'

function ScopeNotes({ item }: { item: CustomerOfferItem }) {
  return <>{([['scopeConditions', 'Förutsättningar'], ['scopeExclusions', 'Ingår inte'], ['scopeAdvice', 'Avrådan']] as const).map(([key, title]) => item[key]?.trim() ? (
    <span key={key} className="mt-3 block text-sm leading-6 text-slate-700"><strong className="block">{title}</strong><span className="block whitespace-pre-wrap">{item[key]}</span></span>
  ) : null)}</>
}

export default function CustomerOfferDocument({
  offer,
  selected,
  onSelect,
  fileUrl,
  readOnly = false,
  purpose = 'contract'
}: {
  offer: CustomerOffer
  selected: string[]
  onSelect?: (ids: string[]) => void
  fileUrl: (fileId: string) => string
  readOnly?: boolean
  purpose?: 'offer' | 'contract'
}) {
  const s = offer.snapshot,
    accepted = offer.status === 'accepted'
  const groupId = useId()
  const groups = [...new Set(s.items.map(customerOfferOptionGroup).filter(Boolean))]
  const selection = accepted
    ? offer.acceptedOptionIds
    : selected.filter((id) =>
        s.items.some(
          (i) => i.id === id && i.kind === 'option' && i.amountOre !== null
        )
      )
  const baseAmount = customerOfferBaseAmount(s)
  const total = baseAmount === null ? null : customerOfferTotal(s, selection)
  const files = offer.files.filter((file) => purpose === 'contract' || file.id !== s.termsAttachmentId)
  return (
    <article className="min-w-0 break-words bg-white" aria-label={purpose === 'offer' ? 'Kundoffert' : 'Kundavtal'}>
      <header className="border-b border-slate-200 py-6">
        <p className="text-sm text-slate-500">
          {accepted ? 'Godkänt avtal' : purpose === 'offer' ? 'Offert' : 'Avtal'} · Version{' '}
          {offer.version || 'utkast'}
        </p>
        <h2 className="mt-2 text-2xl font-semibold">
          {s.title || 'Offertutkast'}
        </h2>
        <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
          {(purpose === 'offer' || !s.contractParties) && <div>
            <dt className="text-slate-500">Beställare</dt>
            <dd className="mt-1 font-semibold">{s.contractParties?.customers.map((row) => row.name).filter(Boolean).join(', ') || s.customerName}</dd>
            <dd className="break-all text-slate-600">{s.contractParties?.email || s.customerEmail}</dd>
          </div>}
          {(purpose === 'offer' || !s.contractParties) && <div>
            <dt className="text-slate-500">Entreprenör</dt>
            <dd className="mt-1 font-semibold">{s.contractParties?.contractor.companyName || s.issuerName}</dd>
            <dd className="break-all text-slate-600">{s.contractParties?.contractor.email || s.replyEmail}</dd>
          </div>}
          <div>
            <dt className="text-slate-500">Objekt</dt>
            <dd className="mt-1">{s.propertyAddress}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Giltig till och med</dt>
            <dd className="mt-1">{s.validUntil || 'Ej angivet'}</dd>
          </div>
        </dl>
        {s.introduction && (
          <p className="mt-5 whitespace-pre-wrap leading-7">{s.introduction}</p>
        )}
      </header>
      {purpose === 'contract' && s.contractParties && <ContractPartiesDocument value={s.contractParties} />}
      <section className="py-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h3 className="text-lg font-semibold">{purpose === 'contract' && s.contractDetails?.assignment ? 'Uppdraget' : 'Grundåtagande'}</h3>
          <strong className="text-xl">{money(baseAmount)}</strong>
        </div>
        <p className="mt-1 text-sm text-slate-500">Fast pris inklusive moms</p>
          {purpose === 'contract' && s.contractDetails?.assignment && <div className="mt-4">
            <h4 className="font-semibold">Handlingar som ingår i uppdraget</h4>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50"><tr><th className="px-3 py-2">Typ av handling</th><th className="px-3 py-2">Handlingens namn</th><th className="px-3 py-2">Datum</th></tr></thead>
                <tbody><tr className="border-b border-slate-200"><td className="px-3 py-2">Detta kontrakt</td><td className="break-words px-3 py-2">{s.title}</td><td className="whitespace-nowrap px-3 py-2">{offer.publishedAt ? new Date(offer.publishedAt).toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' }) : 'Datum vid publicering'}</td></tr>
                  {s.contractDetails.assignment.documents.map((doc) => <tr key={doc.fileId} className="border-b border-slate-200">
                    <td className="px-3 py-2">{doc.type || 'Ej angivet'}</td>
                    <td className="break-all px-3 py-2">{fileUrl ? <a className="underline" href={fileUrl(doc.fileId)} target="_blank" rel="noopener noreferrer">{doc.name}</a> : doc.name}</td>
                    <td className="whitespace-nowrap px-3 py-2">{doc.date || 'Ej angivet'}</td>
                  </tr>)}
                </tbody>
              </table>
            </div>
            {s.contractDetails.assignment.documentNotes && <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{s.contractDetails.assignment.documentNotes}</p>}
            {s.contractDetails.assignment.additionalScope && <div className="mt-4"><h4 className="font-semibold">Samt enligt följande</h4><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{s.contractDetails.assignment.additionalScope}</p></div>}
          </div>}
        {s.items
          .filter((i) => i.kind === 'included')
          .map((i) => (
            <div className="mt-5 border-t border-slate-100 pt-4" key={i.id}>
              <div className="flex flex-wrap justify-between gap-2">
                <h4 className="font-semibold">{i.title}</h4>
                {s.pricingMode === 'itemized' && <strong>{money(i.amountOre)}</strong>}
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                {i.scope}
              </p>
              <ScopeNotes item={i} />
            </div>
          ))}
      </section>
      {s.items.some((i) => i.kind === 'option' && !customerOfferOptionGroup(i)) && (
        <section className="border-t border-slate-200 py-6">
          <h3 className="text-lg font-semibold">Tillval vid godkännande</h3>
          <div className="mt-3 divide-y divide-slate-200">
            {s.items
              .filter((i) => i.kind === 'option' && !customerOfferOptionGroup(i))
              .map((i) => (
                <label key={i.id} className="flex items-start gap-3 py-4">
                  <input
                    type="checkbox"
                    className="mt-1 h-5 w-5 shrink-0"
                    checked={selection.includes(i.id)}
                    disabled={
                      readOnly || accepted || !onSelect || i.amountOre === null
                    }
                    onChange={(e) =>
                      onSelect?.(
                        e.target.checked
                          ? selectCustomerOfferOption(s, selection, i.id)
                          : selection.filter((id) => id !== i.id)
                      )
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap justify-between gap-2">
                      <strong>{i.title}</strong>
                      <strong>+ {money(i.amountOre)}</strong>
                    </span>
                    <span className="mt-2 block whitespace-pre-wrap text-sm leading-6 text-slate-700">
                      {i.scope}
                    </span>
                    <ScopeNotes item={i} />
                  </span>
                </label>
              ))}
          </div>
        </section>
      )}
      {groups.map((group, index) => {
        const options = s.items.filter((i) => customerOfferOptionGroup(i) === group)
        const chosen = options.find((i) => selection.includes(i.id))
        return (
          <fieldset key={group} className="min-w-0 border-t border-slate-200 py-6">
            <legend className="text-lg font-semibold">{group}</legend>
            <p className="text-sm text-slate-500">Valfritt tillval · Högst ett alternativ · Inklusive moms</p>
            <div className="mt-3 divide-y divide-slate-200">
              {options.map((i) => (
                <label key={i.id} className="flex items-start gap-3 py-4">
                  <input
                    type="radio"
                    name={`${groupId}-${index}`}
                    className="mt-1 h-5 w-5 shrink-0"
                    checked={chosen?.id === i.id}
                    disabled={readOnly || accepted || !onSelect || i.amountOre === null}
                    onChange={() => onSelect?.(selectCustomerOfferOption(s, selection, i.id))}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap justify-between gap-2">
                      <strong>{i.title}</strong>
                      <strong>+ {money(i.amountOre)}</strong>
                    </span>
                    <span className="mt-2 block whitespace-pre-wrap text-sm leading-6 text-slate-700">{i.scope}</span>
                    <ScopeNotes item={i} />
                  </span>
                </label>
              ))}
              <label className="flex items-center gap-3 py-4 text-sm">
                <input
                  type="radio"
                  name={`${groupId}-${index}`}
                  className="h-5 w-5 shrink-0"
                  checked={!chosen}
                  disabled={readOnly || accepted || !onSelect}
                  onChange={() => onSelect?.(selection.filter((id) => !options.some((i) => i.id === id)))}
                />
                Inget av dessa tillval
              </label>
            </div>
          </fieldset>
        )
      })}
      {(s.items.some((i) => i.kind === 'excluded') || (purpose === 'contract' && s.contractDetails?.assignment?.exclusions)) && (
        <section className="border-t border-slate-200 py-6">
          <h3 className="text-lg font-semibold">{purpose === 'contract' && s.contractDetails?.assignment ? 'Entreprenörens åtagande omfattar inte' : 'Avgränsningar i åtagandet'}</h3>
          {purpose === 'contract' && s.contractDetails?.assignment?.exclusions && <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{s.contractDetails.assignment.exclusions}</p>}
          {s.items
            .filter((i) => i.kind === 'excluded')
            .map((i) => (
              <div key={i.id} className="mt-4">
                <h4 className="font-semibold">{i.title}</h4>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                  {i.scope}
                </p>
                <ScopeNotes item={i} />
              </div>
            ))}
        </section>
      )}
      {purpose === 'contract' && <CustomerContractDocument value={s.contractDetails} omitParties={Boolean(s.contractParties)} />}
      {purpose === 'contract' && s.paymentPlan && <section className="border-t border-slate-200 py-6">
        <h3 className="text-lg font-semibold">Betalningsplan för grundavtalet</h3>
        <PaymentPlanDocument plan={s.paymentPlan} paymentTerms={s.paymentTerms} showTerms={false} />
      </section>}
      {purpose === 'contract' && <section className="grid gap-6 border-y border-slate-200 py-6 sm:grid-cols-2">
        {[
          ['Tider', s.schedule],
          ['Betalningsvillkor', s.paymentTerms]
        ].map(([title, body]) => (
          <div key={title}>
            <h3 className="font-semibold">{title}</h3>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
              {body || 'Ej angivet'}
            </p>
          </div>
        ))}
      </section>}
      <section className="py-6">
        {purpose === 'contract' && <><h3 className="font-semibold">
          Villkor ·{' '}
          {s.contractForm === 'abs18' ? 'ABS 18' : 'Särskilda villkor'}
        </h3>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
          {s.terms || 'Ej angivet'}
        </p>
        </>}
        {files.length > 0 && (
          <ul className="mt-4 divide-y divide-slate-200">
            {files.map((f) => (
              <li key={f.id}>
                <a
                  href={fileUrl(f.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-h-12 items-center gap-3 py-3 text-sm text-violet-700"
                >
                  <FileText size={18} className="shrink-0" />
                  <span className="min-w-0 flex-1 break-words">
                    {f.fileName}
                    {f.id === s.termsAttachmentId ? ' · Avtalshandling' : ''}
                  </span>
                  <Download size={17} className="shrink-0" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-y border-slate-200 bg-slate-50 p-5">
        <div>
          <p className="text-sm text-slate-600">
            {accepted ? 'Avtalat belopp' : s.items.some((i) => i.kind === 'option') ? 'Grundpris och valda tillval' : purpose === 'offer' ? 'Offertens grundpris' : 'Grundavtalets pris'}
          </p>
          <p className="mt-1 text-2xl font-bold" aria-live="polite">
            {money(accepted ? offer.acceptedTotalOre : total)}
          </p>
          <p className="mt-1 text-sm text-slate-500">Inklusive moms</p>
        </div>
        {accepted && (
          <p className="flex items-start gap-2 text-sm text-emerald-700">
            <Check size={18} className="shrink-0" />
            <span>
              Godkänt av {offer.acceptedBy}
              <br />
              {offer.acceptedAt
                ? new Date(offer.acceptedAt).toLocaleString('sv-SE', {
                    timeZone: 'Europe/Stockholm'
                  })
                : ''}
            </span>
          </p>
        )}
      </footer>
    </article>
  )
}
