import type { EbFollowUpBuyer, EbFollowUpSeller } from './followUp'

/** Frozen at checkout and encrypted with the receipt job; never rebuilt from live terms on retry. */
export type EbFollowUpConfirmation = {
  version: 1
  orderId: string
  buyer: EbFollowUpBuyer
  seller: EbFollowUpSeller
  project: {
    title: string
    propertyDesignation: string
    address: string
    customerName: string
    inspectionLabel: string
    inspectionDate: string
    reportNumber: string
  }
  price: { totalOre: number; netOre: number; vatOre: number; vatRate: number }
  withdrawalFormText: string
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]!)

function orderedAt(value: string | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Ej registrerat'
  return `${new Intl.DateTimeFormat('sv-SE', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Stockholm',
  }).format(new Date(value))} (svensk tid)`
}

/** Compact receipt. The full, accepted purchase information travels in the attached PDF. */
export function buildEbFollowUpConfirmationEmail(data: EbFollowUpConfirmation, portalUrl: string): {
  subject: string; text: string; html: string
} {
  const { buyer, seller, project } = data
  const acceptance = buyer.acceptanceSnapshot
  const isConsumer = buyer.customerType === 'consumer'
  const total = `${new Intl.NumberFormat('sv-SE', {
    minimumFractionDigits: data.price.totalOre % 100 ? 2 : 0, maximumFractionDigits: 2,
  }).format(data.price.totalOre / 100)} kr inkl. moms`
  const withdrawalUrl = `${portalUrl}#angra-bestallning`
  const subject = 'Beställningsbekräftelse – digital åtgärdsuppföljning'
  const facts = [
    ['Entreprenad', project.title],
    ['Objekt', project.propertyDesignation],
    ['Adress', project.address],
    ['Besiktning', [project.inspectionLabel, project.inspectionDate].filter(Boolean).join(' · ')],
    ['Utlåtande', project.reportNumber],
    ['Beställt', orderedAt(acceptance?.acceptedAt)],
    ['Pris', total],
    ['Beställningsnummer', data.orderId],
  ].filter(([, value]) => Boolean(value))
  const attachmentText = `I bifogad PDF finns din fullständiga beställningsbekräftelse med fakturauppgifter, villkor och de samtycken du godkände${isConsumer ? ', samt information om ångerrätt och ångerblankett' : ''}. Spara den för framtida bruk.`
  const paymentText = 'Fakturan skickas separat. Detta är en beställningsbekräftelse, inte en faktura.'
  const accessText = 'Länken är personlig. Bjud in entreprenören med en egen länk från åtgärdsuppföljningen.'
  const withdrawalText = isConsumer
    ? [
      acceptance?.withdrawalDeadline ? `Beräknad sista ångerdag: ${acceptance.withdrawalDeadline} (svensk tid).` : '',
      'Information om ångerrätten finns i bifogad PDF.',
      `Ångra beställningen: ${withdrawalUrl}`,
      acceptance?.withdrawalFormUrl ? `Konsumentverkets ångerblankett: ${acceptance.withdrawalFormUrl}` : '',
    ].filter(Boolean).join('\n')
    : ''
  const sellerText = [seller.name, `Org.nr ${seller.orgNumber}`, seller.address,
    seller.email, seller.phone].filter(Boolean).join(' · ')
  const text = [
    `Hej ${buyer.name}!`,
    'Tack för din beställning. Digital åtgärdsuppföljning är aktiverad.',
    facts.map(([label, value]) => `${label}: ${value}`).join('\n'),
    `Öppna åtgärdsuppföljningen:\n${portalUrl}\n${accessText}`,
    attachmentText, paymentText, withdrawalText, sellerText,
  ].filter(Boolean).join('\n\n')
  const factRows = facts.map(([label, value]) => `<tr>
    <td valign="top" style="padding:9px 12px 9px 0;border-bottom:1px solid #e2e8f0;width:140px;color:#64748b;font-size:13px;line-height:20px;">${escapeHtml(label)}</td>
    <td valign="top" style="padding:9px 0;border-bottom:1px solid #e2e8f0;color:#172b23;font-size:14px;line-height:20px;word-break:break-word;">${escapeHtml(value)}</td>
  </tr>`).join('')
  const withdrawalHtml = isConsumer ? `<p style="margin:20px 0 0;color:#64748b;font-size:13px;line-height:21px;">
    ${acceptance?.withdrawalDeadline ? `Beräknad sista ångerdag: ${escapeHtml(acceptance.withdrawalDeadline)} (svensk tid).<br>` : ''}
    Information om ångerrätten finns i bifogad PDF.<br>
    <a href="${escapeHtml(withdrawalUrl)}" style="color:#39775b;">Ångra beställningen</a>${acceptance?.withdrawalFormUrl ? ` · <a href="${escapeHtml(acceptance.withdrawalFormUrl)}" style="color:#39775b;">Konsumentverkets ångerblankett</a>` : ''}
  </p>` : ''
  const html = `<!doctype html>
<html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f5f9;"><tr><td align="center" style="padding:24px 12px;">
<!--[if mso]><table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;background:#ffffff;border:1px solid #dce5e1;border-top:4px solid #39775b;">
  <tr><td style="padding:28px 28px 12px;color:#39775b;font-size:13px;letter-spacing:2px;font-weight:bold;">HUSHUB</td></tr>
  <tr><td style="padding:0 28px 28px;">
    <h1 style="margin:0 0 20px;font-size:25px;line-height:32px;color:#172b23;">Tack för din beställning</h1>
    <p style="margin:0 0 12px;font-size:15px;line-height:24px;color:#334155;">Hej ${escapeHtml(buyer.name)}!</p>
    <p style="margin:0 0 20px;font-size:15px;line-height:24px;color:#334155;">Digital åtgärdsuppföljning är aktiverad. Här kan du fördela anmärkningar, skicka listan till entreprenören och följa vilka som har anmälts klara.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${factRows}</table>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 12px;"><tr><td bgcolor="#39775b" style="border-radius:6px;mso-padding-alt:14px 20px;">
      <a href="${escapeHtml(portalUrl)}" style="display:inline-block;padding:14px 20px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;line-height:22px;">Öppna åtgärdsuppföljningen</a>
    </td></tr></table>
    <p style="margin:0 0 24px;font-size:13px;line-height:21px;color:#64748b;">${escapeHtml(accessText)}</p>
    <p style="margin:0 0 12px;font-size:14px;line-height:23px;color:#334155;">${escapeHtml(attachmentText)}</p>
    <p style="margin:0;font-size:14px;line-height:23px;color:#334155;">${escapeHtml(paymentText)}</p>
    ${withdrawalHtml}
  </td></tr>
  <tr><td style="padding:18px 28px;border-top:1px solid #e2e8f0;font-size:12px;line-height:20px;color:#64748b;">${escapeHtml(sellerText)}</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`
  return { subject, text, html }
}
