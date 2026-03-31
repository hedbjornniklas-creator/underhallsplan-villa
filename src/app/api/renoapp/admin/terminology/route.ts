import { NextResponse } from 'next/server'
import {
  deleteRenoAppAdminTerminologyTerm,
  listRenoAppAdminTerminology,
  saveRenoAppAdminTerminology,
} from '@/lib/renoapp/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function GET() {
  try {
    const payload = await listRenoAppAdminTerminology()
    return NextResponse.json(payload)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ADMIN_REQUIRED') return jsonError('Endast admin har åtkomst.', 403)
    if (message === 'PROFILE_NOT_FOUND') return jsonError('Ingen profil hittades för användaren.', 403)
    return jsonError(message || 'Kunde inte läsa terminologi.', 500)
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      term?: Record<string, unknown>
      aliases?: Array<Record<string, unknown>>
      rules?: Array<Record<string, unknown>>
    }

    const item = await saveRenoAppAdminTerminology({
      term: {
        id: typeof body.term?.id === 'string' ? body.term.id : null,
        groupId: typeof body.term?.groupId === 'string' ? body.term.groupId : '',
        code: typeof body.term?.code === 'string' ? body.term.code : '',
        label: typeof body.term?.label === 'string' ? body.term.label : '',
        definition: typeof body.term?.definition === 'string' ? body.term.definition : null,
        termLevel:
          body.term?.termLevel === 'technical' ||
          body.term?.termLevel === 'classification' ||
          body.term?.termLevel === 'status' ||
          body.term?.termLevel === 'document_phase' ||
          body.term?.termLevel === 'decision'
            ? body.term.termLevel
            : 'ux',
        inputKind:
          body.term?.inputKind === 'system_internal' || body.term?.inputKind === 'system_generated'
            ? body.term.inputKind
            : 'user_visible',
        isLocked: typeof body.term?.isLocked === 'boolean' ? body.term.isLocked : true,
        isUserSelectable:
          typeof body.term?.isUserSelectable === 'boolean' ? body.term.isUserSelectable : true,
        isSystemGenerated:
          typeof body.term?.isSystemGenerated === 'boolean' ? body.term.isSystemGenerated : false,
        isActive: typeof body.term?.isActive === 'boolean' ? body.term.isActive : true,
        sortOrder:
          typeof body.term?.sortOrder === 'number'
            ? body.term.sortOrder
            : Number(body.term?.sortOrder ?? 100),
        metadata: body.term?.metadata ?? {},
      },
      aliases: (body.aliases ?? []).map((alias) => ({
        id: typeof alias.id === 'string' ? alias.id : null,
        alias: typeof alias.alias === 'string' ? alias.alias : '',
        sortOrder:
          typeof alias.sortOrder === 'number' ? alias.sortOrder : Number(alias.sortOrder ?? 100),
        isActive: typeof alias.isActive === 'boolean' ? alias.isActive : true,
      })),
      rules: (body.rules ?? []).map((rule) => ({
        id: typeof rule.id === 'string' ? rule.id : null,
        ruleKey: typeof rule.ruleKey === 'string' ? rule.ruleKey : '',
        label: typeof rule.label === 'string' ? rule.label : '',
        description: typeof rule.description === 'string' ? rule.description : null,
        config: rule.config ?? {},
        sortOrder: typeof rule.sortOrder === 'number' ? rule.sortOrder : Number(rule.sortOrder ?? 100),
        isActive: typeof rule.isActive === 'boolean' ? rule.isActive : true,
      })),
    })

    return NextResponse.json({ item })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ADMIN_REQUIRED') return jsonError('Endast admin har åtkomst.', 403)
    if (message === 'TERMINOLOGY_GROUP_REQUIRED') return jsonError('Välj termgrupp.', 400)
    if (message === 'TERMINOLOGY_CODE_REQUIRED') return jsonError('Ange intern kod.', 400)
    if (message === 'TERMINOLOGY_LABEL_REQUIRED') return jsonError('Ange visningsnamn.', 400)
    return jsonError(message || 'Kunde inte spara terminologi.', 500)
  }
}

export async function DELETE(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const id = typeof body.id === 'string' ? body.id : ''

    if (!id) {
      return jsonError('Ange vilken terminologityp som ska raderas.', 400)
    }

    await deleteRenoAppAdminTerminologyTerm(id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OkÃ¤nt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ADMIN_REQUIRED') return jsonError('Endast admin har Ã¥tkomst.', 403)
    return jsonError(message || 'Kunde inte radera terminologityp.', 500)
  }
}
