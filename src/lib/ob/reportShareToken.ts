import { createHmac, timingSafeEqual } from 'node:crypto'
import { hashAssignmentToken } from '@/lib/assignments/tokens'
import type { createSupabaseAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createSupabaseAdminClient>
type ReportIdentity = { id: string; orgId: string; inspectionId: string; tokenHash: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function signature(report: ReportIdentity) {
  const secret = process.env.OB_REPORT_LINK_SIGNING_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secret) throw Error('OB_REPORT_LINK_KEY_MISSING')
  return createHmac('sha256', secret)
    .update(`HusHub:ob-report-share:v1:${report.id}:${report.orgId}:${report.inspectionId}:${report.tokenHash}`)
    .digest('base64url')
}

/** An alternate bearer for the same active frozen report; never replaces its original token. */
export function createObReportShareToken(report: ReportIdentity) {
  if (![report.id, report.orgId, report.inspectionId].every(value => UUID.test(value)) || !/^[a-f0-9]{64}$/.test(report.tokenHash)) {
    throw Error('OB_REPORT_LINK_INVALID')
  }
  return `ob1.${report.id}.${signature(report)}`
}

/** Ordinary OB/TU/EB tokens keep their existing lookup and revocation behavior. */
export async function resolveReportTokenHash(admin: Admin, token: string): Promise<string | null> {
  if (!token.startsWith('ob1.')) return hashAssignmentToken(token)
  const parts = token.split('.')
  if (parts.length !== 3 || !UUID.test(parts[1]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[2])) return null
  const { data, error } = await admin.from('inspection_report_links')
    .select('id,org_id,inspection_id,token_hash,revoked_at').eq('id', parts[1]).maybeSingle()
  if (error) throw Error('Kunde inte verifiera utlåtandelänken.')
  if (!data || data.revoked_at || !data.token_hash) return null
  const expected = signature({ id: data.id, orgId: data.org_id, inspectionId: data.inspection_id, tokenHash: data.token_hash })
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(parts[2]))) return null
  return data.token_hash
}
