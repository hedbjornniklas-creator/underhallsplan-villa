import { NextResponse } from 'next/server'
import { requireModuleAccess } from '@/lib/access/server'
import { listAccessManagementData, savePlatformAssignment } from '@/lib/access/admin'

export async function GET() {
  try {
    await requireModuleAccess({ productKey: 'hushub_admin', moduleKey: 'access_management' })
    const data = await listAccessManagementData()
    return NextResponse.json(data)
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    }
    if (error instanceof Error && error.message === 'MODULE_ACCESS_REQUIRED') {
      return NextResponse.json({ error: 'Åtkomst nekad.' }, { status: 403 })
    }
    if (error instanceof Error && error.message === 'ACCESS_SCHEMA_REQUIRED') {
      return NextResponse.json(
        { error: 'Accessmodellen är inte migrerad ännu. Kör platform_access-migreringen först.' },
        { status: 409 }
      )
    }

    return NextResponse.json({ error: 'Kunde inte läsa accesshanteringen.' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    await requireModuleAccess({ productKey: 'hushub_admin', moduleKey: 'access_management' })
    const body = (await request.json().catch(() => ({}))) as {
      profileId?: string
      productId?: string
      moduleId?: string | null
      roleId?: string
      scopeType?: 'global' | 'brf' | 'organization' | 'property' | 'case'
      scopeId?: string | null
      grantedReason?: string | null
      expiresAt?: string | null
    }

    if (!body.profileId || !body.productId || !body.roleId || !body.scopeType) {
      return NextResponse.json({ error: 'Obligatoriska fält saknas.' }, { status: 400 })
    }

    await savePlatformAssignment({
      profileId: body.profileId,
      productId: body.productId,
      moduleId: body.moduleId ?? null,
      roleId: body.roleId,
      scopeType: body.scopeType,
      scopeId: body.scopeId ?? null,
      grantedReason: body.grantedReason ?? null,
      expiresAt: body.expiresAt ?? null,
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    }
    if (error instanceof Error && error.message === 'MODULE_ACCESS_REQUIRED') {
      return NextResponse.json({ error: 'Åtkomst nekad.' }, { status: 403 })
    }
    if (error instanceof Error && error.message === 'ACCESS_SCHEMA_REQUIRED') {
      return NextResponse.json(
        { error: 'Accessmodellen är inte migrerad ännu. Kör platform_access-migreringen först.' },
        { status: 409 }
      )
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Kunde inte spara assignment.' },
      { status: 500 }
    )
  }
}
