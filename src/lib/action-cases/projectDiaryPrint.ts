const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]!)
export function diaryQrPrintHtml(title: string, url: string, dataUrl: string, origin: string) {
  const link = new URL(url), base = new URL(origin)
  if (!['https:', 'http:'].includes(link.protocol) || !['https:', 'http:'].includes(base.protocol) || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) throw new Error('QR-utskriften kunde inte öppnas.')
  return `<!doctype html><html lang="sv"><head><meta charset="utf-8"><title>Dagbok - ${escape(title)}</title><meta name="referrer" content="no-referrer"><style>@page{size:A4;margin:20mm}*{box-sizing:border-box}body{font:14pt/1.5 Arial,sans-serif;color:#252a2d;letter-spacing:0}header{border-bottom:4px solid #f2d76a;padding-bottom:15mm}header img{width:45mm}h1{font-size:28pt;margin:12mm 0 3mm}h2{font-size:18pt;margin:0;overflow-wrap:anywhere}main{text-align:center}main img{width:120mm;height:120mm;max-width:100%;image-rendering:pixelated}p{margin:6mm 0}.url{font-size:8pt;overflow-wrap:anywhere}</style></head><body><header><img src="${escape(new URL('/uppdrag/brand/logo.svg', base).href)}" alt="HusHub Uppdrag"><h1>Dagbok på arbetsplatsen</h1><h2>${escape(title)}</h2></header><main><p>Skanna QR-koden för att lämna dagens anteckning och bilder.</p><img src="${dataUrl}" alt="QR-kod till projektets dagbok"><p class="url">${escape(link.href)}</p></main></body></html>`
}
export async function printDiaryQr(title: string, url: string, dataUrl: string) {
  const html = diaryQrPrintHtml(title, url, dataUrl, window.location.origin), frame = document.createElement('iframe')
  frame.title = 'Utskrift: Dagbokens QR-kod'; frame.setAttribute('aria-hidden', 'true'); frame.tabIndex = -1
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;height:1123px;border:0'
  document.body.appendChild(frame)
  try {
    const preview = frame.contentWindow
    if (!preview) throw new Error()
    preview.addEventListener('afterprint', () => frame.remove(), { once: true })
    preview.document.open(); preview.document.write(html); preview.document.close()
    await Promise.all(Array.from(preview.document.images, image => image.decode()))
    if (frame.isConnected) { preview.focus(); preview.print() }
  } catch { frame.remove(); throw new Error('QR-utskriften kunde inte öppnas. Försök igen.') }
}
