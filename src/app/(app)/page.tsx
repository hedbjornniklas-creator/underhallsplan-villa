'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function AppHomeRedirect() {
  const router = useRouter()
  useEffect(() => { router.replace('/dashboard-v1') }, [router])
  return null
}
