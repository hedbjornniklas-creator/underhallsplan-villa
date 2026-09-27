import type { SupabaseClient } from '@supabase/supabase-js'

export function normalizeProfileWebsite(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const text = value.trim()
  if (text.length > 253 || /\s/.test(text)) throw new Error('Ange en giltig hemsida, till exempel https://foretag.se.')
  try {
    const url = new URL(text.includes('://') ? text : `https://${text}`)
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname.includes('.') || url.username || url.password) throw new Error()
  } catch {
    throw new Error('Ange en giltig hemsida, till exempel https://foretag.se.')
  }
  return text
}

export async function readProfileWebsite(db: Pick<SupabaseClient, 'from'>, profileId: string | null) {
  if (!profileId) return { supported: true, value: null }
  const { data, error } = await db.from('profiles').select('company_website').eq('id', profileId).maybeSingle()
  if (error) {
    if (['42703', 'PGRST204'].includes(error.code) && error.message.includes('company_website')) return { supported: false, value: null }
    throw new Error('Kunde inte hämta företagets hemsida.')
  }
  return { supported: true, value: typeof data?.company_website === 'string' ? data.company_website.trim() || null : null }
}

export async function readReportWebsite(db: Pick<SupabaseClient, 'from'>, profileId: string | null, frozenProfile: Record<string, unknown> | null) {
  // A missing or empty historical field must never fall back to today's profile.
  if (frozenProfile) return typeof frozenProfile.company_website === 'string' ? frozenProfile.company_website : null
  return (await readProfileWebsite(db, profileId)).value
}
