import 'server-only'
import sharp from 'sharp'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getOrganizationSenderWorkspace } from '@/lib/organizations/senderProfiles'
import { isOrganizationUuid } from '@/lib/organizations/administrationHttp'
import { offerId } from './customerOffers'
import { normalizeContractSenderProfile, type ContractSenderProfileSnapshot } from './contractSenderProfile'
import type { OrganizationSenderProfile, OrganizationSenderWorkspace } from '@/lib/organizations/senderProfileTypes'

type Context = { orgId: string; userId: string }
export type ContractSenderSelection = {
  requestId: string; revision: number; profileId: string; profileVersion: number; legalNameVersion: number; organizationNumber: string; confirmed: true
}
export type ContractSenderWorkspace = {
  available: boolean
  organization: OrganizationSenderWorkspace['organization']
  profiles: OrganizationSenderProfile[]
  selected: ContractSenderProfileSnapshot | null
}
const schemaMissing = (code?: string) => ['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205'].includes(code ?? '')
function checked(error: { code?: string; message?: string } | null) {
  if (!error) return
  if (schemaMissing(error.code)) throw new Error('CUSTOMER_SENDER_SCHEMA')
  if (/^CUSTOMER_(SENDER|OFFER)_[A-Z_]+$/u.test(error.message ?? '')) throw new Error(error.message)
  throw new Error('CUSTOMER_SENDER_FAILED')
}

export function parseContractSenderSelection(value: unknown): ContractSenderSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('CUSTOMER_SENDER_INVALID')
  const input = value as Record<string, unknown>
  const keys = ['requestId', 'revision', 'profileId', 'profileVersion', 'legalNameVersion', 'organizationNumber', 'confirmed']
  if (Object.keys(input).length !== keys.length || keys.some(key => !Object.hasOwn(input, key)) || input.confirmed !== true ||
    !isOrganizationUuid(input.requestId) || !isOrganizationUuid(input.profileId) ||
    ['revision', 'profileVersion', 'legalNameVersion'].some(key => !Number.isSafeInteger(input[key]) || Number(input[key]) < 1) ||
    Number(input.revision) > 2147483646 || typeof input.organizationNumber !== 'string' || !/^\d{6}-?\d{4}$/u.test(input.organizationNumber)) throw new Error('CUSTOMER_SENDER_INVALID')
  return { requestId: input.requestId.toLowerCase(), revision: Number(input.revision), profileId: input.profileId.toLowerCase(),
    profileVersion: Number(input.profileVersion), legalNameVersion: Number(input.legalNameVersion), organizationNumber: input.organizationNumber, confirmed: true }
}

async function requireCase(ctx: Context, caseId: string) {
  const result = await createSupabaseAdminClient().from('action_cases').select('id').eq('org_id', ctx.orgId).eq('id', offerId(caseId)).maybeSingle()
  checked(result.error)
  if (!result.data) throw new Error('CUSTOMER_OFFER_NOT_FOUND')
}

/** Context must come from customerOfferContext, including the tasks module check. */
export async function getContractSenderWorkspace(ctx: Context, caseId: string): Promise<ContractSenderWorkspace> {
  await requireCase(ctx, caseId)
  const organization = await getOrganizationSenderWorkspace(ctx.orgId)
  const binding = await createSupabaseAdminClient().from('action_case_contract_senders').select('snapshot')
    .eq('org_id', ctx.orgId).eq('action_case_id', caseId).maybeSingle()
  if (binding.error && !schemaMissing(binding.error.code)) checked(binding.error)
  const available = !organization.migrationRequired && !binding.error
  return { available, organization: organization.organization, profiles: available ? organization.profiles : [],
    selected: available && binding.data ? normalizeContractSenderProfile(binding.data.snapshot) : null }
}

async function freezeLogo(ctx: Context, path: string): Promise<string> {
  if (!new RegExp(`^organizations/${ctx.orgId}/logo-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.(png|jpg|webp)$`, 'i').test(path)) throw new Error('CUSTOMER_SENDER_MEDIA')
  const downloaded = await createSupabaseAdminClient().storage.from('property-media').download(path)
  if (downloaded.error || !downloaded.data || downloaded.data.size > 10 * 1024 * 1024 || downloaded.data.size < 1) throw new Error('CUSTOMER_SENDER_MEDIA')
  try {
    const image = sharp(Buffer.from(await downloaded.data.arrayBuffer()), { failOn: 'error', limitInputPixels: 40_000_000 })
    const metadata = await image.metadata()
    if (!['png', 'jpeg', 'webp'].includes(metadata.format ?? '') || !metadata.width || !metadata.height || (metadata.pages ?? 1) > 1) throw new Error()
    // No network rendering, source metadata or mutable storage dependency in a document.
    let bytes = await image.clone().rotate().resize({ width: 800, height: 300, fit: 'inside', withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer()
    if (bytes.length > 145000) bytes = await image.clone().rotate().resize({ width: 400, height: 150, fit: 'inside', withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer()
    const dataUrl = `data:image/png;base64,${bytes.toString('base64')}`
    if (dataUrl.length > 200000) throw new Error()
    return dataUrl
  } catch { throw new Error('CUSTOMER_SENDER_MEDIA') }
}

export async function selectContractSenderProfile(ctx: Context, caseId: string, value: unknown) {
  const selection = parseContractSenderSelection(value)
  await requireCase(ctx, caseId)
  const db = createSupabaseAdminClient()
  const write = async (logo: string | null) => {
    const result = await db.rpc('select_action_case_contract_sender', { p_org_id: ctx.orgId, p_case_id: offerId(caseId),
      p_user_id: ctx.userId, p_data: selection, p_logo_data_url: logo })
    checked(result.error)
    if (result.data?.saved !== true) throw new Error('CUSTOMER_SENDER_FAILED')
    return { saved: true as const }
  }
  // First reconcile an exact retry without consulting today's profile/image. It
  // also completes logo-free selections. A logo requirement performs no writes.
  try { return await write(null) }
  catch (error) { if (!(error instanceof Error) || error.message !== 'CUSTOMER_SENDER_MEDIA') throw error }
  const profile = await db.from('organization_sender_profiles').select('id,version,logo_path')
    .eq('org_id', ctx.orgId).eq('id', selection.profileId).maybeSingle()
  checked(profile.error)
  if (!profile.data || Number(profile.data.version) !== selection.profileVersion || !profile.data.logo_path) return write(null)
  let logo: string
  try { logo = await freezeLogo(ctx, profile.data.logo_path) }
  catch (error) {
    // Another exact concurrent retry may have committed while storage was read.
    // Let SQL reconcile that request before reporting the image failure.
    try { return await write(null) } catch { throw error }
  }
  return write(logo)
}
