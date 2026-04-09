'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabaseClient'

type RenoAppAuthGuardProps = {
  children: ReactNode
}

export default function RenoAppAuthGuard({ children }: RenoAppAuthGuardProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    const redirectToLogin = () => {
      router.replace('/renoapp/login')
      router.refresh()
    }

    const checkSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!mounted) return

      if (!session) {
        redirectToLogin()
        return
      }

      setLoading(false)
    }

    void checkSession()

    const { data } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      if (!session) {
        redirectToLogin()
        return
      }

      if (mounted) {
        setLoading(false)
      }
    })

    const handlePageShow = () => {
      void checkSession()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void checkSession()
      }
    }

    window.addEventListener('pageshow', handlePageShow)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      mounted = false
      window.removeEventListener('pageshow', handlePageShow)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      data.subscription.unsubscribe()
    }
  }, [router])

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-6 text-sm text-stone-600">
        Laddar RenoApp...
      </div>
    )
  }

  return <>{children}</>
}
