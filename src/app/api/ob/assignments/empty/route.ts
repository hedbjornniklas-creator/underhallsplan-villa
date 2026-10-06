import { requireObContext } from '@/lib/ob/organizationBindings'
import { obRequestOrgId, obOrganizationFailure } from '@/lib/ob/organizationHttp'
import { NextResponse } from 'next/server'
import { createAssignment } from '@/lib/assignments/server'
import { assertOrganizationSameOrigin } from '@/lib/organizations/administrationHttp'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function buildDraftEmail() {
  const stamp = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return `utkast-${stamp}-${rand}@pending.besiktapp.local`
}

export async function POST(request: Request) {
  try {
    const context = await requireObContext(obRequestOrgId(request, true), true)
    assertOrganizationSameOrigin(request)

    const assignment = await createAssignment({
      orgId: context.orgId,
      createdBy: context.userId,
      responsibleProfileId: context.userId,
      assignmentType: 'OB',
      customerEmail: buildDraftEmail(),
      customerName: null,
      customerPhone: null,
      preliminaryAddress: null,
      preferredDate: null,
      preferredTime: null,
      notesInternal: null,
    })

    return NextResponse.json({ assignment }, { status: 201 })
  } catch (error) {
    const organizationFailure = obOrganizationFailure(error)
    if (organizationFailure) return organizationFailure

    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
    return jsonError('Kunde inte skapa tom uppdragsbekräftelse.', 500)
  }
}
