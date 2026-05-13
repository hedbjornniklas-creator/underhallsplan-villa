import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import chromium from '@sparticuz/chromium'
import puppeteer, { type Page } from 'puppeteer-core'

const DEFAULT_TIMEOUT_MS = 60000
const BROWSER_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
const REPORT_TIMING_LOGS = process.env.REPORT_TIMING_LOGS !== '0'
const REPORT_READY_TIMEOUT_MS = Number(process.env.REPORT_READY_TIMEOUT_MS ?? 45000)
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

export class PdfRenderReadinessTimeoutError extends Error {
  diagnostics: Record<string, unknown>

  constructor(message: string, diagnostics: Record<string, unknown>, cause?: unknown) {
    super(message)
    this.name = 'PdfRenderReadinessTimeoutError'
    this.diagnostics = diagnostics
    if (cause !== undefined) {
      this.cause = cause
    }
  }
}

export function getPdfRenderDiagnostics(error: unknown): Record<string, unknown> | null {
  if (
    error &&
    typeof error === 'object' &&
    'diagnostics' in error &&
    typeof (error as { diagnostics?: unknown }).diagnostics === 'object' &&
    (error as { diagnostics?: unknown }).diagnostics !== null
  ) {
    return (error as { diagnostics: Record<string, unknown> }).diagnostics
  }
  return null
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
  const root = document.querySelector('.report-root')
  if (!root) return false
  if (root.getAttribute('data-report-pagination-ready') !== '1') return false

  const images = Array.from(document.querySelectorAll('img[data-report-track="1"]'))
  if (images.length === 0) return true
  return images.every((img) => {
    const ready = img.getAttribute('data-report-ready') === '1'
    return ready && (img instanceof HTMLImageElement ? img.complete : true)
  })
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function compactUrlForLog(value: string) {
  try {
    const parsed = new URL(value)
    if (parsed.pathname === '/api/image-proxy') {
      const target = parsed.searchParams.get('url')
      let targetSummary = '<missing>'
      if (target) {
        try {
          const targetUrl = new URL(target)
          targetSummary = `${targetUrl.host}${targetUrl.pathname}`
        } catch {
          targetSummary = target.slice(0, 180)
        }
      }
      return `${parsed.host}${parsed.pathname}?target=${targetSummary}&max=${parsed.searchParams.get('max') ?? ''}`
    }
    return `${parsed.host}${parsed.pathname}`
  } catch {
    return value.slice(0, 220)
  }
}

async function collectReportReadinessDiagnostics(page: Page): Promise<Record<string, unknown>> {
  try {
    return await page.evaluate(() => {
      const describeUrl = (value: string) => {
        try {
          const parsed = new URL(value, window.location.href)
          if (parsed.pathname === '/api/image-proxy') {
            const target = parsed.searchParams.get('url')
            let targetHost: string | null = null
            let targetPath: string | null = null
            if (target) {
              try {
                const targetUrl = new URL(target)
                targetHost = targetUrl.host
                targetPath = targetUrl.pathname
              } catch {
                targetPath = target.slice(0, 180)
              }
            }
            return {
              host: parsed.host,
              path: parsed.pathname,
              max: parsed.searchParams.get('max'),
              q: parsed.searchParams.get('q'),
              targetHost,
              targetPath,
            }
          }
          return {
            host: parsed.host,
            path: parsed.pathname,
          }
        } catch {
          return {
            raw: value.slice(0, 220),
          }
        }
      }

      const root = document.querySelector('.report-root')
      const images = Array.from(
        document.querySelectorAll('img[data-report-track="1"]')
      )
      const imageStates = images.map((img, index) => {
        const htmlImage = img instanceof HTMLImageElement ? img : null
        return {
          index,
          alt: img.getAttribute('alt'),
          ready: img.getAttribute('data-report-ready'),
          complete: htmlImage ? htmlImage.complete : null,
          naturalWidth: htmlImage ? htmlImage.naturalWidth : null,
          naturalHeight: htmlImage ? htmlImage.naturalHeight : null,
          src: htmlImage ? describeUrl(htmlImage.currentSrc || htmlImage.src) : null,
        }
      })
      const notReadyImages = imageStates.filter(
        (img) => img.ready !== '1' || img.complete === false
      )

      return {
        hasRoot: Boolean(root),
        rootClassName: root?.getAttribute('class') ?? null,
        paginationReady: root?.getAttribute('data-report-pagination-ready') ?? null,
        imageVersion: root?.getAttribute('data-report-image-version') ?? null,
        paginationImageVersion:
          root?.getAttribute('data-report-pagination-image-version') ?? null,
        trackedImageCount: images.length,
        notReadyImageCount: notReadyImages.length,
        incompleteImageCount: imageStates.filter((img) => img.complete === false).length,
        zeroNaturalSizeCount: imageStates.filter(
          (img) => img.naturalWidth === 0 || img.naturalHeight === 0
        ).length,
        notReadyImages: notReadyImages.slice(0, 8),
      }
    })
  } catch (error) {
    return {
      diagnosticsError: errorMessage(error),
    }
  }
}

function isNoSpaceError(error: unknown) {
  const message = errorMessage(error)
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
      const browserEvents: Array<Record<string, unknown>> = []
      const rememberBrowserEvent = (step: string, extra: Record<string, unknown>) => {
        browserEvents.push({
          step,
          ...extra,
        })
        if (browserEvents.length > 30) {
          browserEvents.splice(0, browserEvents.length - 30)
        }
        mark(step, extra)
      }
      page.on('console', (message) => {
        const type = message.type()
        if (type !== 'error' && type !== 'warn') return
        rememberBrowserEvent('browser_console', {
          type,
          text: message.text().slice(0, 1200),
        })
      })
      page.on('pageerror', (error) => {
        rememberBrowserEvent('browser_pageerror', {
          message: errorMessage(error),
          stack: error instanceof Error ? (error.stack?.slice(0, 1800) ?? null) : null,
        })
      })
      page.on('requestfailed', (request) => {
        rememberBrowserEvent('browser_request_failed', {
          method: request.method(),
          resourceType: request.resourceType(),
          url: compactUrlForLog(request.url()),
          errorText: request.failure()?.errorText ?? null,
        })
      })
      page.on('response', (response) => {
        const status = response.status()
        if (status < 400) return
        const request = response.request()
        rememberBrowserEvent('browser_response_error', {
          status,
          resourceType: request.resourceType(),
          url: compactUrlForLog(response.url()),
        })
      })
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
      const reportReadyTimeoutMs = Math.min(
        REPORT_READY_TIMEOUT_MS,
        Math.max(5000, timeoutMs - 5000)
      )
      try {
        await page.waitForFunction(isReportReady, { timeout: reportReadyTimeoutMs })
      } catch (error) {
        const diagnostics = await collectReportReadinessDiagnostics(page)
        const timeoutDiagnostics = {
          timeoutMs: reportReadyTimeoutMs,
          error: errorMessage(error),
          browserEvents,
          ...diagnostics,
        }
        mark('report_ready_timeout_diagnostics', timeoutDiagnostics)
        throw new PdfRenderReadinessTimeoutError(errorMessage(error), timeoutDiagnostics, error)
      }
      mark('report_ready', { timeoutMs: reportReadyTimeoutMs })

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
