import {
  buildInspectorCertificationSummary,
  type CertificationCatalogSummaryRow,
  type InspectorCertificationSummary,
  type LegacyInspectorCertificationFields,
  type ProfileCertificationSummaryRow,
} from '@/lib/certifications/profileSummary'

type SupabaseLike = {
  from: (table: string) => any
}

function isMissingSchemaError(message: string) {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('42p01') ||
    normalized.includes('42703') ||
    normalized.includes('does not exist') ||
    normalized.includes('column') ||
    normalized.includes('relation')
  )
}

function normalizeCatalogRows(rows: unknown): CertificationCatalogSummaryRow[] {
  if (!Array.isArray(rows)) return []
  const normalized: CertificationCatalogSummaryRow[] = []

  for (const row of rows) {
    const record = row as Record<string, unknown>
    const id = String(record.id ?? '').trim()
    const key = String(record.key ?? '').trim()
    const name = String(record.name ?? '').trim()
    const category = record.category === 'membership' ? 'membership' : 'certification'
    const sortOrder =
      typeof record.sort_order === 'number' && Number.isFinite(record.sort_order)
        ? record.sort_order
        : null

    if (!id || !key || !name) continue
    normalized.push({
      id,
      key,
      name,
      category,
      sort_order: sortOrder,
    })
  }

  return normalized
}

function normalizeSelectionRows(rows: unknown): ProfileCertificationSummaryRow[] {
  if (!Array.isArray(rows)) return []
  const normalized: ProfileCertificationSummaryRow[] = []

  for (const row of rows) {
    const record = row as Record<string, unknown>
    const certificationId = String(record.certification_id ?? '').trim()
    if (!certificationId) continue
    normalized.push({
      certification_id: certificationId,
      is_enabled: record.is_enabled === true,
      number_value: typeof record.number_value === 'string' ? record.number_value : null,
      valid_to: typeof record.valid_to === 'string' ? record.valid_to : null,
    })
  }

  return normalized
}

function buildLegacyOnlySummary(
  legacy: LegacyInspectorCertificationFields | null | undefined
): InspectorCertificationSummary {
  return buildInspectorCertificationSummary({
    catalog: [],
    selections: [],
    legacy: legacy ?? null,
  })
}

async function resolveOrgIdForProfile(
  supabase: SupabaseLike,
  profileId: string
): Promise<string | null> {
  const { data, error } = await (supabase as any)
    .from('org_members')
    .select('org_id')
    .eq('profile_id', profileId)
    .eq('is_active', true)
    .order('is_default', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    return null
  }

  return typeof data?.org_id === 'string' ? data.org_id : null
}

export async function resolveInspectorCertificationSummary(
  supabase: SupabaseLike,
  params: {
    profileId: string | null | undefined
    orgId?: string | null
    legacy?: LegacyInspectorCertificationFields | null
  }
): Promise<{ orgId: string | null; summary: InspectorCertificationSummary }> {
  const legacyOnly = buildLegacyOnlySummary(params.legacy)
  const profileId = String(params.profileId ?? '').trim()
  if (!profileId) {
    return { orgId: params.orgId ?? null, summary: legacyOnly }
  }

  let resolvedOrgId = params.orgId ?? null
  if (!resolvedOrgId) {
    resolvedOrgId = await resolveOrgIdForProfile(supabase, profileId)
  }
  if (!resolvedOrgId) {
    return { orgId: null, summary: legacyOnly }
  }

  const { data: catalogData, error: catalogError } = await (supabase as any)
    .from('settings_certifications')
    .select('id,key,name,category,sort_order')
    .eq('is_active', true)

  if (catalogError) {
    const message = String(catalogError.message ?? '')
    if (isMissingSchemaError(message)) return { orgId: resolvedOrgId, summary: legacyOnly }
    return { orgId: resolvedOrgId, summary: legacyOnly }
  }

  const { data: selectionData, error: selectionError } = await (supabase as any)
    .from('profile_certifications')
    .select('certification_id,is_enabled,number_value,valid_to')
    .eq('org_id', resolvedOrgId)
    .eq('profile_id', profileId)

  if (selectionError) {
    const message = String(selectionError.message ?? '')
    if (isMissingSchemaError(message)) return { orgId: resolvedOrgId, summary: legacyOnly }
    return { orgId: resolvedOrgId, summary: legacyOnly }
  }

  const summary = buildInspectorCertificationSummary({
    catalog: normalizeCatalogRows(catalogData),
    selections: normalizeSelectionRows(selectionData),
    legacy: params.legacy ?? null,
  })

  return {
    orgId: resolvedOrgId,
    summary,
  }
}
