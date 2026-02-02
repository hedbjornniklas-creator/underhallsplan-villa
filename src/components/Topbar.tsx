'use client'
import Image from 'next/image'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useProfile } from '@/hooks/useProfile'
import { LogOut } from 'lucide-react'
import { useRouter } from 'next/navigation'

export default function Topbar() {
  const { profile } = useProfile()
  const [email, setEmail] = useState<string | null>(null)
  const router = useRouter()

  useEffect(() => {
    supabase.auth.getUser().then((res: any) => setEmail(res?.data?.user?.email ?? null))
  }, [])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.replace('/login')
  }

  return (
    <header className="h-14 border-b bg-white/90 backdrop-blur px-3 md:px-6 flex items-center justify-between">
      <div className="flex items-center gap-3">
        {profile?.logo_url ? (
          <Image src={profile.logo_url} alt="Logo" width={28} height={28} className="rounded" />
        ) : (
          <div className="text-sm font-semibold">Underhållsplan Villa</div>
        )}
      </div>

      <div className="flex items-center gap-3 text-sm text-gray-600">
        <span>{profile?.org_name ? profile.org_name : email ?? '—'}</span>
        <button
          onClick={handleLogout}
          className="flex items-center gap-1 text-gray-500 hover:text-rose-600 transition text-xs sm:text-sm"
          title="Logga ut"
        >
          <LogOut size={16} />
          Logga ut
        </button>
      </div>
    </header>
  )
}
