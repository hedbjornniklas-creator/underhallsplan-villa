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
  return {
    full_name: normalizeText(source.full_name),
    sbr_group: normalizeText(source.sbr_group),
    sbr_status: normalizeText(source.sbr_status),
    membership_number: normalizeText(source.membership_number),
    certification_number: normalizeText(source.certification_number),
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
