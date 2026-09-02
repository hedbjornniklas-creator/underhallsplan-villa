'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function RenoAppLoginRedirect() {
  const router = useRouter()

  useEffect(() => {
    const returnPath = `${window.location.pathname}${window.location.search}${window.location.hash}`
    const safeReturnPath =
      returnPath === '/renoapp/app' || returnPath.startsWith('/renoapp/app/') ? returnPath : '/renoapp/app'

    router.replace(`/renoapp/login?next=${encodeURIComponent(safeReturnPath)}`)
  }, [router])

  return (
    <main className="flex min-h-[60vh] items-center justify-center px-6 text-sm text-stone-600">
      Öppnar inloggningen...
    </main>
  )
}
