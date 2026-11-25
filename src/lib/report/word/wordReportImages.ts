import 'server-only'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import type { WordImage } from './buildWordReport'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_SOURCE_TOTAL_BYTES = 256 * 1024 * 1024
const MAX_EMBEDDED_TOTAL_BYTES = 64 * 1024 * 1024

/** No arbitrary remote URLs, redirects, credentials or filesystem paths from a snapshot. */
export function wordImageSource(input: string, storageBase = process.env.NEXT_PUBLIC_SUPABASE_URL):
  { local: string } | { remote: string } {
  if (input.startsWith('/') && !input.startsWith('//')) {
    const path = decodeURIComponent(input)
    if (!/^\/report-assets\/[A-Za-z0-9_./-]+\.(png|jpe?g|webp|svg)$/i.test(path) ||
      path.split('/').some(part => part === '.' || part === '..')) throw Error('WORD_IMAGE_SOURCE_INVALID')
    return { local: path }
  }
  const base = new URL(storageBase ?? '')
  const url = new URL(input, base)
  if (url.protocol !== 'https:' || url.origin !== base.origin || url.username || url.password || url.hash ||
    !/^\/storage\/v1\/object\/(public|sign)\/(inspection-images|property-media)\/.+/.test(url.pathname)) {
    throw Error('WORD_IMAGE_SOURCE_INVALID')
  }
  return { remote: url.href }
}

export function createWordImageLoader() {
  let sourceTotal = 0
  let embeddedTotal = 0
  return async (url: string): Promise<WordImage> => {
    const source = wordImageSource(url)
    let bytes: Buffer
    if ('local' in source) {
      bytes = await readFile(join(process.cwd(), 'public', source.local))
      sourceTotal += bytes.byteLength
      if (bytes.byteLength > MAX_IMAGE_BYTES || sourceTotal > MAX_SOURCE_TOTAL_BYTES) throw Error('WORD_REPORT_TOO_LARGE')
    } else {
      const response = await fetch(source.remote, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(8000) })
      if (!response.ok || !response.body || Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) throw Error('WORD_IMAGE_UNAVAILABLE')
      const chunks: Uint8Array[] = []
      let size = 0
      const reader = response.body.getReader()
      try {
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) break
          size += chunk.value.byteLength
          sourceTotal += chunk.value.byteLength
          if (size > MAX_IMAGE_BYTES || sourceTotal > MAX_SOURCE_TOTAL_BYTES) throw Error('WORD_REPORT_TOO_LARGE')
          chunks.push(chunk.value)
        }
      } finally { await reader.cancel() }
      bytes = Buffer.concat(chunks)
    }
    const image = sharp(bytes, { limitInputPixels: 40000000 })
    const metadata = await image.metadata()
    const resized = image.rotate().resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true })
    // Preserve transparency and crisp local logos; photographs use compact Word-only JPEG copies.
    const format = 'local' in source || metadata.hasAlpha || metadata.format === 'svg' ? 'png' : 'jpg'
    const converted = await (format === 'png' ? resized.png({ compressionLevel: 9 }) :
      resized.jpeg({ quality: 78, mozjpeg: true })).toBuffer({ resolveWithObject: true })
    embeddedTotal += converted.data.byteLength
    if (embeddedTotal > MAX_EMBEDDED_TOTAL_BYTES) throw Error('WORD_REPORT_TOO_LARGE')
    return { data: converted.data, width: converted.info.width, height: converted.info.height, format }
  }
}
