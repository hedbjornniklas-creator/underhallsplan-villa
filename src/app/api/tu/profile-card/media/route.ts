import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { requireTuContext } from '@/lib/tu/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_FILE_SIZE = 5 * 1024 * 1024
const MAX_PIXEL_COUNT = 40_000_000
const ALLOWED_FIELDS = new Set(['avatarPath', 'logoPath', 'signaturePath'])
const RESPONSE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  'X-Robots-Tag': 'noindex, nofollow',
  Vary: 'Cookie',
}

function jsonError(message: string, status: number, code: string) {
  return NextResponse.json({ error: message, code }, { status, headers: RESPONSE_HEADERS })
}

function assertSameOrigin(request: Request) {
  const expectedOrigin = new URL(request.url).origin
  const origin = request.headers.get('origin')
  const fetchSite = request.headers.get('sec-fetch-site')?.toLowerCase()
  if (origin && origin !== expectedOrigin) throw new Error('ORG_PROFILE_MEDIA_FORBIDDEN')
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    throw new Error('ORG_PROFILE_MEDIA_FORBIDDEN')
  }
}

function detectImage(buffer: Buffer) {
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { extension: 'png', contentType: 'image/png' }
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { extension: 'jpg', contentType: 'image/jpeg' }
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { extension: 'webp', contentType: 'image/webp' }
  }
  return null
}

function mapError(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401, message)
  if (message === 'ORG_SELECTION_INVALID') {
    return jsonError('Den valda organisationen är ogiltig.', 400, message)
  }
  if (message === 'ORG_MEMBERSHIP_REQUIRED' || message === 'MODULE_ACCESS_REQUIRED') {
    return jsonError('Du saknar TU-behörighet i den valda organisationen.', 403, message)
  }
  if (message === 'ORG_PROFILE_MEDIA_FORBIDDEN') {
    return jsonError('Begäran kommer från fel webbplats.', 403, message)
  }
  return null
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const searchParams = new URL(request.url).searchParams
    if (
      [...searchParams.keys()].some((key) => key !== 'orgId' && key !== 'field') ||
      searchParams.getAll('orgId').length !== 1 ||
      searchParams.getAll('field').length !== 1
    ) {
      return jsonError('Begäran är ogiltig.', 400, 'ORG_PROFILE_MEDIA_INVALID')
    }

    const field = searchParams.get('field') ?? ''
    if (!ALLOWED_FIELDS.has(field)) {
      return jsonError('Bildtypen är ogiltig.', 400, 'ORG_PROFILE_MEDIA_INVALID')
    }
    const context = await requireTuContext(searchParams.get('orgId'))
    const form = await request.formData()
    if ([...form.keys()].some((key) => key !== 'file')) {
      return jsonError('Begäran är ogiltig.', 400, 'ORG_PROFILE_MEDIA_INVALID')
    }
    const file = form.get('file')
    if (!(file instanceof File) || file.size <= 0 || file.size > MAX_FILE_SIZE) {
      return jsonError('Välj en PNG-, JPEG- eller WebP-bild på högst 5 MB.', 400, 'ORG_PROFILE_MEDIA_INVALID')
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const detected = detectImage(buffer)
    if (!detected || (file.type && file.type !== detected.contentType)) {
      return jsonError('Filen är inte en giltig PNG-, JPEG- eller WebP-bild.', 400, 'ORG_PROFILE_MEDIA_INVALID')
    }

    const metadata = await sharp(buffer, { failOn: 'error' }).metadata()
    const width = metadata.width ?? 0
    const height = metadata.height ?? 0
    if (!width || !height || width * height > MAX_PIXEL_COUNT) {
      return jsonError('Bilden har ogiltiga eller för stora dimensioner.', 400, 'ORG_PROFILE_MEDIA_INVALID')
    }

    const storagePath = [
      'profiles',
      context.userId,
      'organizations',
      context.orgId,
      `${field}-${randomUUID()}.${detected.extension}`,
    ].join('/')
    const admin = createSupabaseAdminClient()
    const { error: uploadError } = await admin.storage
      .from('property-media')
      .upload(storagePath, buffer, {
        cacheControl: '31536000',
        contentType: detected.contentType,
        upsert: false,
      })
    if (uploadError) throw uploadError

    const publicUrl = admin.storage.from('property-media').getPublicUrl(storagePath).data.publicUrl
    return NextResponse.json(
      { path: storagePath, publicUrl },
      { status: 201, headers: RESPONSE_HEADERS }
    )
  } catch (error) {
    const mapped = mapError(error)
    if (mapped) return mapped
    return jsonError('Bilden kunde inte laddas upp.', 500, 'ORG_PROFILE_MEDIA_UPLOAD_FAILED')
  }
}
