import { DIARY_MAX_PHOTOS, DIARY_MAX_PHOTO_BYTES } from './projectDiary'

const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]!)
export function diaryQrPrintHtml(title: string, url: string, dataUrl: string, origin: string) {
  const link = new URL(url), base = new URL(origin)
  if (!['https:', 'http:'].includes(link.protocol) || !['https:', 'http:'].includes(base.protocol) || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) throw new Error('QR-utskriften kunde inte öppnas.')
  return `<!doctype html><html lang="sv"><head><meta charset="utf-8"><title>Dagbok - ${escape(title)}</title><meta name="referrer" content="no-referrer"><style>
@page{size:A4;margin:20mm}*{box-sizing:border-box}body{margin:0;font:13pt/1.45 Arial,sans-serif;color:#252a2d;letter-spacing:0}
header{border-bottom:3px solid #f2d76a;padding-bottom:7mm}h1{font-size:26pt;line-height:1.2;margin:0 0 4mm}h2{font-size:17pt;line-height:1.3;font-weight:400;margin:0;overflow-wrap:anywhere}
main{text-align:center}main>p{font-size:17pt;margin:7mm 0 3mm}main img{display:block;width:110mm;height:110mm;max-width:100%;object-fit:contain;margin:0 auto;image-rendering:pixelated}
ol{text-align:left;padding-left:7mm;margin:5mm 0 0}li{padding-left:2mm;margin:3mm 0}footer{border-top:1px solid #c8d0d0;margin-top:7mm;padding-top:4mm;font-size:11pt;text-align:center}
@media screen{body{max-width:170mm;margin:20mm auto;padding:0 4mm}}@media print{header,main,footer{break-inside:avoid}}
</style></head><body><header><h1>Dagbok på arbetsplatsen</h1><h2>${escape(title)}</h2></header><main><p>Skanna koden med mobilkameran</p><img src="${dataUrl}" alt="QR-kod till projektets dagbok"><ol><li>Välj ditt namn och företag, eller lägg till dig.</li><li>Ange datum. Ungefärlig tid på plats är valfri.</li><li>Beskriv kort vad du har gjort och bifoga gärna bilder.</li><li>Tryck på ”Skicka anteckning” och vänta på kvittot.</li></ol></main><footer>Högst ${DIARY_MAX_PHOTOS} bilder per anteckning · ${DIARY_MAX_PHOTO_BYTES / (1024 * 1024)} MB per bild<br>JPG, PNG eller WebP</footer></body></html>`
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
