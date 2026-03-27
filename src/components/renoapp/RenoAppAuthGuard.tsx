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

    const checkSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!mounted) return

      if (!session) {
        router.replace('/renoapp/login')
        return
      }

      setLoading(false)
    }

    void checkSession()

    const { data } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      if (!session) {
        router.replace('/renoapp/login')
        return
      }

      if (mounted) {
        setLoading(false)
      }
    })

    return () => {
      mounted = false
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
