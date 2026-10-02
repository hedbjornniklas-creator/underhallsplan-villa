import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { requireOrganizationAdmin } from '@/lib/organizations/administration'
import { organizationJson, organizationFailure, assertOrganizationSameOrigin, organizationOrgId } from '@/lib/organizations/administrationHttp'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { readOrganizationMultipart } from '@/lib/organizations/multipart'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    assertOrganizationSameOrigin(request)
    const context = await requireOrganizationAdmin(organizationOrgId(request))
    const form = await readOrganizationMultipart(request)
    const file = form.get('file')
    if ([...form.keys()].length !== 1 || !(file instanceof File) || file.size <= 0 || file.size > 5 * 1024 * 1024) throw new Error('ORG_INPUT_INVALID')
    const buffer = Buffer.from(await file.arrayBuffer())
    const image = sharp(buffer, { failOn: 'error', limitInputPixels: 40_000_000 })
    const metadata = await image.metadata()
    if (!['png', 'jpeg', 'webp'].includes(metadata.format ?? '') || !metadata.width || !metadata.height || metadata.pages && metadata.pages > 1) throw new Error('ORG_INPUT_INVALID')
    // Decode and re-encode: validated pixels only, immutable address, no uploaded metadata.
    const output = await image.rotate().png().toBuffer()
    if (output.length > 10 * 1024 * 1024) throw new Error('ORG_INPUT_INVALID')
    const path = `organizations/${context.organization.id}/logo-${randomUUID()}.png`
    const { error } = await createSupabaseAdminClient().storage.from('property-media').upload(path, output, {
      contentType: 'image/png', cacheControl: '31536000', upsert: false,
    })
    if (error) throw new Error('ORG_MEDIA_UPLOAD_FAILED')
    return organizationJson({ path }, 201)
  } catch (error) { return organizationFailure(error) }
}
