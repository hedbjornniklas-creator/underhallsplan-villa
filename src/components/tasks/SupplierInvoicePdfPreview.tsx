'use client'
import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Minus, MoveHorizontal, Plus, RefreshCw } from 'lucide-react'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import './supplier-invoice-pdf-preview.css'

type Source = File | string
const MAX_BYTES = 4 * 1024 * 1024
async function pdfBytes(source: Source, signal: AbortSignal) {
  if (typeof source !== 'string') {
    if (source.size > MAX_BYTES) throw Error('SIZE')
    return new Uint8Array(await source.arrayBuffer())
  }
  const response = await fetch(source, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]), referrerPolicy: 'no-referrer' })
  if (!response.ok) throw Error(response.status === 401 || response.status === 403 ? 'AUTH' : 'FETCH')
  const reader = response.body?.getReader()
  if (!reader) throw Error('FETCH')
  const chunks: Uint8Array[] = []; let length = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.length
      if (length > MAX_BYTES) throw Error('SIZE')
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => undefined) }
  const result = new Uint8Array(length); let offset = 0
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length }
  return result
}

export default function SupplierInvoicePdfPreview({ source }: { source: Source }) {
  const [loaded, setLoaded] = useState<{ source: Source; document: PDFDocumentProxy } | null>(null)
  const [page, setPage] = useState(1), [zoom, setZoom] = useState(1), [width, setWidth] = useState(0), [retry, setRetry] = useState(0)
  const [error, setError] = useState(''), [rendered, setRendered] = useState(false), [pageText, setPageText] = useState('')
  const [passwordRequest, setPasswordRequest] = useState<{ source: Source; incorrect: boolean } | null>(null), [password, setPassword] = useState('')
  const providePassword = useRef<((password: string) => void) | null>(null), viewport = useRef<HTMLDivElement>(null), paper = useRef<HTMLDivElement>(null)
  const document = loaded?.source === source ? loaded.document : null

  useEffect(() => {
    const root = viewport.current
    if (!root) return
    const observer = new ResizeObserver(() => setWidth(root.clientWidth))
    observer.observe(root); setWidth(root.clientWidth)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const controller = new AbortController(); let stopped = false, task: PDFDocumentLoadingTask | undefined
    async function load() {
      setLoaded(null); setError(''); setPage(1); setZoom(1); setRendered(false); setPageText(''); setPasswordRequest(null); setPassword('')
      try {
        const bytes = await pdfBytes(source, controller.signal), pdf = await import('pdfjs-dist')
        if (stopped) return
        const assets = new URL(`/vendor/pdfjs/${pdf.version}/`, window.location.origin).href
        pdf.GlobalWorkerOptions.workerSrc = assets + 'pdf.worker.min.mjs'
        task = pdf.getDocument({ data: bytes, cMapUrl: assets + 'cmaps/', cMapPacked: true, standardFontDataUrl: assets + 'standard_fonts/', wasmUrl: assets + 'wasm/', iccUrl: assets + 'iccs/',
          disableWorkerRendering: true, enableXfa: false, canvasMaxAreaInBytes: 32 * 1024 * 1024 })
        task.onPassword = (update: (password: string) => void, reason: number) => {
          if (stopped) return
          providePassword.current = update; setPassword(''); setPasswordRequest({ source, incorrect: reason === pdf.PasswordResponses.INCORRECT_PASSWORD })
        }
        const result = await task.promise
        if (!stopped) { setPasswordRequest(null); providePassword.current = null; setLoaded({ source, document: result }) }
      } catch (e) {
        if (!stopped) setError((e as Error).message === 'AUTH' ? 'Logga in igen för att visa originalet.' : 'PDF:en kunde inte visas. Försök igen eller öppna originalet i en ny flik.')
      }
    }
    void load()
    return () => { stopped = true; controller.abort(); providePassword.current = null; void task?.destroy().catch(() => undefined) }
  }, [source, retry])
  useEffect(() => {
    const root = paper.current
    if (!document || !root || width < 32) return
    let stopped = false, task: RenderTask | undefined
    const canvas = window.document.createElement('canvas')
    canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', `Fakturans original-PDF, sida ${page} av ${document.numPages}`)
    root.replaceChildren(canvas)
    async function render() {
      setRendered(false); setError(''); setPageText('')
      try {
        const pdfPage = await document!.getPage(page)
        if (stopped) return
        const base = pdfPage.getViewport({ scale: 1 })
        if (!Number.isFinite(base.width + base.height) || base.width <= 0 || base.height <= 0) throw Error('SIZE')
        const scale = Math.min((width - 18) / base.width * zoom, 8192 / base.width, 8192 / base.height)
        const area = pdfPage.getViewport({ scale })
        const pixels = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(8_000_000 / (area.width * area.height)))
        canvas.width = Math.max(1, Math.floor(area.width * pixels)); canvas.height = Math.max(1, Math.floor(area.height * pixels))
        canvas.style.width = `${Math.floor(area.width)}px`; canvas.style.height = `${Math.floor(area.height)}px`
        task = pdfPage.render({ canvas, viewport: area, transform: [pixels, 0, 0, pixels, 0, 0] })
        await task.promise
        if (stopped) return
        setRendered(true)
        const text = await pdfPage.getTextContent()
        if (!stopped) setPageText(text.items.flatMap(item => 'str' in item ? [item.str] : []).join(' ').slice(0, 50000))
      } catch {
        if (!stopped) { canvas.width = 1; canvas.height = 1; setError('Sidan kunde inte visas. Försök igen eller öppna originalet i en ny flik.') }
      }
    }
    void render()
    return () => { stopped = true; task?.cancel(); canvas.width = 1; canvas.height = 1; canvas.remove() }
  }, [document, page, zoom, width])

  const protectedPdf = passwordRequest?.source === source
  return <section className="supplier-pdf-preview" aria-label="Fakturans original-PDF" aria-busy={!error && !protectedPdf && !rendered}>
    <div className="supplier-pdf-toolbar" role="group" aria-label="PDF-kontroller">
      <button type="button" className="gizmo-text-button" title="Föregående sida" aria-label="Föregående PDF-sida" disabled={!document || page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft size={17} /></button>
      <span className="supplier-pdf-counter" aria-live="polite">{document ? `${page} / ${document.numPages}` : '– / –'}</span>
      <button type="button" className="gizmo-text-button" title="Nästa sida" aria-label="Nästa PDF-sida" disabled={!document || page >= document.numPages} onClick={() => setPage(p => p + 1)}><ChevronRight size={17} /></button>
      <span className="supplier-pdf-tools-gap" />
      <button type="button" className="gizmo-text-button" title="Zooma ut" aria-label="Zooma ut PDF" disabled={!document || zoom <= .5} onClick={() => setZoom(z => Math.max(.5, z - .25))}><Minus size={16} /></button>
      <span className="supplier-pdf-zoom">{Math.round(zoom * 100)} %</span>
      <button type="button" className="gizmo-text-button" title="Zooma in" aria-label="Zooma in PDF" disabled={!document || zoom >= 3} onClick={() => setZoom(z => Math.min(3, z + .25))}><Plus size={16} /></button>
      <button type="button" className="gizmo-text-button" title="Anpassa till bredden" aria-label="Anpassa PDF till bredden" disabled={!document} onClick={() => setZoom(1)}><MoveHorizontal size={17} /></button>
    </div>
    <div className="supplier-pdf-viewport" ref={viewport}>
      <div className="supplier-pdf-paper" ref={paper} hidden={!document || !!error || protectedPdf} />
      {!error && !protectedPdf && !rendered && <p className="supplier-pdf-message" role="status">Läser PDF…</p>}
      {error && <div className="supplier-pdf-message" role="alert"><p>{error}</p><button type="button" className="gizmo-text-button" onClick={() => setRetry(n => n + 1)}><RefreshCw size={16} />Försök igen</button></div>}
      {protectedPdf && <form className="supplier-pdf-message" onSubmit={e => { e.preventDefault(); providePassword.current?.(password); setPasswordRequest(null); setPassword('') }}><label htmlFor="supplier-pdf-password">{passwordRequest.incorrect ? 'Fel lösenord. Försök igen.' : 'PDF:en är lösenordsskyddad.'}</label><input id="supplier-pdf-password" type="password" value={password} autoComplete="off" onChange={e => setPassword(e.target.value)} /><button type="submit" className="gizmo-button" disabled={!password}>Öppna PDF</button></form>}
    </div>
    {pageText && <p className="sr-only" aria-label={`Text på PDF-sida ${page}`}>{pageText}</p>}
  </section>
}
