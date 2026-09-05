import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import chromium from '@sparticuz/chromium'
import puppeteer, { type Page } from 'puppeteer-core'

export const REPORT_PDF_RENDER_TIMEOUT_MAX_MS = 150_000

function readBoundedTimeoutEnv(
  name: string,
  fallback: number,
  min: number,
  max: number
) {
  const raw = process.env[name]?.trim()
  const parsed = raw ? Number(raw) : fallback
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, Math.round(parsed)))
}

const DEFAULT_TIMEOUT_MS = 60_000
const BROWSER_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
const REPORT_TIMING_LOGS = process.env.REPORT_TIMING_LOGS !== '0'
const REPORT_READY_TIMEOUT_MS = readBoundedTimeoutEnv(
  'REPORT_READY_TIMEOUT_MS',
  45_000,
  5_000,
  REPORT_PDF_RENDER_TIMEOUT_MAX_MS
)
const NETWORK_IDLE_TIMEOUT_MS = readBoundedTimeoutEnv(
  'REPORT_NETWORK_IDLE_TIMEOUT_MS',
  12_000,
  1_000,
  15_000
)
const BROWSER_LAUNCH_TIMEOUT_MS = readBoundedTimeoutEnv(
  'PUPPETEER_LAUNCH_TIMEOUT_MS',
  25_000,
  1_000,
  25_000
)
const BROWSER_RESOLVE_TIMEOUT_MS = readBoundedTimeoutEnv(
  'PUPPETEER_CHROME_RESOLVE_TIMEOUT_MS',
  30_000,
  1_000,
  30_000
)
const ASSET_DNS_TIMEOUT_MS = 3000
const PROFILE_ROOT_DIR =
  process.env.PUPPETEER_PROFILE_ROOT_DIR?.trim() ||
  join(process.platform === 'linux' ? '/tmp' : tmpdir(), 'puppeteer-runtime-profiles')

type LaunchConfig = {
  executablePath: string
  args: string[]
  source: 'env' | 'sparticuz'
}

type NetworkFamily = 'ipv4' | 'ipv6'

const blockedReportIpv4Networks = new BlockList()
const blockedReportIpv6Networks = new BlockList()
const BLOCKED_REPORT_NETWORKS: Array<[address: string, prefix: number, family: NetworkFamily]> = [
  // IPv4 addresses that must never be reachable from report-controlled assets.
  ['0.0.0.0', 8, 'ipv4'],
  ['10.0.0.0', 8, 'ipv4'],
  ['100.64.0.0', 10, 'ipv4'],
  ['127.0.0.0', 8, 'ipv4'],
  ['169.254.0.0', 16, 'ipv4'],
  ['172.16.0.0', 12, 'ipv4'],
  ['192.0.0.0', 24, 'ipv4'],
  ['192.0.2.0', 24, 'ipv4'],
  ['192.168.0.0', 16, 'ipv4'],
  ['198.18.0.0', 15, 'ipv4'],
  ['198.51.100.0', 24, 'ipv4'],
  ['203.0.113.0', 24, 'ipv4'],
  ['224.0.0.0', 4, 'ipv4'],
  ['240.0.0.0', 4, 'ipv4'],
  // IPv6 loopback, private, link-local, documentation and IPv4-translation ranges.
  ['::', 96, 'ipv6'],
  ['::1', 128, 'ipv6'],
  ['::ffff:0:0', 96, 'ipv6'],
  ['64:ff9b::', 96, 'ipv6'],
  ['64:ff9b:1::', 48, 'ipv6'],
  ['100::', 64, 'ipv6'],
  ['2001::', 32, 'ipv6'],
  ['2001:2::', 48, 'ipv6'],
  ['2001:10::', 28, 'ipv6'],
  ['2001:20::', 28, 'ipv6'],
  ['2001:db8::', 32, 'ipv6'],
  ['2002::', 16, 'ipv6'],
  ['fc00::', 7, 'ipv6'],
  ['fe80::', 10, 'ipv6'],
  ['fec0::', 10, 'ipv6'],
  ['ff00::', 8, 'ipv6'],
]

for (const [address, prefix, family] of BLOCKED_REPORT_NETWORKS) {
  if (family === 'ipv4') {
    blockedReportIpv4Networks.addSubnet(address, prefix, family)
  } else {
    blockedReportIpv6Networks.addSubnet(address, prefix, family)
  }
}

function normalizeHostname(value: string) {
  return value.replace(/^\[|\]$/gu, '').replace(/\.$/u, '').toLowerCase()
}

function isBlockedNetworkAddress(value: string) {
  const address = normalizeHostname(value).split('%', 1)[0] ?? ''
  const family = isIP(address)
  if (family === 4) return blockedReportIpv4Networks.check(address, 'ipv4')
  if (family === 6) return blockedReportIpv6Networks.check(address, 'ipv6')
  return true
}

function configuredReportAssetOrigins(mainOrigin: string) {
  const origins = new Set<string>([mainOrigin])
  const configured = [
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? '',
    ...(process.env.REPORT_PDF_ALLOWED_ASSET_ORIGINS ?? '')
      .split(',')
      .map((value) => value.trim()),
  ]

  for (const candidate of configured) {
    if (!candidate) continue
    try {
      const parsed = new URL(candidate)
      // External report assets must use TLS on the standard port. The main app
      // origin remains allowed separately so localhost development still works.
      if (parsed.protocol !== 'https:' || (parsed.port && parsed.port !== '443')) continue
      origins.add(parsed.origin)
    } catch {
      // Invalid optional origins stay fail-closed.
    }
  }

  return origins
}

type ReportRequestDecision =
  | { allowed: true; isMainDocument: boolean }
  | { allowed: false; reason: string }

function createReportRequestPolicy(mainDocumentUrl: string) {
  const parsedMainUrl = new URL(mainDocumentUrl)
  const allowedOrigins = configuredReportAssetOrigins(parsedMainUrl.origin)
  const publicDnsCache = new Map<string, Promise<boolean>>()

  const resolvesOnlyToPublicAddresses = (hostname: string) => {
    const normalized = normalizeHostname(hostname)
    const literalFamily = isIP(normalized)
    if (literalFamily > 0) return Promise.resolve(!isBlockedNetworkAddress(normalized))

    const cached = publicDnsCache.get(normalized)
    if (cached) return cached

    const resolution = withTimeout(
      lookup(normalized, { all: true, verbatim: true }),
      ASSET_DNS_TIMEOUT_MS,
      'REPORT_PDF_ASSET_DNS_TIMEOUT'
    )
      .then(
        (addresses) =>
          addresses.length > 0 &&
          addresses.every((entry) => !isBlockedNetworkAddress(entry.address))
      )
      .catch(() => false)
    publicDnsCache.set(normalized, resolution)
    return resolution
  }

  return async (value: string): Promise<ReportRequestDecision> => {
    if (value === mainDocumentUrl) return { allowed: true, isMainDocument: true }

    let parsed: URL
    try {
      parsed = new URL(value)
    } catch {
      return { allowed: false, reason: 'invalid_url' }
    }

    if (parsed.protocol === 'data:' || parsed.protocol === 'blob:') {
      return { allowed: true, isMainDocument: false }
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { allowed: false, reason: 'unsafe_protocol' }
    }
    if (parsed.origin === parsedMainUrl.origin) {
      return { allowed: true, isMainDocument: false }
    }
    if (parsed.protocol !== 'https:' || (parsed.port && parsed.port !== '443')) {
      return { allowed: false, reason: 'unsafe_external_transport' }
    }
    if (!allowedOrigins.has(parsed.origin)) {
      return { allowed: false, reason: 'external_origin_not_allowed' }
    }
    if (!(await resolvesOnlyToPublicAddresses(parsed.hostname))) {
      return { allowed: false, reason: 'private_or_unresolved_address' }
    }

    return { allowed: true, isMainDocument: false }
  }
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
    if (!(img instanceof HTMLImageElement)) return ready
    const browserLoaded = img.complete && img.naturalWidth > 0 && img.naturalHeight > 0
    return ready || browserLoaded
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
        (img) =>
          img.ready !== '1' &&
          !(
            img.complete === true &&
            typeof img.naturalWidth === 'number' &&
            img.naturalWidth > 0 &&
            typeof img.naturalHeight === 'number' &&
            img.naturalHeight > 0
          )
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
  /** Headers added only to the main document navigation, never to images or other subresources. */
  mainDocumentHeaders?: Record<string, string> | null
  timeoutMs?: number
  traceId?: string
}) {
  const requestedTimeoutMs =
    typeof params.timeoutMs === 'number' && Number.isFinite(params.timeoutMs)
      ? Math.round(params.timeoutMs)
      : DEFAULT_TIMEOUT_MS
  const timeoutMs = Math.max(
    10_000,
    Math.min(REPORT_PDF_RENDER_TIMEOUT_MAX_MS, requestedTimeoutMs)
  )
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

      const mainDocumentHeaders = Object.fromEntries(
        Object.entries(params.mainDocumentHeaders ?? {}).filter(
          ([name, value]) => name.trim().length > 0 && typeof value === 'string'
        )
      )
      const decideRequest = createReportRequestPolicy(params.url)
      await page.setRequestInterception(true)
      page.on('request', (request) => {
        void (async () => {
          const decision = await decideRequest(request.url())
          if (request.isInterceptResolutionHandled()) return

          if (!decision.allowed) {
            rememberBrowserEvent('browser_request_blocked', {
              resourceType: request.resourceType(),
              url: compactUrlForLog(request.url()),
              reason: decision.reason,
            })
            await request.abort('blockedbyclient')
            return
          }

          const overrides =
            decision.isMainDocument && Object.keys(mainDocumentHeaders).length > 0
              ? {
                  headers: {
                    ...request.headers(),
                    ...mainDocumentHeaders,
                  },
                }
              : undefined
          await request.continue(overrides)
        })().catch((error) => {
          rememberBrowserEvent('browser_request_policy_error', {
            resourceType: request.resourceType(),
            url: compactUrlForLog(request.url()),
            error: errorMessage(error),
          })
          if (!request.isInterceptResolutionHandled()) {
            void request.abort('blockedbyclient').catch(() => {
              // Browser shutdown or navigation cancellation can settle the request first.
            })
          }
        })
      })
      mark('report_request_policy_configured', {
        mainDocumentHeaderCount: Object.keys(mainDocumentHeaders).length,
      })

      await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 })
      await page.emulateMediaType('print')
      mark('viewport_and_media_ready')

      const mainResponse = await page.goto(params.url, { waitUntil: 'domcontentloaded' })
      const mainResponseStatus = mainResponse?.status() ?? null
      mark('page_goto_domcontentloaded', { status: mainResponseStatus })
      if (mainResponseStatus === null || mainResponseStatus >= 400) {
        throw new Error(`PDF_RENDER_PAGE_HTTP_${mainResponseStatus ?? 'NO_RESPONSE'}`)
      }
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

      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            window.requestAnimationFrame(() => {
              window.requestAnimationFrame(() => resolve())
            })
          })
      )
      mark('layout_settled_after_report_ready')

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
