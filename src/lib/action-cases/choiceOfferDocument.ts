// @ts-expect-error Shared with the Node strip-types test runner.
import { choiceOfferForEditing, choiceTimeText } from './choiceOffer.ts'
// @ts-expect-error Shared with the Node strip-types test runner.
import { contractFixedAmount, contractFixedRows, contractRowAmount } from './contractPricing.ts'
import type { CustomerPlannedItem } from './customerPlanning'

export type ChoiceDocumentSection = { title: string; paragraphs?: string[]; headers?: string[]; rows?: string[][] }
export const choiceMoney = (ore: number | null) => ore === null ? 'Inte fastställt' : new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK' }).format(ore / 100)

// Explicit public projection: never copy the private worksheet into a customer document.
export function choiceOfferSections(item: CustomerPlannedItem): ChoiceDocumentSection[] {
  const offer = choiceOfferForEditing(item), p = offer.pricing
  const sections: ChoiceDocumentSection[] = []
  if (offer.conditions) sections.push({ title: 'Förutsättningar', paragraphs: [offer.conditions] })
  if (offer.exclusions) sections.push({ title: 'Ingår inte', paragraphs: [offer.exclusions] })
  if (offer.priceNeutral) sections.push({ title: 'Pris', paragraphs: ['Ingår utan prisändring.'] })
  else {
    if (p.mode !== 'running') {
      const fixedRows = contractFixedRows(p)
      const headers = p.display === 'priced' ? p.split === 'separate' ? ['Moment', 'Arbete inkl. moms', 'Material inkl. moms', 'Summa inkl. moms'] : ['Moment', 'Pris inkl. moms'] : ['Moment']
      const rows = p.display === 'total' ? [] : fixedRows.map(row => p.display !== 'priced' ? [row.title] : p.split === 'separate'
        ? [row.title, choiceMoney(row.labourOre), choiceMoney(row.materialOre), choiceMoney(contractRowAmount(p, row))] : [row.title, choiceMoney(contractRowAmount(p, row))])
      const paragraphs = [`${p.mode === 'mixed' ? 'Fast del' : 'Fast pris'} inklusive moms: ${choiceMoney(contractFixedAmount(p))}.`]
      if (p.split === 'separate' && p.basis === 'total') paragraphs.push(`Arbete: ${choiceMoney(p.labourOre)}. Material: ${choiceMoney(p.materialOre)}. Beloppen inkluderar moms.`)
      sections.push({ title: p.mode === 'mixed' ? 'Fast del' : 'Fast pris', paragraphs, ...(rows.length ? { headers, rows } : {}) })
    }
    if (p.mode !== 'fixed') {
      const r = p.running
      sections.push({ title: 'Löpande räkning', paragraphs: [
        `Arbete: ${choiceMoney(r.hourlyOre)} per timme inklusive entreprenörarvode och moms.`,
        `Arbetsledning: ${choiceMoney(r.managementOre ?? r.hourlyOre)} per timme inklusive entreprenörarvode och moms.`,
        `Material, varor, hjälpmedel, underentreprenörer och övriga kostnader debiteras till självkostnad med ${r.markupPercent === null ? 'ett ännu inte fastställt' : `${r.markupPercent.toLocaleString('sv-SE')} %`} påslag. Moms tillkommer på självkostnad och påslag.`,
        ...(r.approximateOre === null ? [] : [`Ungefärligt pris för den löpande delen inklusive moms: ${choiceMoney(r.approximateOre)}. Detta är inte ett fast pris.`]),
      ], ...(p.rows.some(row => p.mode === 'running' || row.kind === 'running') ? { headers: ['Moment på löpande räkning'], rows: p.rows.filter(row => p.mode === 'running' || row.kind === 'running').map(row => [row.title]) } : {}) })
    }
  }
  sections.push({ title: 'Tidspåverkan', paragraphs: [choiceTimeText(offer.time)] })
  return sections
}
