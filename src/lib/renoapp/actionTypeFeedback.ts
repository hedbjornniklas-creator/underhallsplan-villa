import { sendAssignmentEmail } from '@/lib/assignments/mailer'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type PlatformAssignmentRow = {
  profile_id?: string | null
  expires_at?: string | null
  platform_products?: unknown
  platform_roles?: unknown
}

export type MissingActionTypeFeedbackInput = {
  brfSlug: string
  message: string
  reporterName: string | null
  reporterEmail: string | null
  origin: string
}

function normalizeEmail(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase() ?? ''
  return EMAIL_PATTERN.test(normalized) ? normalized : null
}

function relationKey(value: unknown) {
  const relation = Array.isArray(value) ? value[0] : value
  if (!relation || typeof relation !== 'object') return null
  const key = (relation as Record<string, unknown>).key
  return typeof key === 'string' ? key : null
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildAbsoluteUrl(origin: string, path: string) {
  return `${origin.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`
}

async function listSystemAdminEmails() {
  const admin = createSupabaseAdminClient()
  const legacyProfilesResult = await admin.from('profiles').select('id,email').eq('is_admin', true)

  if (legacyProfilesResult.error) {
    throw new Error(legacyProfilesResult.error.message ?? 'ACTION_TYPE_FEEDBACK_RECIPIENT_LOOKUP_FAILED')
  }

  const profileIds = new Set(
    (legacyProfilesResult.data ?? []).map((profile) => String(profile.id ?? '')).filter(Boolean)
  )
  const emailByProfileId = new Map(
    (legacyProfilesResult.data ?? [])
      .map((profile) => [String(profile.id ?? ''), normalizeEmail(profile.email)] as const)
      .filter((entry): entry is readonly [string, string] => Boolean(entry[0] && entry[1]))
  )

  const assignmentsResult = await admin
    .from('platform_access_assignments')
    .select('profile_id,expires_at,platform_products(key),platform_roles(key)')
    .eq('is_active', true)

  if (!assignmentsResult.error) {
    const now = Date.now()
    for (const assignment of (assignmentsResult.data ?? []) as PlatformAssignmentRow[]) {
      const expiresAt = assignment.expires_at ? new Date(assignment.expires_at).getTime() : null
      if (expiresAt !== null && Number.isFinite(expiresAt) && expiresAt < now) continue
      if (relationKey(assignment.platform_products) !== 'hushub_admin') continue
      if (relationKey(assignment.platform_roles) !== 'hushub_superadmin') continue

      const profileId = String(assignment.profile_id ?? '')
      if (profileId) profileIds.add(profileId)
    }
  }

  const missingProfileIds = Array.from(profileIds).filter((profileId) => !emailByProfileId.has(profileId))
  if (missingProfileIds.length > 0) {
    const profileResult = await admin.from('profiles').select('id,email').in('id', missingProfileIds)
    if (profileResult.error) {
      throw new Error(profileResult.error.message ?? 'ACTION_TYPE_FEEDBACK_RECIPIENT_LOOKUP_FAILED')
    }

    for (const profile of profileResult.data ?? []) {
      const email = normalizeEmail(profile.email)
      if (email) emailByProfileId.set(String(profile.id ?? ''), email)
    }
  }

  return Array.from(new Set(emailByProfileId.values()))
}

export async function sendMissingActionTypeFeedback(input: MissingActionTypeFeedbackInput) {
  const admin = createSupabaseAdminClient()
  const { data: brf, error: brfError } = await admin
    .from('brf_associations')
    .select('id,name,slug,is_public_apply_enabled')
    .eq('slug', input.brfSlug)
    .eq('is_public_apply_enabled', true)
    .maybeSingle()

  if (brfError) {
    throw new Error(brfError.message ?? 'ACTION_TYPE_FEEDBACK_BRF_LOOKUP_FAILED')
  }
  if (!brf) {
    throw new Error('ACTION_TYPE_FEEDBACK_BRF_NOT_FOUND')
  }

  const recipients = await listSystemAdminEmails()
  if (recipients.length === 0) {
    throw new Error('ACTION_TYPE_FEEDBACK_RECIPIENT_MISSING')
  }

  const mailFrom = process.env.ASSIGNMENTS_MAIL_FROM?.trim()
  if (!mailFrom) {
    throw new Error('ACTION_TYPE_FEEDBACK_EMAIL_NOT_CONFIGURED')
  }

  const reporterName = input.reporterName?.trim() || 'Ej angivet'
  const reporterEmail = normalizeEmail(input.reporterEmail)
  const applyUrl = buildAbsoluteUrl(input.origin, `/renoapp/brf/${encodeURIComponent(brf.slug)}/apply`)
  const logoUrl = buildAbsoluteUrl(input.origin, '/landing/Renoapp.png')
  const subject = `RenoApp: förslag på saknad renoveringstyp för ${brf.name}`
  const html = `
    <div style="margin:0;padding:0;background:#f6f1ea;color:#1c1917;font-family:Arial,sans-serif;">
      <div style="max-width:640px;margin:0 auto;padding:32px 20px;">
        <div style="background:#ffffff;border:1px solid #e7e5e4;border-radius:24px;padding:32px;">
          <img src="${logoUrl}" alt="RenoApp" width="132" style="display:block;width:132px;height:auto;margin-bottom:24px;" />
          <h1 style="margin:0 0 20px;font-size:24px;line-height:1.3;">Förslag på renoveringstyp</h1>
          <p style="margin:0 0 12px;"><strong>BRF:</strong> ${escapeHtml(String(brf.name ?? ''))}</p>
          <p style="margin:0 0 12px;"><strong>Avsändare:</strong> ${escapeHtml(reporterName)}</p>
          <p style="margin:0 0 20px;"><strong>E-post:</strong> ${escapeHtml(reporterEmail ?? 'Ej angiven')}</p>
          <div style="margin:0 0 24px;padding:18px;background:#fafaf9;border:1px solid #e7e5e4;white-space:pre-wrap;line-height:1.6;">${escapeHtml(input.message)}</div>
          <p style="margin:0;"><a href="${applyUrl}">Öppna BRF:ens ansökningssida</a></p>
        </div>
      </div>
    </div>
  `
  const text = [
    'Förslag på saknad renoveringstyp i RenoApp',
    `BRF: ${brf.name}`,
    `Avsändare: ${reporterName}`,
    `E-post: ${reporterEmail ?? 'Ej angiven'}`,
    '',
    input.message,
    '',
    `Ansökningssida: ${applyUrl}`,
  ].join('\n')

  const results = await Promise.allSettled(
    recipients.map((recipient) =>
      sendAssignmentEmail({
        to: recipient,
        from: mailFrom,
        replyTo: reporterEmail,
        subject,
        html,
        text,
      })
    )
  )
  const sentCount = results.filter((result) => result.status === 'fulfilled').length

  if (sentCount === 0) {
    const firstFailure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    throw firstFailure?.reason instanceof Error
      ? firstFailure.reason
      : new Error('ACTION_TYPE_FEEDBACK_EMAIL_FAILED')
  }

  if (sentCount < recipients.length) {
    console.error('[renoapp.action-type-feedback] some admin emails failed', {
      sentCount,
      recipientCount: recipients.length,
    })
  }

  return { sentCount }
}
