import React from 'react'
import { Document, Page, StyleSheet, Text, View, renderToBuffer, type DocumentProps, type TextProps } from '@react-pdf/renderer'
import type { EbFollowUpConfirmation } from './followUpConfirmation'

// Same local A4 / Helvetica / react-pdf approach as acceptedConfirmationPdf.
// No browser, remote assets or live order/terms lookups are needed by the worker.
const h = React.createElement
const styles = StyleSheet.create({
  page: { paddingTop: 30, paddingBottom: 52, paddingHorizontal: 40, fontFamily: 'Helvetica', fontSize: 10, lineHeight: 1.4, color: '#172033' },
  header: { color: '#597166', fontSize: 8, marginBottom: 18, letterSpacing: 0.6 },
  hero: { backgroundColor: '#edf6f1', borderLeftWidth: 4, borderLeftColor: '#397b5d', padding: 16, marginBottom: 16 },
  title: { fontSize: 23, lineHeight: 1.25, fontWeight: 700, color: '#24543f', marginBottom: 8 },
  subtitle: { fontSize: 12, lineHeight: 1.4, color: '#365648' },
  heading: { fontSize: 12, fontWeight: 700, color: '#24543f', marginBottom: 7, marginTop: 13 },
  row: { flexDirection: 'row', paddingVertical: 4, borderBottomWidth: 0.5, borderBottomColor: '#e1e7e4' },
  label: { width: '32%', paddingRight: 12, color: '#52645d', fontSize: 9 },
  value: { width: '68%' },
  total: { fontSize: 13, fontWeight: 700, color: '#24543f' },
  paragraph: { marginBottom: 8 },
  muted: { fontSize: 9, color: '#52645d', marginTop: 9 },
  consent: { flexDirection: 'row', marginBottom: 12 },
  number: { width: 25, fontWeight: 700, color: '#397b5d' },
  consentText: { flex: 1 },
  info: { backgroundColor: '#f5f8f6', padding: 13, marginTop: 12, marginBottom: 10 },
  termsHeading: { fontSize: 10, fontWeight: 700, color: '#24543f', marginTop: 8, marginBottom: 3 },
  termsText: { fontSize: 9.5, lineHeight: 1.35, marginBottom: 3 },
  formLine: { marginBottom: 18, fontSize: 10 },
  footer: { position: 'absolute', top: 797, left: 40, right: 40, borderTopWidth: 0.7, borderTopColor: '#397b5d', paddingTop: 7, fontSize: 7.5, lineHeight: 1.2, color: '#52645d' },
})

const clean = (text: string) => text.replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').replace(/[\u2011\u2013\u2014]/g, '-')
const money = (ore: number) => `${(ore / 100).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`.replace(/\u00a0/g, ' ')
const dateTime = (date: string) => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Stockholm', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
}).format(new Date(date))

function text(value: string, props: TextProps & React.Attributes = {}) {
  return h(Text, { orphans: 2, widows: 2, hyphenationCallback: word => [word], ...props }, clean(value))
}
function facts(rows: Array<[string, string]>) {
  return rows.filter(([, value]) => value.trim()).map(([label, value], index) => h(View, { style: styles.row, wrap: false, key: `${label}-${index}` },
    text(label, { style: styles.label }), text(value, { style: styles.value })))
}
function heading(value: string) { return text(value, { style: styles.heading, minPresenceAhead: 50 }) }
function furniture(data: EbFollowUpConfirmation) {
  // Dynamic page-number text must retain auto height in react-pdf's second
  // layout pass; fixed heights on it or its parent can make it disappear.
  return [h(View, { fixed: true, key: 'header' }, text('HUSHUB  /  DIGITAL ÅTGÄRDSUPPFÖLJNING', { style: styles.header })),
    h(View, { key: 'footer', fixed: true, style: styles.footer },
      h(Text, { style: { fontSize: 7.5, lineHeight: 1.2 },
        render: ({ pageNumber, totalPages }) => `Beställning ${data.orderId}   |   ${pageNumber} (${totalPages})` }))]
}
function page(data: EbFollowUpConfirmation, key: string, ...children: React.ReactNode[]) {
  return h(Page, { key, size: 'A4', style: styles.page, wrap: true }, ...furniture(data), ...children)
}

export function buildEbFollowUpConfirmationFilename(data: EbFollowUpConfirmation) {
  const id = data.orderId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'kopia'
  const accepted = data.buyer.acceptanceSnapshot?.acceptedAt
  const date = accepted && Number.isFinite(Date.parse(accepted))
    ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(accepted))
    : 'bestallning'
  return `Bestallningsbekraftelse-Atgardsuppfoljning-${date}-${id}.pdf`
}

export async function renderEbFollowUpConfirmationPdf(data: EbFollowUpConfirmation): Promise<Buffer> {
  const { buyer, seller, project, price } = data
  const acceptance = buyer.acceptanceSnapshot
  // Old jobs without a receipt snapshot keep their original full-text mail.
  // Never manufacture missing agreement evidence using today's terms.
  if (data.version !== 1 || !acceptance?.termsText || !acceptance.termsHash || !Number.isFinite(Date.parse(acceptance.acceptedAt))
    || !['consumer', 'business'].includes(buyer.customerType ?? '')
    || (buyer.customerType === 'consumer' && !data.withdrawalFormText)) {
    throw new Error('EB_FOLLOW_UP_CONFIRMATION_SNAPSHOT_INVALID')
  }
  const consumer = buyer.customerType === 'consumer'
  const invoiceAddress = [buyer.invoiceAddress, `${buyer.invoicePostalCode} ${buyer.invoiceCity}`].join('\n')
  const intro = page(data, 'summary',
    h(View, { style: styles.hero, wrap: false }, text('Beställningsbekräftelse', { style: styles.title }), text('Digital åtgärdsuppföljning', { style: styles.subtitle })),
    text('Din beställning är mottagen och tjänsten har aktiverats.', { style: styles.paragraph }),
    ...facts([['Beställd', `${dateTime(acceptance.acceptedAt)} (svensk tid)`], ['Beställningsnummer', data.orderId]]),
    heading('Besiktningen som tjänsten gäller'),
    ...facts([['Projekt', project.title], ['Objekt', project.propertyDesignation], ['Adress', project.address],
      ['Beställare av besiktningen', project.customerName], ['Besiktning', [project.inspectionLabel, project.inspectionDate].filter(Boolean).join(' / ')], ['Utlåtande', project.reportNumber]]),
    heading('Pris och fakturering'),
    ...facts([['Pris exklusive moms', money(price.netOre)], [`Moms (${price.vatRate} %)`, money(price.vatOre)]]),
    h(View, { style: styles.row, wrap: false }, text('Totalt inklusive moms', { style: styles.label }), text(money(price.totalOre), { style: [styles.value, styles.total] })),
    text('Engångspris för denna besiktning. Detta är inte en faktura. Fakturering hanteras manuellt och fakturans betalningsuppgifter skickas separat.', { style: styles.muted }),
    heading('Köpare och fakturamottagare'),
    ...facts([['Beställt av', `${buyer.name}\n${buyer.email}`], ['Kundtyp', consumer ? 'Privatkund' : 'Företag / förening'],
      ['Fakturamottagare', buyer.invoiceName], ['Fakturaadress', invoiceAddress], ['Organisationsnummer', buyer.invoiceOrgNo ?? '']]),
    heading('Säljare och kontakt'),
    text(`${seller.name}, org.nr ${seller.orgNumber}\n${seller.address}\n${seller.email}${seller.phone ? ` / ${seller.phone}` : ''}`, { style: styles.paragraph }),
  )
  const accepted = page(data, 'acceptance',
    heading('Dina godkännanden'),
    text(`Följande godkännanden registrerades vid beställningen ${dateTime(acceptance.acceptedAt)} (svensk tid).`, { style: styles.paragraph }),
    ...Object.entries(acceptance.consentTexts).filter(([key]) => acceptance.consents[key as keyof typeof acceptance.consents] === true)
      .map(([, value], index) => h(View, { key: `consent-${index}`, style: styles.consent, wrap: false },
        text(`${index + 1}.`, { style: styles.number }), text(value, { style: styles.consentText }))),
    h(View, { style: styles.info, wrap: false },
      text('Din kopia av beställningen', { style: styles.termsHeading }),
      text('På följande sidor finns de köpvillkor som gällde och godkändes när du beställde tjänsten. Spara denna bekräftelse.', { style: styles.paragraph }),
      text(`Villkorsversion: ${acceptance.termsVersion}\nDokumentfingeravtryck (SHA-256):\n${acceptance.termsHash}`, { style: styles.muted })),
    ...(consumer ? [heading('Ångerrätt'),
      text(`Beräknad sista ångerdag: ${acceptance.withdrawalDeadline ?? 'Ej registrerad'} (svensk tid). Beräkningen förutsätter att föreskriven ångerinformation lämnats vid köpet.`, { style: styles.paragraph }),
      text(`Du kan använda ”Ångra beställningen” i din personliga åtgärdsportal eller skicka ett tydligt meddelande till ${seller.email} eller säljarens postadress på första sidan.`, { style: styles.paragraph }),
      text('Fullständig information finns i köpvillkoren. En ångerblankett finns sist i denna PDF. Blanketten är frivillig.', { style: styles.paragraph }),
      text(acceptance.withdrawalFormUrl, { style: styles.muted })]
      : [heading('Köp för företag eller förening'), text('Köpet har gjorts för företag eller förening. Konsumentens lagstadgade ångerrätt gäller inte.', { style: styles.paragraph })]),
  )
  const terms = page(data, 'terms',
    heading('Köpvillkor - din sparade kopia'),
    ...acceptance.termsText.split(/\n\s*\n/).flatMap((paragraph, index) => {
      const [title, ...lines] = paragraph.split('\n')
      return [text(title, { key: `title-${index}`, style: styles.termsHeading, minPresenceAhead: 36 }),
        ...(lines.length ? [text(lines.join('\n'), { key: `body-${index}`, style: styles.termsText })] : [])]
    }),
  )
  const form = consumer ? page(data, 'withdrawal-form',
    heading('Ångerblankett'),
    ...data.withdrawalFormText.split('\n').map((line, index) => text(line, { key: `form-${index}`, style: styles.formLine })),
  ) : null
  const document = h(Document, {
    title: 'Beställningsbekräftelse - digital åtgärdsuppföljning', author: seller.name,
    subject: 'Kopia av beställning och godkända köpvillkor', creator: 'HusHub', language: 'sv-SE',
    creationDate: new Date(acceptance.acceptedAt), modificationDate: new Date(acceptance.acceptedAt),
  }, intro, accepted, terms, form) as React.ReactElement<DocumentProps>
  const pdf = await renderToBuffer(document)
  return Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf)
}
