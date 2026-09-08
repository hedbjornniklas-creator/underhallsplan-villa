import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { confirmationFixture } from '../test/fixtures/eb-follow-up-confirmation.ts'
import { renderEbFollowUpConfirmationPdf } from '../src/lib/eb/followUpConfirmationPdf.ts'
import { buildEbFollowUpConfirmationEmail } from '../src/lib/eb/followUpConfirmation.ts'
import puppeteer from 'puppeteer-core'

// Synthetic examples only: no customer data or external delivery.
const output = path.resolve('output/pdf')
const scratch = path.resolve('tmp/pdfs/eb-follow-up-confirmation')
await Promise.all([mkdir(output, { recursive: true }), mkdir(scratch, { recursive: true })])
const cases = []
for (const type of ['consumer', 'business', 'long']) {
  const data = confirmationFixture(type === 'business' ? 'business' : 'consumer')
  if (type === 'long') {
    data.project.title = 'Renovering och ombyggnad av flerbostadshus med installationer och gemensamma utrymmen '.repeat(3)
    data.project.customerName = 'Bostadsrättsföreningen Exemplet och samfällighetens gemensamma beställarorganisation'
    data.buyer.invoiceName = 'Bostadsrättsföreningen Långa Namnet med gemensamhetsanläggningar och förvaltningsorganisation'
    data.buyer.invoiceAddress = 'c/o Fastighetsförvaltningen, avdelningen för gemensamma utrymmen, Exempelgatan 123 B, våning 14'
    data.buyer.acceptanceSnapshot.termsText += '\n\nExtra långt testavsnitt\n' + 'Ett långt stycke ska fortsätta på nästa sida utan att rubrik, rad eller sidfot överlappar. '.repeat(45)
  }
  const filename = type === 'consumer' ? path.join(output, 'Exempel-bestallningsbekraftelse-atgardsuppfoljning.pdf') : path.join(scratch, `${type}.pdf`)
  await writeFile(filename, await renderEbFollowUpConfirmationPdf(data))
  cases.push({ pdf: filename, data })
  console.log(filename)
}
await writeFile(path.join(scratch, 'cases.json'), JSON.stringify(cases, null, 2))
const receipt = buildEbFollowUpConfirmationEmail(confirmationFixture(), 'https://example.invalid/atgarder/example-only')
await writeFile(path.join(scratch, 'email.html'), receipt.html)
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
try {
  const tab = await browser.newPage()
  await tab.setRequestInterception(true)
  tab.on('request', request => request.abort())
  for (const width of [900, 390]) {
    await tab.setViewport({ width, height: 900, deviceScaleFactor: 1 })
    await tab.setContent(receipt.html)
    const overflowing = await tab.evaluate(() => document.documentElement.scrollWidth > innerWidth)
    if (overflowing) throw new Error(`Receipt email overflows at ${width}px`)
    await tab.screenshot({ path: path.join(scratch, `email-${width}.png`), fullPage: true })
  }
} finally {
  await browser.close()
}
