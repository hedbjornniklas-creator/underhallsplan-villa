import type { ActionCaseCostLineView } from './contracts'

export type PurchaseListLine = {
  sourceId: string
  description: string
  articleNumber: string
  quantity: string
  unit: string
  unitCost: string
  note: string
}

export type PurchaseListDraft = {
  projectTitle: string
  workTitle: string
  supplier: string
  deliveryAddress: string
  deliveryDate: string
  reference: string
  message: string
  includePrices: boolean
  lines: PurchaseListLine[]
}

export function createPurchaseListDraft(lines: ActionCaseCostLineView[], details: {
  projectTitle?: string; workTitle: string; deliveryAddress?: string
}): PurchaseListDraft {
  return {
    projectTitle: details.projectTitle ?? '', workTitle: details.workTitle,
    supplier: '', deliveryAddress: details.deliveryAddress ?? '', deliveryDate: '', reference: '', message: '', includePrices: false,
    lines: lines.filter(line => line.category === 'material').map(line => ({
      sourceId: line.id, description: line.description, articleNumber: '',
      quantity: line.quantity?.toString() ?? '', unit: line.unit,
      unitCost: line.coveredByQuoteId ? '' : line.unitCost?.toString() ?? '', note: '',
    })),
  }
}

export function purchaseListNumber(value: string): number | null {
  if (!/^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(value.trim())) return null
  const number = Number(value.trim().replace(',', '.'))
  return Number.isFinite(number) && number >= 0 ? number : null
}

export function purchaseListValidation(draft: PurchaseListDraft) {
  const errors: string[] = []
  if (!draft.lines.length) errors.push('Välj minst en produkt.')
  draft.lines.forEach((line, index) => {
    const row = `Rad ${index + 1}`
    if (!line.description.trim()) errors.push(`${row}: ange produkt.`)
    if (!line.unit.trim()) errors.push(`${row}: ange enhet.`)
    if (line.quantity.trim() && purchaseListNumber(line.quantity) === null) errors.push(`${row}: mängden ska vara ett tal som är minst 0.`)
    if (draft.includePrices && line.unitCost.trim() && purchaseListNumber(line.unitCost) === null) errors.push(`${row}: inköpspriset ska vara ett tal som är minst 0.`)
  })
  return {
    errors,
    missingQuantity: draft.lines.filter(line => !line.quantity.trim()).length,
    missingPrice: draft.includePrices ? draft.lines.filter(line => !line.unitCost.trim()).length : 0,
  }
}

const escape = (text: string) => text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[character]!)
const numberFormat = new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 20 })
const moneyFormat = new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK', maximumFractionDigits: 4 })
const numeric = (value: string, money = false) => {
  const number = purchaseListNumber(value)
  return number === null ? '' : escape(money ? moneyFormat.format(number) : numberFormat.format(number))
}

export function purchaseListPrintHtml(draft: PurchaseListDraft, origin: string): string {
  if (purchaseListValidation(draft).errors.length) throw new Error('Kontrollera uppgifterna i beställningslistan.')
  const base = new URL(origin)
  if (!['http:', 'https:'].includes(base.protocol)) throw new Error('Utskriften kunde inte öppnas.')
  const asset = (path: string) => escape(new URL(`/uppdrag/brand/${path}`, base.origin).href)
  const fields = [
    ['Leverantör', draft.supplier], ['Leveransadress', draft.deliveryAddress],
    ['Önskad leverans', draft.deliveryDate], ['Referens / kontakt', draft.reference],
  ].filter(([, value]) => value.trim())
  const table = draft.lines.map((line, index) => `<tr><td class="index">${index + 1}</td><td><strong>${escape(line.description)}</strong>${line.articleNumber.trim() ? `<small>Art.nr ${escape(line.articleNumber)}</small>` : ''}${line.note.trim() ? `<small>${escape(line.note)}</small>` : ''}</td><td class="number">${numeric(line.quantity)}</td><td>${escape(line.unit)}</td>${draft.includePrices ? `<td class="number">${numeric(line.unitCost, true)}</td>` : ''}</tr>`).join('')
  return `<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Beställningslista${draft.projectTitle ? ` - ${escape(draft.projectTitle)}` : ''}</title><style>
    @font-face{font-family:Manrope;src:url("${asset('manrope.ttf')}") format("truetype");font-weight:200 800;font-display:swap}
    *{box-sizing:border-box}body{margin:0;color:#252a2d;background:white;font:10.5pt/1.5 Manrope,Arial,sans-serif;letter-spacing:0}main{max-width:180mm;margin:12mm auto;padding:0 4mm}header{display:flex;justify-content:space-between;align-items:start;gap:16px;border-bottom:3px solid #f2d76a;padding-bottom:14px;margin-bottom:18px}header img{width:108px;height:32px;object-fit:contain;object-position:right}h1{font-size:22pt;line-height:1.2;margin:0 0 8px}p{margin:4px 0;white-space:pre-wrap;overflow-wrap:anywhere}.project{font-size:12pt;font-weight:600}.work{color:#555d60}dl{display:grid;grid-template-columns:1fr 1fr;gap:12px 24px;margin:0 0 20px}dl div{min-width:0}dt{font-size:9pt;color:#555d60}dd{margin:2px 0 0;white-space:pre-wrap;overflow-wrap:anywhere}.message{margin:0 0 18px}.message h2{font-size:10.5pt;margin:0 0 4px}table{width:100%;border-collapse:collapse;table-layout:fixed}thead{display:table-header-group}th{background:#edf1f0;text-align:left;font-weight:600}th,td{padding:9px 10px;border-bottom:1px solid #aeb8b7;vertical-align:top;overflow-wrap:anywhere}tr{break-inside:avoid}th:first-child,td:first-child{width:9mm}th.quantity{width:22mm}th.unit{width:18mm}th.price{width:35mm}.number{text-align:right;font-variant-numeric:tabular-nums}.index{color:#555d60}td strong{font-weight:600}small{display:block;font-size:9pt;margin-top:4px;white-space:pre-wrap}.price-note{margin:12px 0;font-size:9pt;color:#555d60}footer{margin-top:20px;padding-top:10px;border-top:1px solid #c6cecc;font-size:9pt;color:#555d60}@page{size:A4;margin:15mm 14mm}@media print{main{max-width:none;margin:0;padding:0}body{print-color-adjust:exact;-webkit-print-color-adjust:exact}header,dl{break-inside:avoid}}
    table th:first-child,table td:first-child{width:12mm;white-space:nowrap}
  </style></head><body><main><header><div><h1>Beställningslista</h1>${draft.projectTitle.trim() ? `<p class="project">${escape(draft.projectTitle)}</p>` : ''}<p class="work">${escape(draft.workTitle)}</p></div><img src="${asset('logo.svg')}" alt="HusHub"></header>${fields.length ? `<dl>${fields.map(([label, value]) => `<div><dt>${label}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>` : ''}${draft.message.trim() ? `<section class="message"><h2>Meddelande</h2><p>${escape(draft.message)}</p></section>` : ''}<table aria-label="Produkter"><thead><tr><th>Nr</th><th>Produkt / artikelnummer</th><th class="quantity number">Mängd</th><th class="unit">Enhet</th>${draft.includePrices ? '<th class="price number">Inköpspris/enhet exkl. moms</th>' : ''}</tr></thead><tbody>${table}</tbody></table>${draft.includePrices ? '<p class="price-note">Alla inköpspriser anges exklusive moms.</p>' : ''}<footer>${draft.lines.length} ${draft.lines.length === 1 ? 'produkt' : 'produkter'}</footer></main></body></html>`
}

export async function printPurchaseList(draft: PurchaseListDraft, browser: Pick<Window, 'document' | 'location'> = window) {
  const html = purchaseListPrintHtml(draft, browser.location.origin)
  browser.document.querySelectorAll('iframe[data-gizmo-purchase-print]').forEach(frame => frame.remove())
  const frame = browser.document.createElement('iframe')
  frame.dataset.gizmoPurchasePrint = 'true'
  frame.title = 'Utskrift: Beställningslista'
  frame.setAttribute('aria-hidden', 'true')
  frame.tabIndex = -1
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;height:1123px;border:0'
  browser.document.body.appendChild(frame)
  try {
    const preview = frame.contentWindow
    if (!preview) throw new Error('Print frame unavailable')
    preview.addEventListener('afterprint', () => frame.remove(), { once: true })
    preview.document.open()
    preview.document.write(html)
    preview.document.close()
    // Let the local font and logo finish before the browser takes its print snapshot.
    await Promise.all([preview.document.fonts.load('400 14px Manrope'), preview.document.fonts.load('600 14px Manrope'), ...Array.from(preview.document.images, image => image.decode().catch(() => undefined))])
    if (!frame.isConnected) return
    preview.focus()
    preview.print()
  } catch {
    frame.remove()
    throw new Error('Utskriften kunde inte öppnas. Dina uppgifter finns kvar, försök igen.')
  }
}
