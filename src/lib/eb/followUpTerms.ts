import { EB_FOLLOW_UP_PRICE_ORE, EB_FOLLOW_UP_SERVICE_DESCRIPTION, EB_FOLLOW_UP_TERMS_VERSION, type EbFollowUpSeller } from './followUp'

export const EB_FOLLOW_UP_WITHDRAWAL_FORM_URL = 'https://publikationer.konsumentverket.se/mallar-och-blanketter/angerblankett'
type CustomerType = 'consumer' | 'business'
const money = (ore: number) => `${(ore / 100).toLocaleString('sv-SE', { maximumFractionDigits: 2 })} kr inkl. moms`

/** The same wording is shown before ordering and archived in the order/receipt. */
export function getEbFollowUpConsentTexts(customerType: CustomerType, priceOre = EB_FOLLOW_UP_PRICE_ORE) {
  return {
    acceptTerms: 'Jag har läst och godkänner tjänstens omfattning och köpvillkor.',
    requestImmediateStart: customerType === 'consumer'
      ? 'Jag begär uttryckligen att tjänsten aktiveras och börjar tillhandahållas direkt, innan ångerfristen på 14 dagar har löpt ut. Jag har tagit del av informationen om eventuell proportionell ersättning för det som tillhandahållits om jag ångrar köpet. Aktiveringen i sig tar inte bort min ångerrätt.'
      : 'Jag begär att tjänsten aktiveras och börjar tillhandahållas direkt.',
    acceptInvoice: `Jag godkänner betalningsskyldigheten på ${money(priceOre)} mot faktura och har rätt att beställa för angiven fakturamottagare.`,
    ...(customerType === 'consumer' ? { consumerWithdrawalAcknowledged: 'Jag har tagit del av informationen om 14 dagars ångerrätt, hur jag ångrar beställningen och ångerblanketten.' } : {}),
  }
}

export function getEbFollowUpTermsText({ seller, customerType, priceOre = EB_FOLLOW_UP_PRICE_ORE }: {
  seller: EbFollowUpSeller; customerType: CustomerType; priceOre?: number
}) {
  return [
    `Köpvillkor – Digital åtgärdsuppföljning\nVersion ${EB_FOLLOW_UP_TERMS_VERSION}`,
    `Säljare\n${seller.name}, org.nr ${seller.orgNumber}\n${seller.address}\nE-post: ${seller.email}${seller.phone ? `\nTelefon: ${seller.phone}` : ''}`,
    `Omfattning\n${EB_FOLLOW_UP_SERVICE_DESCRIPTION}\nTillvalet gäller endast denna besiktning. Entreprenörens avbockning är inte besiktningsmannens godkännande. Utlåtandet kan läsas även utan tillvalet.`,
    `Pris och beställning\nEngångspriset är ${money(priceOre)} (25 % moms). Beställningen medför betalningsskyldighet. Fakturering hanteras manuellt; beställningsbekräftelsen är inte en faktura. Fakturans betalningsuppgifter skickas separat. Inga återkommande avgifter debiteras för detta köp.`,
    'Tillgång till tjänsten\nTjänsten aktiveras när beställningen har godkänts och sparats. Uppföljningen är knuten till besiktningen och förnyas inte som ett nytt köp när en personlig åtkomstlänk förnyas. Du använder tjänsten i en aktuell webbläsare med internetanslutning. Håll din beställarlänk privat; bjud in entreprenörer med deras egna begränsade länkar.',
    customerType === 'consumer'
      ? `Ångerrätt för privatkund\nDu har rätt att ångra köpet utan att ange skäl inom 14 dagar från avtalets ingående. Ångerfristen börjar inte löpa innan du fått föreskriven information om ångerrätten. Beräknad sista ångerdag anges i bekräftelsen; om slutdagen infaller på en helgdag eller motsvarande fridag förlängs fristen till nästa vardag.\nDu kan använda funktionen ”Ångra beställningen” i din personliga åtgärdsportal eller skicka ett tydligt meddelande till ${seller.email} eller säljarens postadress ovan. Det räcker att du skickar meddelandet innan fristen löpt ut. Ange gärna namn och beställningsnummer. Du kan använda standardblanketten, men det är inget krav: ${EB_FOLLOW_UP_WITHDRAWAL_FORM_URL}\nOm du uttryckligen begär start under ångerfristen kan du vid frånträdande behöva betala en skälig och proportionell del för det som faktiskt har tillhandahållits fram till ditt meddelande, om lagens förutsättningar är uppfyllda. Aktivering är inte i sig ett fullgörande av hela tjänsten och innebär inte att ångerrätten upphör.\nNär du frånträder beställningen stoppas fortsatt användning och faktureringen pausas för handläggning. Eventuell återbetalning hanteras utan onödigt dröjsmål, senast 14 dagar efter mottaget meddelande, med samma betalningssätt om ni inte uttryckligen kommer överens om annat. Ingen återbetalningsavgift tas ut.`
      : 'Köp för företag eller förening\nDen lagstadgade ångerrätten för konsumenter gäller inte köp för företag eller förening. Kontakta säljaren om du vill begära att beställningen avslutas.',
    `Frågor och reklamation\nKontakta ${seller.email} vid problem med tjänsten, faktureringen eller om du vill avsluta tillgången. Dina tvingande rättigheter som konsument begränsas inte av dessa villkor.${customerType === 'consumer' ? ' Om en tvist inte kan lösas kan du vända dig till Allmänna reklamationsnämnden, www.arn.se, när dess prövningskrav är uppfyllda.' : ''}`,
  ].join('\n\n')
}

/** A durable, service-adapted form is also included directly in the receipt. */
export function getEbFollowUpWithdrawalFormText(seller: EbFollowUpSeller) {
  return `Ångerblankett – fyll i och skicka endast om du vill frånträda avtalet\nTill: ${seller.name}, ${seller.address}, ${seller.email}\nJag/vi meddelar härmed att jag/vi frånträder mitt/vårt avtal avseende följande tjänst: Digital åtgärdsuppföljning.\nBeställningsnummer: ____________________\nBeställdes den: ____________________\nKonsumentens/konsumenternas namn: ____________________\nKonsumentens/konsumenternas adress: ____________________\nDatum: ____________________\nUnderskrift (endast om blanketten skickas på papper): ____________________\nStryk det som inte gäller. Du kan också använda Konsumentverkets standardblankett: ${EB_FOLLOW_UP_WITHDRAWAL_FORM_URL}`
}

function easterSunday(year: number) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451)
  const n = h + l - 7 * m + 114
  return new Date(Date.UTC(year, Math.floor(n / 31) - 1, n % 31 + 1))
}

function isNonBusinessDay(date: Date) {
  const day = date.getUTCDay(), month = date.getUTCMonth() + 1, dateOfMonth = date.getUTCDate()
  if (day === 0 || day === 6) return true
  if (['1-1', '1-6', '5-1', '6-6', '12-24', '12-25', '12-26', '12-31'].includes(`${month}-${dateOfMonth}`)) return true
  if (month === 6 && day === 5 && dateOfMonth >= 19 && dateOfMonth <= 25) return true
  const sinceEaster = Math.round((date.getTime() - easterSunday(date.getUTCFullYear()).getTime()) / 86400_000)
  return [-2, 1, 39].includes(sinceEaster)
}

/** Calendar days in Sweden, including DST and statutory last-day extensions. Never used to reject late notices. */
export function getEbFollowUpWithdrawalDeadline(acceptedAt: string) {
  const instant = new Date(acceptedAt)
  if (!Number.isFinite(instant.getTime())) throw new Error('EB_FOLLOW_UP_ACCEPTANCE_TIME_INVALID')
  const localDay = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant)
  const date = new Date(`${localDay}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + 14)
  while (isNonBusinessDay(date)) date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}
