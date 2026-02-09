import type { ReportDataV2 } from '@/lib/report/pdfV2/buildReportDataV2'

const IMAGE_POLICY = {
  maxLongSidePx: 1600,
  quality: 70,
  maxImages: 6,
  maxBytes: 6 * 1024 * 1024,
}

const imageCache = new Map<string, string>()

const getCacheKey = (url: string) =>
  `${url}|max=${IMAGE_POLICY.maxLongSidePx}|q=${IMAGE_POLICY.quality}`

const fetchImageBuffer = async (url: string) => {
  const response = await fetch(url, { cache: 'force-cache' })
  if (!response.ok) {
    throw new Error(`Image fetch failed: ${response.status}`)
  }
  const contentType = response.headers.get('content-type') || 'image/jpeg'
  const buffer = Buffer.from(await response.arrayBuffer())
  return { buffer, contentType }
}

const resizeImage = async (buffer: Buffer, contentType: string) => {
  try {
    const mod = await import('sharp')
    const sharp = mod.default ?? mod
    const image = sharp(buffer)
    const metadata = await image.metadata()
    const width = metadata.width ?? null
    const height = metadata.height ?? null

    if (width && height) {
      const maxSide = Math.max(width, height)
      const scale = maxSide > IMAGE_POLICY.maxLongSidePx
        ? IMAGE_POLICY.maxLongSidePx / maxSide
        : 1
      const targetWidth = Math.max(1, Math.round(width * scale))
      const targetHeight = Math.max(1, Math.round(height * scale))

      const resized = await image
        .resize({ width: targetWidth, height: targetHeight, fit: 'inside' })
        .jpeg({ quality: IMAGE_POLICY.quality })
        .toBuffer()

      return { buffer: resized, contentType: 'image/jpeg' }
    }
  } catch {
    // fall through to original buffer
  }

  return { buffer, contentType }
}

const toDataUrl = (buffer: Buffer, contentType: string) =>
  `data:${contentType};base64,${buffer.toString('base64')}`

const collectImageUrls = (data: ReportDataV2) => {
  const mock = data.mock as any
  const blocks = [
    ...(mock?.exterior?.blocks ?? []),
    ...(mock?.interior?.blocks ?? []),
  ] as { photoUrls?: string[] }[]

  const urls: string[] = []
  blocks.forEach((block) => {
    if (Array.isArray(block.photoUrls)) {
      block.photoUrls.forEach((url) => {
        if (url && !urls.includes(url)) urls.push(url)
      })
    }
  })

  return urls
}

export async function preparePdfImagesV2(data: ReportDataV2) {
  const urls = collectImageUrls(data).slice(0, IMAGE_POLICY.maxImages)
  const imageMap: Record<string, string> = {}

  for (const url of urls) {
    const cacheKey = getCacheKey(url)
    const cached = imageCache.get(cacheKey)
    if (cached) {
      imageMap[url] = cached
      continue
    }

    try {
      const { buffer, contentType } = await fetchImageBuffer(url)
      const resized = await resizeImage(buffer, contentType)
      if (resized.buffer.byteLength > IMAGE_POLICY.maxBytes) {
        continue
      }
      const dataUrl = toDataUrl(resized.buffer, resized.contentType)
      imageCache.set(cacheKey, dataUrl)
      imageMap[url] = dataUrl
    } catch {
      // Skip images that fail to load
    }
  }

  return imageMap
}
