'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

type Profile = {
  id: string
  full_name: string | null
  org_name: string | null
  logo_url: string | null
  is_admin: boolean | null
}

export function useProfile() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      const { data: u } = await supabase.auth.getUser()
      const user = u?.user
      if (!user) { setLoading(false); return }
      const { data, error } = await supabase
        .from('profiles')
        .select('id,full_name,org_name,logo_url,is_admin')
        .eq('id', user.id)
        .maybeSingle()
      if (!error && mounted) setProfile(data as Profile)
      setLoading(false)
    })()
    return () => { mounted = false }
  }, [])

  return {
    profile,
    loading,
    isAdmin: !!profile?.is_admin
  }
}
