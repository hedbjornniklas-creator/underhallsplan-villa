import 'server-only'

import { NextResponse } from 'next/server'
import {
  RECIPIENT_FIRST_LOGIN_COOKIE,
  RecipientFirstLoginError,
} from './recipientFirstLogin'
import { recipientLoginUrl } from './recipientAuthPaths'

type PublicErrorOptions = {
  attemptsRemaining?: number
  retryAfterSeconds?: number
  loginUrl?: string
}

function jsonError(
  error: string,
  code: string,
  status: number,
  options?: PublicErrorOptions
) {
  const response = NextResponse.json(
    {
      error,
      code,
      ...(options?.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: options.retryAfterSeconds }
        : {}),
      ...(options?.attemptsRemaining !== undefined
        ? { attemptsRemaining: options.attemptsRemaining }
        : {}),
      ...(options?.loginUrl ? { loginUrl: options.loginUrl } : {}),
    },
    { status }
  )
  response.headers.set('Cache-Control', 'no-store')
  if (options?.retryAfterSeconds !== undefined) {
    response.headers.set('Retry-After', String(options.retryAfterSeconds))
  }
  return response
}

function publicCode(error: unknown) {
  const value = error instanceof Error ? error.message : ''
  return /^TASK_[A-Z0-9_]+$/.test(value)
    ? value
    : 'TASK_RECIPIENT_FIRST_LOGIN_FAILED'
}

export function recipientFirstLoginErrorResponse(error: unknown) {
  const code = publicCode(error)
  const details = error instanceof RecipientFirstLoginError ? error : null

  if (code === 'TASK_RECIPIENT_ACCOUNT_LOGIN_REQUIRED') {
    return jsonError(
      'Kontot finns redan. Logga in med ditt lösenord.',
      'ACCOUNT_LOGIN_REQUIRED',
      409,
      { loginUrl: recipientLoginUrl('/mina-uppdrag') }
    )
  }
  if (code === 'TASK_RECIPIENT_FIRST_LOGIN_RATE_LIMITED') {
    return jsonError(
      'För många kodförfrågningar. Vänta en stund och försök igen.',
      'RATE_LIMITED',
      429,
      { retryAfterSeconds: details?.retryAfterSeconds ?? 60 }
    )
  }
  if (code === 'TASK_RECIPIENT_FIRST_LOGIN_SETUP_PENDING') {
    return jsonError(
      'Lösenordsvalet har redan påbörjats. Slutför det i samma webbläsare eller vänta tills koden har gått ut.',
      'SETUP_PENDING',
      409
    )
  }
  if (code === 'TASK_RECIPIENT_FIRST_LOGIN_COOKIE_REQUIRED') {
    return jsonError(
      'Verifieringen saknas eller hör till en annan webbläsare. Begär en ny kod.',
      'COOKIE_REQUIRED',
      401
    )
  }
  if (code === 'TASK_RECIPIENT_FIRST_LOGIN_CODE_INVALID') {
    return jsonError(
      'Koden stämmer inte.',
      'CODE_INVALID',
      400,
      details?.attemptsRemaining !== undefined
        ? { attemptsRemaining: details.attemptsRemaining }
        : undefined
    )
  }
  if (code === 'TASK_RECIPIENT_FIRST_LOGIN_CODE_LOCKED') {
    return jsonError(
      'För många felaktiga försök. Begär en ny kod.',
      'CODE_LOCKED',
      429,
      { attemptsRemaining: 0, retryAfterSeconds: 60 }
    )
  }
  if (
    code === 'TASK_RECIPIENT_FIRST_LOGIN_CODE_EXPIRED'
    || code === 'TASK_RECIPIENT_FIRST_LOGIN_SETUP_INVALID'
  ) {
    return jsonError(
      'Verifieringen har gått ut. Begär en ny kod.',
      code === 'TASK_RECIPIENT_FIRST_LOGIN_CODE_EXPIRED'
        ? 'CODE_EXPIRED'
        : 'SETUP_EXPIRED',
      410
    )
  }
  if (code === 'TASK_RECIPIENT_PASSWORD_TOO_SHORT') {
    return jsonError('Lösenordet måste innehålla minst 8 tecken.', 'PASSWORD_TOO_SHORT', 400)
  }
  if (code === 'TASK_RECIPIENT_PASSWORD_TOO_LONG') {
    return jsonError('Lösenordet får innehålla högst 128 tecken.', 'PASSWORD_TOO_LONG', 400)
  }
  if (code === 'TASK_ACCESS_NOT_FOUND' || code === 'TASK_NOT_FOUND') {
    return jsonError('Uppdragslänken kunde inte hittas.', 'FIRST_LOGIN_UNAVAILABLE', 404)
  }
  if (code === 'TASK_ACCESS_CLOSED') {
    return jsonError('Uppdragslänken har gått ut eller återkallats.', 'FIRST_LOGIN_UNAVAILABLE', 410)
  }
  if (
    code === 'TASK_RECIPIENT_FIRST_LOGIN_UNAVAILABLE'
    || code === 'TASK_RECIPIENT_FIRST_LOGIN_ACCESS_INVALID'
    || code === 'TASK_RECIPIENT_IDENTITY_DISABLED'
  ) {
    return jsonError(
      'Förstainloggning är inte tillgänglig för det här uppdraget.',
      'FIRST_LOGIN_UNAVAILABLE',
      409
    )
  }
  if (
    code.startsWith('TASK_EMAIL_PROVIDER_')
    || code === 'TASK_RECIPIENT_ACCOUNT_CREATE_FAILED'
    || code === 'TASK_RECIPIENT_FIRST_LOGIN_ACTIVATION_FAILED'
    || code === 'TASK_RECIPIENT_ACTIVATION_RECOVERY_REQUIRED'
  ) {
    return jsonError(
      'Tjänsten är tillfälligt otillgänglig. Försök igen om en stund.',
      code === 'TASK_RECIPIENT_ACCOUNT_CREATE_FAILED'
        ? 'ACCOUNT_CREATE_FAILED'
        : 'FIRST_LOGIN_TEMPORARILY_UNAVAILABLE',
      503
    )
  }

  console.error('[tasks.recipient.first-login] request failed', { code })
  return jsonError(
    'Det gick inte att slutföra förstainloggningen just nu.',
    'FIRST_LOGIN_FAILED',
    500
  )
}

export function setRecipientFirstLoginCookie(
  response: NextResponse,
  token: string,
  value: string,
  maxAge: number
) {
  response.cookies.set({
    name: RECIPIENT_FIRST_LOGIN_COOKIE,
    value,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: `/api/signe/${encodeURIComponent(token)}/first-login`,
    maxAge,
  })
  response.headers.set('Cache-Control', 'no-store')
}

export function clearRecipientFirstLoginCookie(response: NextResponse, token: string) {
  response.cookies.set({
    name: RECIPIENT_FIRST_LOGIN_COOKIE,
    value: '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: `/api/signe/${encodeURIComponent(token)}/first-login`,
    maxAge: 0,
  })
  response.headers.set('Cache-Control', 'no-store')
}
