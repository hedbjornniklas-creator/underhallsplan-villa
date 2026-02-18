import puppeteer from 'puppeteer'

const DEFAULT_TIMEOUT_MS = 60000

const isReportReady = () => {
  const images = Array.from(document.querySelectorAll('img[data-report-track="1"]'))
  if (images.length === 0) return true
  return images.every((img) => {
    const ready = img.getAttribute('data-report-ready') === '1'
    return ready && (img instanceof HTMLImageElement ? img.complete : true)
  })
}

export async function renderPreviewPdf(params: {
  url: string
  cookieHeader?: string | null
  timeoutMs?: number
}) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })

  try {
    const page = await browser.newPage()
    page.setDefaultTimeout(params.timeoutMs ?? DEFAULT_TIMEOUT_MS)

    if (params.cookieHeader) {
      await page.setExtraHTTPHeaders({
        cookie: params.cookieHeader,
      })
    }

    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 })
  await page.emulateMediaType('print')

    await page.goto(params.url, { waitUntil: 'networkidle0' })

    await page.evaluateHandle('document.fonts.ready')
    await page.waitForFunction(isReportReady, { timeout: 20000 })

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
    })

    return pdfBuffer
  } finally {
    await browser.close()
  }
}
