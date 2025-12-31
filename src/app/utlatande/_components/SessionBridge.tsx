'use client'

import { useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabaseClient'

const STORAGE_KEY_SUFFIX = '-auth-token'
const BRIDGE_FLAG = 'sb-session-bridge-done'

const getLegacySessionFromStorage = () => {
  if (typeof window === 'undefined') return null
  const keys = Object.keys(localStorage)
  const legacyKey = keys.find(key => key.startsWith('sb-') && key.endsWith(STORAGE_KEY_SUFFIX))
  if (!legacyKey) return null
  const raw = localStorage.getItem(legacyKey)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw)
    const session = parsed?.currentSession ?? parsed
    if (!session?.access_token || !session?.refresh_token) return null
    return session
  } catch {
    return null
  }
}

const getLegacySessionFromV1 = () => {
  if (typeof window === 'undefined') return null
  const raw = localStorage.getItem('supabase.auth.token')
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw)
    const session = parsed?.currentSession ?? parsed
    if (!session?.access_token || !session?.refresh_token) return null
    return session
  } catch {
    return null
  }
}

export default function SessionBridge() {
  useEffect(() => {
    const run = async () => {
      if (typeof window === 'undefined') return
      if (sessionStorage.getItem(BRIDGE_FLAG)) return

      const hasSupabaseCookie = document.cookie
        .split(';')
        .some(cookie => cookie.trim().startsWith('sb-'))
      if (hasSupabaseCookie) return

      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      if (!supabaseUrl || !supabaseAnonKey) return

      try {
        const legacyClient = createClient(supabaseUrl, supabaseAnonKey)
        const legacySession =
          (await legacyClient.auth.getSession()).data.session ??
          getLegacySessionFromStorage() ??
          getLegacySessionFromV1()

        if (!legacySession) return

        sessionStorage.setItem(BRIDGE_FLAG, '1')

        await supabase.auth.setSession({
          access_token: legacySession.access_token,
          refresh_token: legacySession.refresh_token,
        })

        window.location.reload()
      } catch {
        // tyst fallback för att inte störa renderingen
      }
    }

    void run()
  }, [])

  return null
}
