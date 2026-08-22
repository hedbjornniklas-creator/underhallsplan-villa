import { NextResponse } from 'next/server'
import { acceptRecipientActivation } from '@/lib/tasks/recipientAuth'
import { recipientLoginUrl } from '@/lib/tasks/recipientAuthPaths'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ token: string }>
}

function jsonError(message: string, status: number, extras?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extras }, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request, context: RouteContext) {
  const { token } = await context.params
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const result = await acceptRecipientActivation({
      token,
      password: body.password,
      displayName: body.displayName,
    })
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const code = error instanceof Error ? error.message : 'TASK_RECIPIENT_ACTIVATION_FAILED'
    const activationPath = `/mina-uppdrag/aktivera/${encodeURIComponent(token)}`

    if (code === 'TASK_RECIPIENT_ACTIVATION_INVALID') {
      return jsonError('Aktiveringslänken är ogiltig, använd eller har gått ut.', 409)
    }
    if (code === 'TASK_RECIPIENT_ACCOUNT_LOGIN_REQUIRED') {
      return jsonError(
        'E-postadressen har redan ett HusHub-konto. Logga in och öppna länken igen.',
        409,
        { loginUrl: recipientLoginUrl(activationPath) }
      )
    }
    if (code === 'TASK_RECIPIENT_EMAIL_MISMATCH') {
      return jsonError('Du är inloggad med en annan e-postadress än den som fick uppdraget.', 409)
    }
    if (code === 'TASK_RECIPIENT_EMAIL_NOT_VERIFIED') {
      return jsonError('E-postadressen på det inloggade kontot är inte verifierad.', 409)
    }
    if (
      code === 'TASK_RECIPIENT_IDENTITY_ALREADY_BOUND' ||
      code === 'TASK_RECIPIENT_AUTH_USER_ALREADY_BOUND'
    ) {
      return jsonError(
        'Mottagarkontot är redan kopplat till ett annat HusHub-konto. Logga ut och använd kontot som tidigare aktiverades.',
        409,
        { loginUrl: recipientLoginUrl(activationPath) }
      )
    }
    if (code === 'TASK_RECIPIENT_PASSWORD_TOO_SHORT') {
      return jsonError('Lösenordet måste vara minst 8 tecken.', 400)
    }
    if (code === 'TASK_RECIPIENT_PASSWORD_TOO_LONG') {
      return jsonError('Lösenordet får vara högst 128 tecken.', 400)
    }
    if (code === 'TASK_RECIPIENT_ACCOUNT_CREATE_FAILED') {
      return jsonError('Kontot kunde inte skapas just nu.', 500)
    }
    if (code === 'TASK_RECIPIENT_ACTIVATION_RECOVERY_REQUIRED') {
      return jsonError(
        'Kontot skapades men aktiveringen behöver slutföras. Logga in med lösenordet du valde och öppna länken igen.',
        503,
        { loginUrl: recipientLoginUrl(activationPath) }
      )
    }
    console.error('[tasks.recipient.activation.accept] failed', { code })
    return jsonError('Kontot kunde inte aktiveras just nu.', 500)
  }
}
