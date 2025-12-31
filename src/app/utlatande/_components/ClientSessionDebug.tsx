'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

type DebugState = {
  hasSession: boolean
  userId: string | null
  cookieString: string
  cookieNames: string[]
  localStorageKeys: string[]
}

export default function ClientSessionDebug() {
  const [state, setState] = useState<DebugState>({
    hasSession: false,
    userId: null,
    cookieString: '',
    cookieNames: [],
    localStorageKeys: [],
  })

  useEffect(() => {
    const run = async () => {
      const { data } = await supabase.auth.getSession()
      const cookieString = typeof document !== 'undefined' ? document.cookie : ''
      const cookieNames = cookieString
        .split(';')
        .map(item => item.trim())
        .filter(Boolean)
        .map(item => item.split('=')[0])
      const localStorageKeys =
        typeof window !== 'undefined' ? Object.keys(localStorage) : []

      setState({
        hasSession: Boolean(data.session),
        userId: data.session?.user?.id ?? null,
        cookieString,
        cookieNames,
        localStorageKeys,
      })
    }

    void run()
  }, [])

  return (
    <div className="mt-2 rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-700">
      <div className="font-semibold">Klientdiagnostik</div>
      <div>Session: {state.hasSession ? 'finns' : 'saknas'}</div>
      <div>Användar-ID: {state.userId ?? 'saknas'}</div>
      <div>Cookies: {state.cookieNames.length ? state.cookieNames.join(', ') : 'saknas'}</div>
      <div>localStorage-nycklar: {state.localStorageKeys.length ? state.localStorageKeys.join(', ') : 'saknas'}</div>
      <div className="mt-2 whitespace-pre-wrap break-all">
        document.cookie: {state.cookieString || 'saknas'}
      </div>
    </div>
  )
}
