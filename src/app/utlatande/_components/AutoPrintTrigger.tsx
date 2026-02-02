'use client'

import { useEffect } from 'react'

export default function AutoPrintTrigger() {
  useEffect(() => {
    const start = Date.now()
    const maxWaitMs = 15000
    const interval = setInterval(() => {
      const images = Array.from(document.querySelectorAll('img[data-report-track="1"]'))
      const allReady =
        images.length === 0 ||
        images.every(
          (img) =>
            img.getAttribute('data-report-ready') === '1' &&
            (img as HTMLImageElement).complete
        )

      if (allReady || Date.now() - start > maxWaitMs) {
        clearInterval(interval)
        window.print()
      }
    }, 200)

    return () => clearInterval(interval)
  }, [])

  return null
}
