'use client'

import { Check, Download, FileText } from 'lucide-react'
import {
  customerOfferTotal,
  money,
  type CustomerOffer
} from '@/lib/action-cases/customerOffers'

export default function CustomerOfferDocument({
  offer,
  selected,
  onSelect,
  fileUrl,
  readOnly = false
}: {
  offer: CustomerOffer
  selected: string[]
  onSelect?: (ids: string[]) => void
  fileUrl: (fileId: string) => string
  readOnly?: boolean
}) {
  const s = offer.snapshot,
    accepted = offer.status === 'accepted'
  const selection = accepted
    ? offer.acceptedOptionIds
    : selected.filter((id) =>
        s.items.some(
          (i) => i.id === id && i.kind === 'option' && i.amountOre !== null
        )
      )
  const total =
    s.baseAmountOre === null ? null : customerOfferTotal(s, selection)
  return (
    <article className="min-w-0 break-words bg-white" aria-label="Kundoffert">
      <header className="border-b border-slate-200 py-6">
        <p className="text-sm text-slate-500">
          {accepted ? 'Godkänt avtal' : 'Offert'} · Version{' '}
          {offer.version || 'utkast'}
        </p>
        <h2 className="mt-2 text-2xl font-semibold">
          {s.title || 'Offertutkast'}
        </h2>
        <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">Beställare</dt>
            <dd className="mt-1 font-semibold">{s.customerName}</dd>
            <dd className="break-all text-slate-600">{s.customerEmail}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Entreprenör</dt>
            <dd className="mt-1 font-semibold">{s.issuerName}</dd>
            <dd className="break-all text-slate-600">{s.replyEmail}</dd>
          </div>
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
      <section className="py-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h3 className="text-lg font-semibold">Grundåtagande</h3>
          <strong className="text-xl">{money(s.baseAmountOre)}</strong>
        </div>
        <p className="mt-1 text-sm text-slate-500">Fast pris inklusive moms</p>
        {s.items
          .filter((i) => i.kind === 'included')
          .map((i) => (
            <div className="mt-5 border-t border-slate-100 pt-4" key={i.id}>
              <h4 className="font-semibold">{i.title}</h4>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                {i.scope}
              </p>
            </div>
          ))}
      </section>
      {s.items.some((i) => i.kind === 'option') && (
        <section className="border-t border-slate-200 py-6">
          <h3 className="text-lg font-semibold">Tillval</h3>
          <div className="mt-3 divide-y divide-slate-200">
            {s.items
              .filter((i) => i.kind === 'option')
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
                          ? [...selection, i.id]
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
                  </span>
                </label>
              ))}
          </div>
        </section>
      )}
      {s.items.some((i) => i.kind === 'excluded') && (
        <section className="border-t border-slate-200 py-6">
          <h3 className="text-lg font-semibold">Utanför vårt åtagande</h3>
          {s.items
            .filter((i) => i.kind === 'excluded')
            .map((i) => (
              <div key={i.id} className="mt-4">
                <h4 className="font-semibold">{i.title}</h4>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                  {i.scope}
                </p>
              </div>
            ))}
        </section>
      )}
      <section className="grid gap-6 border-y border-slate-200 py-6 sm:grid-cols-2">
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
      </section>
      <section className="py-6">
        <h3 className="font-semibold">
          Villkor ·{' '}
          {s.contractForm === 'abs18' ? 'ABS 18' : 'Särskilda villkor'}
        </h3>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
          {s.terms || 'Ej angivet'}
        </p>
        {offer.files.length > 0 && (
          <ul className="mt-4 divide-y divide-slate-200">
            {offer.files.map((f) => (
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
            {accepted ? 'Avtalat belopp' : 'Grundpris och valda tillval'}
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
