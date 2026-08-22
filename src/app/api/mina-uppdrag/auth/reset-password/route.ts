import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { safeRecipientReturnTo } from '@/lib/tasks/recipientAuthPaths'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`MISSING_ENV:${name}`)
  return value
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { email?: unknown; next?: unknown }
    const email = typeof body.email === 'string' ? body.email.trim().toLocaleLowerCase('sv-SE') : ''
    if (!EMAIL_PATTERN.test(email)) {
      return NextResponse.json({ error: 'Ange en giltig e-postadress.' }, { status: 400 })
    }

    const baseUrl = requiredEnvironment('APP_BASE_URL').replace(/\/+$/, '')
    const next = safeRecipientReturnTo(body.next)
    const redirectUrl = new URL('/mina-uppdrag/logga-in', `${baseUrl}/`)
    redirectUrl.searchParams.set('mode', 'recovery')
    redirectUrl.searchParams.set('next', next)

    const auth = createClient(
      requiredEnvironment('NEXT_PUBLIC_SUPABASE_URL'),
      requiredEnvironment('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
      { auth: { persistSession: false, autoRefreshToken: false } }
    )
    const { error } = await auth.auth.resetPasswordForEmail(email, {
      redirectTo: redirectUrl.toString(),
    })

    // Do not reveal whether an address has a recipient account. Supabase still
    // applies its own delivery and rate-limit safeguards.
    if (error) {
      console.error('[tasks.recipient.reset-password] provider error', { message: error.message })
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message.startsWith('MISSING_ENV:')) {
      return NextResponse.json({ error: 'Lösenordsåterställningen är inte konfigurerad.' }, { status: 500 })
    }
    return NextResponse.json({ error: 'Kunde inte starta lösenordsåterställningen.' }, { status: 500 })
  }
}
