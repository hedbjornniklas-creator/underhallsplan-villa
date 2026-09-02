import { NextResponse } from 'next/server'
import {
  deleteRenoAppAdminActionType,
  listRenoAppAdminActionTypes,
  saveRenoAppAdminActionType,
} from '@/lib/renoapp/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function contractorRequirement(value: unknown) {
  if (
    value === 'none'
    || value === 'qualified_contractor'
    || value === 'authorized_electrician'
    || value === 'safe_water'
    || value === 'bkr_or_gvk'
    || value === 'structural_engineer'
  ) return value
  return undefined
}

export async function GET() {
  try {
    const items = await listRenoAppAdminActionTypes()
    return NextResponse.json({ items })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ADMIN_REQUIRED') return jsonError('Endast admin har åtkomst.', 403)
    if (message === 'PROFILE_NOT_FOUND') return jsonError('Ingen profil hittades för användaren.', 403)
    return jsonError(message || 'Kunde inte läsa renoveringstyper.', 500)
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const item = await saveRenoAppAdminActionType({
      id: typeof body.id === 'string' ? body.id : null,
      categoryId:
        typeof body.categoryId === 'string' || body.categoryId === null
          ? body.categoryId
          : undefined,
      key: typeof body.key === 'string' ? body.key : '',
      label: typeof body.label === 'string' ? body.label : '',
      description: typeof body.description === 'string' ? body.description : null,
      riskLevel:
        body.riskLevel === 'low' || body.riskLevel === 'medium' || body.riskLevel === 'high'
          ? body.riskLevel
          : undefined,
      contractorRequirement: contractorRequirement(body.contractorRequirement),
      impliesStructure: typeof body.impliesStructure === 'boolean' ? body.impliesStructure : undefined,
      impliesPlumbing: typeof body.impliesPlumbing === 'boolean' ? body.impliesPlumbing : undefined,
      impliesVentilation: typeof body.impliesVentilation === 'boolean' ? body.impliesVentilation : undefined,
      impliesElectrical: typeof body.impliesElectrical === 'boolean' ? body.impliesElectrical : undefined,
      impliesWetRoom: typeof body.impliesWetRoom === 'boolean' ? body.impliesWetRoom : undefined,
      impliesSurfaceOnly: typeof body.impliesSurfaceOnly === 'boolean' ? body.impliesSurfaceOnly : undefined,
      sortOrder:
        typeof body.sortOrder === 'number'
          ? body.sortOrder
          : typeof body.sortOrder === 'string'
            ? Number(body.sortOrder)
            : undefined,
      isActive: typeof body.isActive === 'boolean' ? body.isActive : undefined,
    })
    return NextResponse.json({ item })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ADMIN_REQUIRED') return jsonError('Endast admin har åtkomst.', 403)
    if (message === 'ACTION_TYPE_KEY_REQUIRED') return jsonError('Ange intern nyckel.', 400)
    if (message === 'ACTION_TYPE_LABEL_REQUIRED') return jsonError('Ange visningsnamn.', 400)
    return jsonError(message || 'Kunde inte spara renoveringstyp.', 500)
  }
}

export async function DELETE(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const id = typeof body.id === 'string' ? body.id : ''

    if (!id) {
      return jsonError('Ange vilken renoveringstyp som ska raderas.', 400)
    }

    await deleteRenoAppAdminActionType(id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OkÃ¤nt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ADMIN_REQUIRED') return jsonError('Endast admin har Ã¥tkomst.', 403)
    return jsonError(message || 'Kunde inte radera renoveringstyp.', 500)
  }
}
