'use client'

import { Check, Copy, Download, History, LoaderCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { formatObDeliveryDate, mergeObDeliveryEvents, obDeliveryEventTitle, obReportVersionPdfHref,
  type ObDeliveryEvent, type ObDeliveryTimeline } from '@/lib/ob/reportDeliveryHistory'

export function ObCopyReportLink({ url, disabled = false }: { url: string | null; disabled?: boolean }) {
  const [copied, setCopied] = useState(false)
  const [manual, setManual] = useState(false)
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => { setCopied(false); setManual(false) }, [url])
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 3000); return () => clearTimeout(timer) }, [copied])
  async function copy() {
    if (!url) return
    setCopied(false)
    try {
      // The URL is already loaded: no network await may consume Safari's user gesture.
      if (!navigator.clipboard?.writeText) throw Error('CLIPBOARD_UNAVAILABLE')
      await navigator.clipboard.writeText(url)
      setCopied(true); setManual(false)
    } catch { setManual(true) }
  }
  return <div className="ob-copy-report">
    <button type="button" className="ob-delivery-secondary" onClick={() => void copy()} disabled={disabled || !url}
      title="Kopiera kundlänk till det publicerade utlåtandet">
      {copied ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}Kopiera länk
    </button>
    <span className="ob-copy-feedback" role="status">{copied ? 'Länk kopierad' : ''}</span>
    {manual && url && <label className="ob-copy-manual">
      <span>Automatisk kopiering nekades. Kundlänk</span>
      <input ref={field} readOnly type="url" aria-label="Kundlänk" value={url}
        onFocus={event => event.currentTarget.select()} onClick={event => event.currentTarget.select()} />
    </label>}
  </div>
}

export function ObReportDeliveryOverview({ timeline, lockedAt, completed, published, pdfStatus, loading }: {
  timeline: ObDeliveryTimeline | null; lockedAt: string | null; completed: boolean;
  published: boolean; pdfStatus: string; loading: boolean;
}) {
  const overview = timeline?.overview
  const when = (value?: string | null) => formatObDeliveryDate(value)
  return <section className="ob-delivery-overview" aria-label="Utlåtandets läge">
    <dl>
      <div><dt>Redigering</dt><dd>{loading ? 'Läser...' : lockedAt ? 'Låst' : 'Öppen för ändringar'}</dd>
        <dd className="ob-form-muted">{lockedAt ? `Sedan ${when(lockedAt)}` : completed ? 'Tidigare klarmarkerad' : 'Pågående besiktning'}</dd></div>
      <div><dt>Publicerat utlåtande</dt><dd>{loading ? 'Läser...' : overview?.reportId
        ? `Version ${overview.version}` : published ? 'Publicerat' : 'Inte publicerat'}</dd>
        <dd className="ob-form-muted">{overview?.publishedAt ? when(overview.publishedAt) : published ? 'Publiceringsdatum kunde inte hämtas' : '-'}</dd></div>
      <div><dt>Senaste registrerade utskick</dt><dd>{loading ? 'Läser...' : overview?.lastSentAt ? when(overview.lastSentAt)
        : !timeline || overview?.historyIncomplete ? 'Kan inte fastställas' : 'Inget utskick registrerat'}</dd>
        <dd className="ob-form-muted">{overview?.lastRecipients.length ? overview.lastRecipients.map((email, index) => {
          const at = email.lastIndexOf('@')
          return <span key={email}>{index > 0 && ', '}{at < 0 ? email : <>{email.slice(0, at + 1)}<wbr />{email.slice(at + 1)}</>}</span>
        }) : '-'}</dd></div>
      <div><dt>PDF</dt><dd>{!published ? 'Ingen publicerad PDF' : pdfStatus === 'ready' ? 'Klar'
        : pdfStatus === 'failed' ? 'Kunde inte skapas' : 'Förbereds'}</dd>
        <dd className="ob-form-muted">{published ? 'Till publicerad version' : '-'}</dd></div>
    </dl>
  </section>
}

export function ObReportDeliveryHistory({ inspectionId, timeline, error }: {
  inspectionId: string; timeline: ObDeliveryTimeline | null; error?: string | null;
}) {
  const [entries, setEntries] = useState<ObDeliveryEvent[]>(timeline?.entries ?? [])
  const [cursor, setCursor] = useState(timeline?.nextCursor ?? null)
  const [busy, setBusy] = useState(false)
  const [pageError, setPageError] = useState('')
  const pageState = useRef({ inspectionId, loadedOlder: false })
  useEffect(() => {
    if (pageState.current.inspectionId !== inspectionId) {
      pageState.current = { inspectionId, loadedOlder: false }
      setEntries(timeline?.entries ?? [])
      setCursor(timeline?.nextCursor ?? null)
      setPageError('')
      return
    }
    if (!timeline) return
    setEntries(current => mergeObDeliveryEvents(current, timeline?.entries ?? []))
    if (!pageState.current.loadedOlder) setCursor(timeline.nextCursor)
  }, [inspectionId, timeline])
  async function older() {
    if (!cursor || busy) return
    setBusy(true); setPageError('')
    try {
      const response = await fetch(`/api/ob/inspections/${inspectionId}/report-delivery/history?cursor=${encodeURIComponent(cursor)}`, { cache: 'no-store' })
      const result = await response.json()
      if (!response.ok || !Array.isArray(result.entries)) throw Error('Äldre händelser kunde inte hämtas.')
      pageState.current.loadedOlder = true
      setEntries(current => mergeObDeliveryEvents(current, result.entries)); setCursor(result.nextCursor)
    } catch (failure) { setPageError(failure instanceof Error ? failure.message : 'Historiken kunde inte hämtas.') }
    finally { setBusy(false) }
  }
  return <section className="ob-delivery-section ob-delivery-history" aria-label="Utlåtandets historik">
    <h3><History size={18} aria-hidden="true" />Historik</h3>
    {error && <p role="alert" className="ob-delivery-warning">{error}</p>}
    {timeline?.overview.historyIncomplete && <p className="ob-delivery-warning">Äldre utskick utan säker koppling till besiktningen kan saknas. En tom historik betyder då inte att utlåtandet är oskickat.</p>}
    {!entries.length && timeline && <p className="ob-form-muted">Inga registrerade händelser.</p>}
    <ol className="ob-delivery-timeline">
      {entries.map(event => <li key={event.id} className={event.status === 'failed' ? 'ob-event-failed' : undefined}>
        <time dateTime={event.occurred_at}>{formatObDeliveryDate(event.occurred_at, true)}</time>
        <div><strong>{obDeliveryEventTitle(event)}</strong>
          <div className="ob-event-detail">{event.version != null && <span>Version {event.version}</span>}
            {event.recipient_email && <span>{event.recipient_email}</span>}{event.actor_name && <span>{event.actor_name}</span>}
            {event.detail && <span>{event.detail}</span>}
            {event.report_active === false && <span>Ersatt eller återkallad kundlänk</span>}
          </div>
        </div>
        {event.type === 'pdf_ready' && event.report_active === false && event.report_id && <a className="ob-delivery-link" target="_blank" rel="noreferrer"
          href={obReportVersionPdfHref(inspectionId, event.report_id)} title={`Hämta PDF för version ${event.version}`}>
          <Download size={17} aria-hidden="true" /><span>PDF</span>
        </a>}
      </li>)}
    </ol>
    {pageError && <p role="alert">{pageError}</p>}
    {cursor && <button type="button" className="ob-delivery-secondary" disabled={busy} onClick={() => void older()}>
      {busy && <LoaderCircle size={17} aria-hidden="true" />}Visa äldre
    </button>}
  </section>
}
