import { NextResponse } from 'next/server'

const IMAGE_PROXY_TIMEOUT_MS = Number(process.env.IMAGE_PROXY_TIMEOUT_MS ?? 12000)

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const url = searchParams.get('url')
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

    return new NextResponse(buffer, {
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
