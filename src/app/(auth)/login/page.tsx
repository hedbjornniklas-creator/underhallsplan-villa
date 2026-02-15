'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { Auth } from '@supabase/auth-ui-react'
import { ThemeSupa } from '@supabase/auth-ui-shared'

export default function LoginPage() {
  const router = useRouter()

  useEffect(() => {
    // Redan inloggad? Gå direkt till /properties
    supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
      if (data.session) router.replace('/dashboard-v1')
    })
    // När inloggning sker nu: gå till /properties
    const { data } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      if (session) router.replace('/dashboard-v1')
    })
    return () => data.subscription.unsubscribe()
  }, [router])

  return (
    <div style={{ maxWidth: 420, margin: '60px auto' }}>
      <h1 style={{ marginBottom: 16 }}>Logga in</h1>
      <Auth supabaseClient={supabase} appearance={{ theme: ThemeSupa }} providers={[]} />
    </div>
  )
}
