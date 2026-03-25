import { NextResponse } from 'next/server'
import { requireOrgContext } from '@/lib/assignments/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type FrozenInspectorPayload = {
  full_name: string | null
  sbr_group: string | null
  sbr_status: string | null
  membership_number: string | null
  certification_number: string | null
  certification_items: Array<{
    key: string
    name: string
    category: 'certification' | 'membership'
    sort_order: number | null
    number_value: string | null
    valid_to: string | null
  }>
  phone: string | null
  email: string | null
  company_name: string | null
  company_orgno: string | null
  company_address: string | null
  company_postal_code: string | null
  company_city: string | null
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeFrozenProfile(value: unknown): FrozenInspectorPayload | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  const rawItems = Array.isArray(source.certification_items) ? source.certification_items : []
  const certificationItems = rawItems
    .map((row) => {
      if (!row || typeof row !== 'object') return null
      const item = row as Record<string, unknown>
      const key = normalizeText(item.key)
      const name = normalizeText(item.name)
      const category = item.category === 'membership' ? 'membership' : 'certification'
      if (!key || !name) return null
      return {
        key,
        name,
        category,
        sort_order:
          typeof item.sort_order === 'number' && Number.isFinite(item.sort_order)
            ? item.sort_order
            : null,
        number_value: normalizeText(item.number_value),
        valid_to: normalizeText(item.valid_to),
      }
    })
    .filter(
      (
        row
      ): row is {
        key: string
        name: string
        category: 'certification' | 'membership'
        sort_order: number | null
        number_value: string | null
        valid_to: string | null
      } => row !== null
    )

  return {
    full_name: normalizeText(source.full_name),
    sbr_group: normalizeText(source.sbr_group),
    sbr_status: normalizeText(source.sbr_status),
    membership_number: normalizeText(source.membership_number),
    certification_number: normalizeText(source.certification_number),
    certification_items: certificationItems,
    phone: normalizeText(source.phone),
    email: normalizeText(source.email),
    company_name: normalizeText(source.company_name),
    company_orgno: normalizeText(source.company_orgno),
    company_address: normalizeText(source.company_address),
    company_postal_code: normalizeText(source.company_postal_code),
    company_city: normalizeText(source.company_city),
  }
}

function extractFrozenProfileFromSnapshot(snapshotPayload: unknown): FrozenInspectorPayload | null {
  if (!snapshotPayload || typeof snapshotPayload !== 'object') return null
  const root = snapshotPayload as Record<string, unknown>
  const reportData = root.reportData
  if (!reportData || typeof reportData !== 'object') return null
  const mock = (reportData as Record<string, unknown>).mock
  if (!mock || typeof mock !== 'object') return null
  const profile = (mock as Record<string, unknown>).profile
  return normalizeFrozenProfile(profile)
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params
    const org = await requireOrgContext()
    const admin = createSupabaseAdminClient()

    const { data: inspection, error: inspectionError } = await admin
      .from('inspections')
      .select('id,property_id,locked_at')
      .eq('id', id)
      .maybeSingle()

    if (inspectionError) {
      throw new Error(inspectionError.message ?? 'Kunde inte läsa besiktning.')
    }
    if (!inspection) return jsonError('Besiktningen hittades inte.', 404)

    const { data: property, error: propertyError } = await admin
      .from('properties')
      .select('id,owner')
      .eq('id', inspection.property_id)
      .maybeSingle()

    if (propertyError) {
      throw new Error(propertyError.message ?? 'Kunde inte läsa fastighet.')
    }

    const propertyOwner = String(property?.owner ?? '').trim()
    if (!propertyOwner || propertyOwner !== org.userId) {
      return jsonError('Du får bara läsa dina egna besiktningar.', 403)
    }

    if (!inspection.locked_at) {
      return NextResponse.json({
        locked: false,
        hasSnapshot: false,
        profile: null,
      })
    }

    const { data: reportLinks, error: reportLinksError } = await admin
      .from('inspection_report_links')
      .select('snapshot_payload,created_at')
      .eq('inspection_id', id)
      .is('revoked_at', null)
      .order('created_at', { ascending: false })
      .limit(10)

    if (reportLinksError) {
      throw new Error(reportLinksError.message ?? 'Kunde inte läsa rapportsnapshots.')
    }

    let frozenProfile: FrozenInspectorPayload | null = null
    for (const row of Array.isArray(reportLinks) ? reportLinks : []) {
      const candidate = extractFrozenProfileFromSnapshot(
        (row as { snapshot_payload?: unknown }).snapshot_payload
      )
      if (candidate) {
        frozenProfile = candidate
        break
      }
    }

    return NextResponse.json({
      locked: true,
      hasSnapshot: Boolean(frozenProfile),
      profile: frozenProfile,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
    return jsonError(message || 'Kunde inte läsa låst besiktningsmansdata.', 500)
  }
}
