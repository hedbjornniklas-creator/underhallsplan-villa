import { lookup } from 'node:dns/promises'
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import { NextResponse } from 'next/server'
import sharp from 'sharp'

const DEFAULT_IMAGE_PROXY_TIMEOUT_MS = 12000
const IMAGE_PROXY_TIMEOUT_MS = parseEnvironmentInteger(
  process.env.IMAGE_PROXY_TIMEOUT_MS,
  DEFAULT_IMAGE_PROXY_TIMEOUT_MS,
  1000,
  30000
)
const MAX_IMAGE_BYTES = 15 * 1024 * 1024
const MAX_REDIRECTS = 3
const MAX_SOURCE_URL_LENGTH = 8192
const MAX_INPUT_PIXELS = 40_000_000
const DEFAULT_MAX_IMAGE_SIDE_PX = 1600
const DEFAULT_IMAGE_QUALITY = 72
const STORAGE_PATH_PREFIXES = ['/storage/v1/object/', '/storage/v1/render/image/']
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

type HostPolicy = {
  storageOnly: boolean
}

type ResolvedDestination = {
  address: string
  family: 4 | 6
}

class ImageProxyError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ImageProxyError'
    this.status = status
  }
}

export const runtime = 'nodejs'

function parseEnvironmentInteger(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

function parseBoundedInteger(value: string | null, fallback: number, min: number, max: number) {
  if (value === null) return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

function normalizedHostname(hostname: string) {
  return hostname.trim().toLowerCase().replace(/\.$/, '')
}

function addConfiguredHost(
  policies: Map<string, HostPolicy>,
  value: string | undefined,
  storageOnly: boolean
) {
  const trimmed = value?.trim()
  if (!trimmed) return

  try {
    const parsed = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`)
    const hostname = normalizedHostname(parsed.hostname)
    if (hostname) {
      policies.set(hostname, { storageOnly })
    }
  } catch {
    // Invalid administrator configuration is ignored; an empty allowlist fails closed below.
  }
}

function getTrustedHostPolicies() {
  const policies = new Map<string, HostPolicy>()

  // Every report image currently comes from the project's Supabase Storage host.
  addConfiguredHost(policies, process.env.NEXT_PUBLIC_SUPABASE_URL, true)

  // Explicit opt-in for a future trusted image CDN or a Supabase Storage custom domain.
  for (const entry of (process.env.IMAGE_PROXY_ALLOWED_HOSTS ?? '').split(',')) {
    addConfiguredHost(policies, entry, false)
  }

  return policies
}

function parseIPv4(address: string) {
  const parts = address.split('.')
  if (parts.length !== 4) return null

  const octets = parts.map((part) => Number(part))
  if (
    octets.some(
      (octet, index) =>
        !Number.isInteger(octet) ||
        octet < 0 ||
        octet > 255 ||
        String(octet) !== parts[index]
    )
  ) {
    return null
  }

  return octets
}

function isPublicIPv4(address: string) {
  const octets = parseIPv4(address)
  if (!octets) return false

  const [a, b, c, d] = octets
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false
  if (a === 100 && b >= 64 && b <= 127) return false
  if (a === 169 && b === 254) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && b === 0 && c === 0) return false
  if (a === 192 && b === 0 && c === 2) return false
  if (a === 192 && b === 168) return false
  if (a === 198 && (b === 18 || b === 19)) return false
  if (a === 198 && b === 51 && c === 100) return false
  if (a === 203 && b === 0 && c === 113) return false

  // Azure exposes platform services at this otherwise public-looking address.
  if (a === 168 && b === 63 && c === 129 && d === 16) return false

  return true
}

function parseIPv6(address: string) {
  const normalized = address.toLowerCase().split('%')[0]
  const doubleColonParts = normalized.split('::')
  if (doubleColonParts.length > 2) return null

  const parsePart = (part: string) => {
    if (!part) return [] as number[]
    const groups: number[] = []
    for (const token of part.split(':')) {
      if (token.includes('.')) {
        const ipv4 = parseIPv4(token)
        if (!ipv4) return null
        groups.push((ipv4[0] << 8) | ipv4[1], (ipv4[2] << 8) | ipv4[3])
        continue
      }
      if (!/^[0-9a-f]{1,4}$/.test(token)) return null
      groups.push(Number.parseInt(token, 16))
    }
    return groups
  }

  const left = parsePart(doubleColonParts[0])
  const right = parsePart(doubleColonParts[1] ?? '')
  if (!left || !right) return null

  const missing = 8 - left.length - right.length
  if ((doubleColonParts.length === 1 && missing !== 0) || missing < 0) return null
  const groups = [...left, ...Array.from({ length: missing }, () => 0), ...right]
  if (groups.length !== 8) return null

  const bytes = new Uint8Array(16)
  groups.forEach((group, index) => {
    bytes[index * 2] = group >> 8
    bytes[index * 2 + 1] = group & 0xff
  })
  return bytes
}

function hasPrefix(bytes: Uint8Array, prefix: number[], prefixBits: number) {
  const fullBytes = Math.floor(prefixBits / 8)
  const remainingBits = prefixBits % 8

  for (let index = 0; index < fullBytes; index += 1) {
    if (bytes[index] !== prefix[index]) return false
  }

  if (remainingBits === 0) return true
  const mask = (0xff << (8 - remainingBits)) & 0xff
  return (bytes[fullBytes] & mask) === (prefix[fullBytes] & mask)
}

function isPublicIPv6(address: string) {
  const bytes = parseIPv6(address)
  if (!bytes) return false

  // Only globally routable unicast space is accepted. This excludes loopback,
  // link-local, unique-local, multicast, IPv4-mapped and unspecified addresses.
  if ((bytes[0] & 0xe0) !== 0x20) return false

  // Documentation, benchmarking and transition ranges are not destinations for
  // report images and can encapsulate addresses that bypass simple checks.
  if (hasPrefix(bytes, [0x20, 0x01, 0x0d, 0xb8], 32)) return false // 2001:db8::/32
  if (hasPrefix(bytes, [0x20, 0x01, 0x00, 0x02, 0x00, 0x00], 48)) return false // 2001:2::/48
  if (hasPrefix(bytes, [0x20, 0x01, 0x00, 0x00], 32)) return false // Teredo
  if (hasPrefix(bytes, [0x20, 0x02], 16)) return false // 6to4

  return true
}

function isPublicIpAddress(address: string) {
  const family = isIP(address)
  if (family === 4) return isPublicIPv4(address)
  if (family === 6) return isPublicIPv6(address)
  return false
}

function validateSourceUrl(url: URL, policies: Map<string, HostPolicy>) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ImageProxyError('Image URL is not allowed', 400)
  }
  if (url.username || url.password) {
    throw new ImageProxyError('Image URL is not allowed', 400)
  }

  const expectedPort = url.protocol === 'https:' ? '443' : '80'
  if (url.port && url.port !== expectedPort) {
    throw new ImageProxyError('Image URL is not allowed', 400)
  }

  const hostname = normalizedHostname(url.hostname)
  const policy = policies.get(hostname)
  if (!policy) {
    throw new ImageProxyError('Image host is not allowed', 403)
  }
  if (policy.storageOnly && !STORAGE_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    throw new ImageProxyError('Only stored images may be proxied', 403)
  }
}

async function resolvePublicDestination(hostname: string): Promise<ResolvedDestination> {
  const literalFamily = isIP(hostname)
  if (literalFamily) {
    if (!isPublicIpAddress(hostname)) {
      throw new ImageProxyError('Image destination is not allowed', 403)
    }
    return { address: hostname, family: literalFamily as 4 | 6 }
  }

  let addresses: Array<{ address: string; family: number }>
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true })
  } catch {
    throw new ImageProxyError('Image host could not be resolved', 502)
  }

  if (addresses.length === 0 || addresses.some((entry) => !isPublicIpAddress(entry.address))) {
    throw new ImageProxyError('Image destination is not allowed', 403)
  }

  // Prefer IPv4 because some serverless environments advertise IPv6 without
  // providing an outbound IPv6 route. The request is pinned to this checked IP.
  const selected = addresses.find((entry) => entry.family === 4) ?? addresses[0]
  return { address: selected.address, family: selected.family as 4 | 6 }
}

async function requestPinnedUrl(url: URL, signal: AbortSignal) {
  const destination = await resolvePublicDestination(normalizedHostname(url.hostname))
  const request = url.protocol === 'https:' ? httpsRequest : httpRequest

  return await new Promise<IncomingMessage>((resolve, reject) => {
    const upstreamRequest = request(
      {
        protocol: url.protocol,
        hostname: destination.address,
        family: destination.family,
        port: url.protocol === 'https:' ? 443 : 80,
        method: 'GET',
        path: `${url.pathname}${url.search}`,
        headers: {
          Accept: 'image/*',
          'Accept-Encoding': 'identity',
          Host: url.host,
          'User-Agent': 'HusHub-Report-Image-Proxy/1.0',
        },
        servername: isIP(url.hostname) ? undefined : normalizedHostname(url.hostname),
        signal,
      },
      resolve
    )
    upstreamRequest.once('error', reject)
    upstreamRequest.end()
  })
}

function discardResponse(response: IncomingMessage) {
  response.resume()
}

async function fetchValidatedImage(
  sourceUrl: URL,
  policies: Map<string, HostPolicy>,
  signal: AbortSignal
) {
  let currentUrl = sourceUrl

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    validateSourceUrl(currentUrl, policies)
    const response = await requestPinnedUrl(currentUrl, signal)
    const status = response.statusCode ?? 502

    if (REDIRECT_STATUSES.has(status)) {
      const location = response.headers.location
      discardResponse(response)
      if (!location || redirectCount === MAX_REDIRECTS) {
        throw new ImageProxyError('Image redirect was rejected', 502)
      }

      let redirectUrl: URL
      try {
        redirectUrl = new URL(location, currentUrl)
      } catch {
        throw new ImageProxyError('Image redirect was rejected', 502)
      }
      if (currentUrl.protocol === 'https:' && redirectUrl.protocol !== 'https:') {
        throw new ImageProxyError('Image redirect was rejected', 502)
      }
      currentUrl = redirectUrl
      continue
    }

    if (status < 200 || status >= 300) {
      discardResponse(response)
      throw new ImageProxyError('Image fetch failed', 502)
    }

    const contentType = String(response.headers['content-type'] ?? '')
      .split(';', 1)[0]
      .trim()
      .toLowerCase()
    if (!contentType.startsWith('image/') || contentType === 'image/svg+xml') {
      discardResponse(response)
      throw new ImageProxyError('Upstream response is not a supported image', 415)
    }

    const contentLengthHeader = response.headers['content-length']
    if (contentLengthHeader) {
      const contentLength = Number(contentLengthHeader)
      if (!Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > MAX_IMAGE_BYTES) {
        response.destroy()
        throw new ImageProxyError('Image is too large', 413)
      }
    }

    const chunks: Buffer[] = []
    let totalBytes = 0
    for await (const chunk of response) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      totalBytes += buffer.length
      if (totalBytes > MAX_IMAGE_BYTES) {
        response.destroy()
        throw new ImageProxyError('Image is too large', 413)
      }
      chunks.push(buffer)
    }

    if (totalBytes === 0) {
      throw new ImageProxyError('Image response was empty', 502)
    }
    return Buffer.concat(chunks, totalBytes)
  }

  throw new ImageProxyError('Image redirect was rejected', 502)
}

function errorResponse(message: string, status: number) {
  return new NextResponse(message, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const source = searchParams.get('url')
  const maxSidePx = parseBoundedInteger(searchParams.get('max'), DEFAULT_MAX_IMAGE_SIDE_PX, 320, 2400)
  const quality = parseBoundedInteger(searchParams.get('q'), DEFAULT_IMAGE_QUALITY, 45, 90)
  if (!source) {
    return errorResponse('Missing url', 400)
  }
  if (source.length > MAX_SOURCE_URL_LENGTH) {
    return errorResponse('Image URL is too long', 400)
  }

  let sourceUrl: URL
  try {
    sourceUrl = new URL(source)
  } catch {
    return errorResponse('Invalid url', 400)
  }

  const trustedHostPolicies = getTrustedHostPolicies()
  if (trustedHostPolicies.size === 0) {
    return errorResponse('Image proxy is not configured', 503)
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), IMAGE_PROXY_TIMEOUT_MS)

  try {
    const inputBuffer = await fetchValidatedImage(sourceUrl, trustedHostPolicies, controller.signal)
    let resized: Buffer
    try {
      resized = await sharp(inputBuffer, {
        failOn: 'error',
        limitInputPixels: MAX_INPUT_PIXELS,
        sequentialRead: true,
      })
        .rotate()
        .resize({
          width: maxSidePx,
          height: maxSidePx,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({
          quality,
          mozjpeg: true,
        })
        .toBuffer()
    } catch {
      return errorResponse('Image could not be processed', 415)
    }

    if (resized.length > MAX_IMAGE_BYTES) {
      return errorResponse('Processed image is too large', 413)
    }

    return new NextResponse(new Uint8Array(resized), {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    if (
      controller.signal.aborted ||
      (error instanceof Error &&
        (error.name === 'AbortError' || ('code' in error && error.code === 'ABORT_ERR')))
    ) {
      return errorResponse('Image fetch timeout', 504)
    }
    if (error instanceof ImageProxyError) {
      return errorResponse(error.message, error.status)
    }
    return errorResponse('Image fetch error', 502)
  } finally {
    clearTimeout(timeout)
  }
}
