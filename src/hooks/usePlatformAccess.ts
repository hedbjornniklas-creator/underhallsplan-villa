'use client'

import { useEffect, useMemo, useState } from 'react'

type ProductAccessItem = {
  key: string
  label: string
  href: string
}

type AccessPayload = {
  products?: ProductAccessItem[]
  hasDashboardAdmin?: boolean
}

export function usePlatformAccess() {
  const [products, setProducts] = useState<ProductAccessItem[]>([])
  const [hasDashboardAdmin, setHasDashboardAdmin] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    const load = async () => {
      try {
        const response = await fetch('/api/access/current', { cache: 'no-store' })
        const payload = (await response.json().catch(() => ({}))) as AccessPayload

        if (!response.ok) {
          throw new Error('ACCESS_LOAD_FAILED')
        }

        if (active) {
          setProducts(payload.products ?? [])
          setHasDashboardAdmin(Boolean(payload.hasDashboardAdmin))
        }
      } catch {
        if (active) {
          setProducts([])
          setHasDashboardAdmin(false)
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      active = false
    }
  }, [])

  const productKeys = useMemo(() => products.map((product) => product.key), [products])

  return {
    loading,
    products,
    productKeys,
    hasDashboardAdmin,
    hasHushubAdmin: productKeys.includes('hushub_admin'),
    hasDashboard: productKeys.includes('dashboard'),
    hasRenoApp: productKeys.includes('renoapp'),
  }
}
