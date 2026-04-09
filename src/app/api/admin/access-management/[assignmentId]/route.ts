import { NextResponse } from 'next/server'
import { requireModuleAccess } from '@/lib/access/server'
import { deactivatePlatformAssignment } from '@/lib/access/admin'

type RouteContext = {
  params: Promise<{
    assignmentId: string
  }>
}

export async function DELETE(_: Request, context: RouteContext) {
  try {
    await requireModuleAccess({ productKey: 'hushub_admin', moduleKey: 'access_management' })
    const { assignmentId } = await context.params

    if (!assignmentId) {
      return NextResponse.json({ error: 'Assignment-id saknas.' }, { status: 400 })
    }

    await deactivatePlatformAssignment(assignmentId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    }
    if (error instanceof Error && error.message === 'MODULE_ACCESS_REQUIRED') {
      return NextResponse.json({ error: 'Åtkomst nekad.' }, { status: 403 })
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Kunde inte inaktivera assignment.' },
      { status: 500 }
    )
  }
}
