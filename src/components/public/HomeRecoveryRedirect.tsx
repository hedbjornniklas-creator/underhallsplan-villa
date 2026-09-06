'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function HomeRecoveryRedirect() {
  const router = useRouter()
  useEffect(() => {
    const search = new URLSearchParams(window.location.search)
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    if (search.get('type') === 'recovery' || hash.get('type') === 'recovery' || search.has('code') || hash.has('access_token')) {
      router.replace(`/auth/reset-password${window.location.search}${window.location.hash}`)
    }
  }, [router])
  return null
}
