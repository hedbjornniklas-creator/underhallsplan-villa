'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { Auth } from '@supabase/auth-ui-react'
import { ThemeSupa } from '@supabase/auth-ui-shared'

export default function LoginPage() {
  const router = useRouter()

  useEffect(() => {
    // Redan inloggad? Gå direkt till /properties
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace('/properties')
    })
    // När inloggning sker nu: gå till /properties
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) router.replace('/properties')
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
