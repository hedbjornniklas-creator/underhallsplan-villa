'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { authLoginUrl } from '@/lib/auth/returnPath'

export default function RenoAppLoginRedirect() {
  const router = useRouter()

  useEffect(() => {
    const returnPath = `${window.location.pathname}${window.location.search}${window.location.hash}`
    router.replace(authLoginUrl(returnPath))
  }, [router])

  return (
    <main className="flex min-h-[60vh] items-center justify-center px-6 text-sm text-stone-600">
      Öppnar inloggningen...
    </main>
  )
}
