import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Browser, detectBrowserPlatform, install } from '@puppeteer/browsers'
import puppeteer from 'puppeteer'

const DEFAULT_TIMEOUT_MS = 60000
const BROWSER_ARGS = ['--no-sandbox', '--disable-setuid-sandbox']

let installedExecutablePath: string | null = null
let installPromise: Promise<string> | null = null

const isReportReady = () => {
  const images = Array.from(document.querySelectorAll('img[data-report-track="1"]'))
  if (images.length === 0) return true
  return images.every((img) => {
    const ready = img.getAttribute('data-report-ready') === '1'
    return ready && (img instanceof HTMLImageElement ? img.complete : true)
  })
}

function isMissingChromeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const normalized = message.toLowerCase()
  return (
    normalized.includes('could not find chrome') ||
    normalized.includes('could not find chromium') ||
    normalized.includes('failed to launch the browser process')
  )
}

function resolveConfiguredExecutablePath() {
  const envPath =
    process.env.PUPPETEER_EXECUTABLE_PATH?.trim() ||
    process.env.CHROME_PATH?.trim() ||
    process.env.CHROME_BIN?.trim() ||
    ''

  if (!envPath) return null
  if (!existsSync(envPath)) {
    throw new Error(
      `PUPPETEER_EXECUTABLE_PATH/CHROME_PATH pekar pa en fil som inte finns: ${envPath}`
    )
  }
  return envPath
}

async function ensureBundledChromeExecutablePath() {
  if (installedExecutablePath && existsSync(installedExecutablePath)) {
    return installedExecutablePath
  }

  if (!installPromise) {
    installPromise = (async () => {
      const platform = detectBrowserPlatform()
      if (!platform) {
        throw new Error('Kunde inte identifiera plattform for Puppeteer Chrome-installation.')
      }

      const buildId = (puppeteer as unknown as { browserVersion?: string }).browserVersion
      if (!buildId) {
        throw new Error('Kunde inte lasa Puppeteer browserVersion.')
      }

      const cacheDir =
        process.env.PUPPETEER_CACHE_DIR?.trim() || join(homedir(), '.cache', 'puppeteer')

      const installed = await install({
        browser: Browser.CHROME,
        buildId,
        platform,
        cacheDir,
      })

      installedExecutablePath = installed.executablePath
      return installed.executablePath
    })()
  }

  try {
    return await installPromise
  } finally {
    installPromise = null
  }
}

async function launchPdfBrowser() {
  const configuredExecutablePath = resolveConfiguredExecutablePath()

  try {
    return await puppeteer.launch({
      headless: true,
      args: BROWSER_ARGS,
      executablePath: configuredExecutablePath ?? undefined,
    })
  } catch (error) {
    if (!isMissingChromeError(error)) {
      throw error
    }

    const installedPath = await ensureBundledChromeExecutablePath().catch((installError) => {
      const installMessage =
        installError instanceof Error ? installError.message : String(installError)
      throw new Error(
        `Chrome saknas for PDF-rendering och automatisk installation misslyckades. ${installMessage}. ` +
          'Installera manuellt med `npx puppeteer browsers install chrome` eller satt PUPPETEER_EXECUTABLE_PATH.'
      )
    })

    return await puppeteer.launch({
      headless: true,
      args: BROWSER_ARGS,
      executablePath: installedPath,
    })
  }
}

export async function renderPreviewPdf(params: {
  url: string
  cookieHeader?: string | null
  timeoutMs?: number
}) {
  const browser = await launchPdfBrowser()

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
