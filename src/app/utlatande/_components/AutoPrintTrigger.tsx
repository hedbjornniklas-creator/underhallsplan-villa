'use client'

import { useEffect } from 'react'

export default function AutoPrintTrigger() {
  useEffect(() => {
    const timer = setTimeout(() => {
      window.print()
    }, 50)

    return () => clearTimeout(timer)
  }, [])

  return null
}
