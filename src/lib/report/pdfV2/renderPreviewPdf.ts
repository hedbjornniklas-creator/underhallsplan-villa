import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Browser as BrowserKind, detectBrowserPlatform, install } from '@puppeteer/browsers'
import puppeteer from 'puppeteer'

const DEFAULT_TIMEOUT_MS = 60000
const BROWSER_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
const ALLOW_AUTOINSTALL = process.env.PUPPETEER_ALLOW_AUTOINSTALL !== '0'
const REPORT_TIMING_LOGS = process.env.REPORT_TIMING_LOGS !== '0'
const REPORT_READY_TIMEOUT_MS = Number(process.env.REPORT_READY_TIMEOUT_MS ?? 20000)
const NETWORK_IDLE_TIMEOUT_MS = Number(process.env.REPORT_NETWORK_IDLE_TIMEOUT_MS ?? 12000)
const PROFILE_ROOT_DIR =
  process.env.PUPPETEER_PROFILE_ROOT_DIR?.trim() ||
  join(process.platform === 'linux' ? '/tmp' : tmpdir(), 'puppeteer-runtime-profiles')

let installedExecutablePath: string | null = null
let installPromise: Promise<string> | null = null

function createRenderTimingLogger(traceId: string) {
  const startedAt = Date.now()
  let lastAt = startedAt
  return (step: string, extra?: Record<string, unknown>) => {
    if (!REPORT_TIMING_LOGS) return
    const now = Date.now()
    console.info('[report.pdf.render][timing]', {
      traceId,
      step,
      stepMs: now - lastAt,
      totalMs: now - startedAt,
      ...(extra ?? {}),
    })
    lastAt = now
  }
}

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

function isNoSpaceError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('ENOSPC') || message.toLowerCase().includes('no space left on device')
}

function safeRemoveDir(path: string) {
  try {
    rmSync(path, { recursive: true, force: true })
  } catch {
    // noop
  }
}

function pruneOldProfileDirs(maxAgeMs = 1000 * 60 * 60) {
  if (!existsSync(PROFILE_ROOT_DIR)) return
  const now = Date.now()
  for (const entry of readdirSync(PROFILE_ROOT_DIR)) {
    if (!entry.startsWith('profile-')) continue
    const fullPath = join(PROFILE_ROOT_DIR, entry)
    try {
      const stats = statSync(fullPath)
      if (!stats.isDirectory()) continue
      if (now - stats.mtimeMs > maxAgeMs) {
        safeRemoveDir(fullPath)
      }
    } catch {
      // ignore unreadable entries
    }
  }
}

function allocateUserDataDir() {
  mkdirSync(PROFILE_ROOT_DIR, { recursive: true })
  pruneOldProfileDirs()
  const dir = join(
    PROFILE_ROOT_DIR,
    `profile-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  )
  mkdirSync(dir, { recursive: true })
  return dir
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

      const configuredCacheDir = process.env.PUPPETEER_CACHE_DIR?.trim()
      const defaultCacheDir =
        process.platform === 'linux'
          ? '/tmp/puppeteer'
          : join(process.cwd(), '.cache', 'puppeteer')
      const cacheDir = configuredCacheDir || defaultCacheDir

      // In serverless Linux environments, /tmp is usually the only writable location.
      mkdirSync(cacheDir, { recursive: true })

      const installed = await install({
        browser: BrowserKind.CHROME,
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

async function launchPdfBrowser(): Promise<{
  browser: Awaited<ReturnType<typeof puppeteer.launch>>
  userDataDir: string
}> {
  const configuredExecutablePath = resolveConfiguredExecutablePath()

  const launchWith = async (executablePath?: string | null) => {
    const userDataDir = allocateUserDataDir()
    try {
      const browser = await puppeteer.launch({
        headless: true,
        args: BROWSER_ARGS,
        executablePath: executablePath ?? undefined,
        userDataDir,
      })
      return { browser, userDataDir }
    } catch (error) {
      safeRemoveDir(userDataDir)
      if (isNoSpaceError(error)) {
        pruneOldProfileDirs(0)
      }
      throw error
    }
  }

  try {
    return await launchWith(configuredExecutablePath)
  } catch (error) {
    if (!isMissingChromeError(error)) {
      throw error
    }

    if (!ALLOW_AUTOINSTALL) {
      throw new Error(
        'Chrome saknas for PDF-rendering. Satt PUPPETEER_EXECUTABLE_PATH eller aktivera PUPPETEER_ALLOW_AUTOINSTALL=1.'
      )
    }

    const installedPath = await ensureBundledChromeExecutablePath().catch((installError) => {
      const installMessage =
        installError instanceof Error ? installError.message : String(installError)
      throw new Error(
        `Chrome saknas for PDF-rendering och automatisk installation misslyckades. ${installMessage}. ` +
          'Installera manuellt med `npx puppeteer browsers install chrome` eller satt PUPPETEER_EXECUTABLE_PATH.'
      )
    })

    return await launchWith(installedPath)
  }
}

export async function renderPreviewPdf(params: {
  url: string
  cookieHeader?: string | null
  timeoutMs?: number
  traceId?: string
}) {
  const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const traceId = params.traceId ?? `pdf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const mark = createRenderTimingLogger(traceId)
  const { browser, userDataDir } = await launchPdfBrowser()
  mark('browser_launch_done')
  let timeoutHandle: NodeJS.Timeout | null = null

  const renderPromise = (async () => {
    try {
      const page = await browser.newPage()
      mark('page_created')
      page.setDefaultTimeout(timeoutMs)

      if (params.cookieHeader) {
        await page.setExtraHTTPHeaders({
          cookie: params.cookieHeader,
        })
        mark('cookie_header_set')
      }

      await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 })
      await page.emulateMediaType('print')
      mark('viewport_and_media_ready')

      await page.goto(params.url, { waitUntil: 'domcontentloaded' })
      mark('page_goto_domcontentloaded')
      try {
        await page.waitForNetworkIdle({
          idleTime: 500,
          timeout: NETWORK_IDLE_TIMEOUT_MS,
        })
        mark('network_idle_ready')
      } catch {
        // Best-effort only. Some pages keep background requests open.
        mark('network_idle_skipped')
      }

      await page.evaluateHandle('document.fonts.ready')
      mark('fonts_ready')
      await page.waitForFunction(isReportReady, { timeout: REPORT_READY_TIMEOUT_MS })
      mark('report_ready')

      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
      })
      mark('page_pdf_done', { pdfBytes: pdf.length })
      return pdf
    } finally {
      try {
        await browser.close()
      } catch {
        // Browser may already be killed on timeout.
      }
      safeRemoveDir(userDataDir)
      mark('browser_closed_and_profile_removed')
    }
  })()

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      try {
        const proc = browser.process()
        if (proc && !proc.killed) proc.kill('SIGKILL')
      } catch {
        // noop
      }
      safeRemoveDir(userDataDir)
      mark('render_timeout_kill', { timeoutMs })
      reject(new Error('PDF_RENDER_TIMEOUT'))
    }, timeoutMs)
  })

  renderPromise.catch(() => {
    // Prevent unhandled rejection if timeout wins the race first.
  })

  try {
    return await Promise.race([renderPromise, timeoutPromise])
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
  }
}
