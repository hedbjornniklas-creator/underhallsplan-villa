import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function getRequiredEnv(name: string) {
  const value = process.env[name]
  if (!value || value.trim() === '') {
    throw new Error(`MISSING_ENV:${name}`)
  }
  return value.trim()
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { email?: unknown }
    const email = String(body.email ?? '').trim().toLowerCase()

    if (!EMAIL_REGEX.test(email)) {
      return NextResponse.json({ error: 'Ange en giltig e-postadress.' }, { status: 400 })
    }

    const supabaseUrl = getRequiredEnv('NEXT_PUBLIC_SUPABASE_URL')
    const supabaseAnonKey = getRequiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY')
    const appBaseUrl = getRequiredEnv('APP_BASE_URL').replace(/\/+$/, '')

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${appBaseUrl}/auth/reset-password`,
    })

    if (error) {
      console.error('[auth.reset-password] supabase error', { message: error.message })
      return NextResponse.json({ error: 'Kunde inte skicka aterstallningsmejl.' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okant fel.'

    if (message.startsWith('MISSING_ENV:')) {
      const envName = message.replace('MISSING_ENV:', '')
      return NextResponse.json({ error: `Servern saknar ${envName} i env.` }, { status: 500 })
    }

    return NextResponse.json({ error: 'Kunde inte starta aterstallning.' }, { status: 500 })
  }
}
