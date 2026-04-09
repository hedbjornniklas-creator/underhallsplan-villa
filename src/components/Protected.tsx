'use client'

import { ReactNode, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'

type ProtectedProps = {
  children: ReactNode
}

export default function Protected({ children }: ProtectedProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    const redirectToLogin = () => {
      router.replace('/login')
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

    const { data: listener } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
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
      listener.subscription.unsubscribe()
    }
  }, [router])

  if (loading) {
    return <div className="flex h-screen items-center justify-center text-gray-600">Laddar...</div>
  }

  return <>{children}</>
}
