import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'

const DEFAULT_TIMEOUT_MS = 60000
const BROWSER_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
const REPORT_TIMING_LOGS = process.env.REPORT_TIMING_LOGS !== '0'
const REPORT_READY_TIMEOUT_MS = Number(process.env.REPORT_READY_TIMEOUT_MS ?? 20000)
const NETWORK_IDLE_TIMEOUT_MS = Number(process.env.REPORT_NETWORK_IDLE_TIMEOUT_MS ?? 12000)
const BROWSER_LAUNCH_TIMEOUT_MS = Number(process.env.PUPPETEER_LAUNCH_TIMEOUT_MS ?? 25000)
const BROWSER_RESOLVE_TIMEOUT_MS = Number(process.env.PUPPETEER_CHROME_RESOLVE_TIMEOUT_MS ?? 30000)
const PROFILE_ROOT_DIR =
  process.env.PUPPETEER_PROFILE_ROOT_DIR?.trim() ||
  join(process.platform === 'linux' ? '/tmp' : tmpdir(), 'puppeteer-runtime-profiles')

type LaunchConfig = {
  executablePath: string
  args: string[]
  source: 'env' | 'sparticuz'
}

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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      reject(new Error(timeoutMessage))
    }, timeoutMs)
    promise
      .then((value) => {
        clearTimeout(timeoutHandle)
        resolve(value)
      })
      .catch((error) => {
        clearTimeout(timeoutHandle)
        reject(error)
      })
  })
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
  const configuredKey = process.env.PUPPETEER_EXECUTABLE_PATH?.trim()
    ? 'PUPPETEER_EXECUTABLE_PATH'
    : process.env.CHROME_PATH?.trim()
      ? 'CHROME_PATH'
      : process.env.CHROME_BIN?.trim()
        ? 'CHROME_BIN'
        : null
  const envPath =
    process.env.PUPPETEER_EXECUTABLE_PATH?.trim() ||
    process.env.CHROME_PATH?.trim() ||
    process.env.CHROME_BIN?.trim() ||
    ''

  if (!envPath) return null
  if (!existsSync(envPath)) {
    console.warn('[report.pdf.render] configured chrome path does not exist, falling back', {
      envKey: configuredKey,
      path: envPath,
    })
    return null
  }
  return envPath
}

async function resolveLaunchConfig(
  mark: (step: string, extra?: Record<string, unknown>) => void
): Promise<LaunchConfig> {
  const configuredExecutablePath = resolveConfiguredExecutablePath()
  if (configuredExecutablePath) {
    mark('browser_executable_resolved', {
      source: 'env',
      executablePath: configuredExecutablePath,
    })
    return {
      executablePath: configuredExecutablePath,
      args: BROWSER_ARGS,
      source: 'env',
    }
  }

  try {
    const sparticuzPath = await withTimeout(
      chromium.executablePath(),
      BROWSER_RESOLVE_TIMEOUT_MS,
      `Kunde inte hitta Chromium-binär i tid (timeout ${BROWSER_RESOLVE_TIMEOUT_MS} ms).`
    )

    if (!sparticuzPath || !existsSync(sparticuzPath)) {
      throw new Error('Sparticuz Chromium gav ingen giltig executable path.')
    }

    const args = Array.from(new Set([...(chromium.args ?? []), ...BROWSER_ARGS]))
    mark('browser_executable_resolved', {
      source: 'sparticuz',
      executablePath: sparticuzPath,
      argCount: args.length,
    })

    return {
      executablePath: sparticuzPath,
      args,
      source: 'sparticuz',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Chrome saknas för PDF-rendering i servermiljön. ${message}. ` +
        'Sätt PUPPETEER_EXECUTABLE_PATH till en giltig Chrome/Chromium-binär eller säkerställ att @sparticuz/chromium kan köras i deployment.'
    )
  }
}

async function launchPdfBrowser(
  mark: (step: string, extra?: Record<string, unknown>) => void
): Promise<{
  browser: Awaited<ReturnType<typeof puppeteer.launch>>
  userDataDir: string
}> {
  const launchConfig = await resolveLaunchConfig(mark)

  const userDataDir = allocateUserDataDir()
  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: launchConfig.args,
      executablePath: launchConfig.executablePath,
      userDataDir,
      timeout: BROWSER_LAUNCH_TIMEOUT_MS,
    })
    mark('browser_launch_done', {
      source: launchConfig.source,
      launchTimeoutMs: BROWSER_LAUNCH_TIMEOUT_MS,
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

export async function renderPreviewPdf(params: {
  url: string
  cookieHeader?: string | null
  timeoutMs?: number
  traceId?: string
}) {
  const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const traceId = params.traceId ?? `pdf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const mark = createRenderTimingLogger(traceId)

  mark('browser_launch_start', {
    launchTimeoutMs: BROWSER_LAUNCH_TIMEOUT_MS,
    resolveTimeoutMs: BROWSER_RESOLVE_TIMEOUT_MS,
  })
  const { browser, userDataDir } = await launchPdfBrowser(mark)
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
