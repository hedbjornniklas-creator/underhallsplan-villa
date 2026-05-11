import { NextResponse } from 'next/server'
import sharp from 'sharp'

const IMAGE_PROXY_TIMEOUT_MS = Number(process.env.IMAGE_PROXY_TIMEOUT_MS ?? 12000)
const DEFAULT_MAX_IMAGE_SIDE_PX = 1600
const DEFAULT_IMAGE_QUALITY = 72

export const runtime = 'nodejs'

function parseBoundedInteger(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const url = searchParams.get('url')
  const maxSidePx = parseBoundedInteger(searchParams.get('max'), DEFAULT_MAX_IMAGE_SIDE_PX, 320, 2400)
  const quality = parseBoundedInteger(searchParams.get('q'), DEFAULT_IMAGE_QUALITY, 45, 90)
  if (!url) {
    return new NextResponse('Missing url', { status: 400 })
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), IMAGE_PROXY_TIMEOUT_MS)
    const response = await fetch(url, {
      cache: 'force-cache',
      signal: controller.signal,
    }).finally(() => {
      clearTimeout(timeout)
    })
    if (!response.ok) {
      return new NextResponse('Image fetch failed', { status: response.status })
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream'
    const buffer = await response.arrayBuffer()
    const inputBuffer = Buffer.from(buffer)

    if (contentType.toLowerCase().startsWith('image/')) {
      try {
        const resized = await sharp(inputBuffer, { failOn: 'none' })
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

        return new NextResponse(new Uint8Array(resized), {
          status: 200,
          headers: {
            'Content-Type': 'image/jpeg',
            'Cache-Control': 'public, max-age=31536000, immutable',
            'Access-Control-Allow-Origin': '*',
          },
        })
      } catch {
        // Fall back to the original response if the image cannot be processed.
      }
    }

    return new NextResponse(new Uint8Array(inputBuffer), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*',
      },
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return new NextResponse('Image fetch timeout', { status: 504 })
    }
    return new NextResponse('Image fetch error', { status: 500 })
  }
}
