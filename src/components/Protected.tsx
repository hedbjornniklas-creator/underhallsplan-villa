'use client'

import { ReactNode, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

type ProtectedProps = {
  children: ReactNode
  // vi behåller prop:en ifall du redan använder den, men den används inte här
  hideSidebar?: boolean
}

export default function Protected({ children }: ProtectedProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const checkSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session) {
        router.push('/login')
        return
      }

      setLoading(false)
    }

    checkSession()

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        router.push('/login')
      }
    })

    return () => {
      listener.subscription.unsubscribe()
    }
  }, [router])

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-gray-600">
        Laddar...
      </div>
    )
  }

  // Layout (Sidebar + Topbar) hanteras i layout.tsx,
  // här returnerar vi bara barnen.
  return <>{children}</>
}
