'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { fetchSelectedOutcomes } from '@/lib/ob/selectedOutcomeLookup'

export function useSelectedOutcomes<T extends { id: string }>(
  items: ReadonlyArray<{ selected_outcome_id?: string | null }>,
): Record<string, T> {
  const key = Array.from(new Set(items.map(item => item.selected_outcome_id)
    .filter((id): id is string => Boolean(id)))).sort().join(',')
  const [loaded, setLoaded] = useState<{ key: string; outcomes: Record<string, T> } | null>(null)
  useEffect(() => {
    if (!key) return
    let current = true
    void fetchSelectedOutcomes<T>(supabase, key.split(',')).then(outcomes => {
      if (current) setLoaded({ key, outcomes })
    }).catch(error => {
      if (current) console.error('Could not load selected inspection outcomes:', error)
    })
    return () => { current = false }
  }, [key])
  return loaded?.key === key ? loaded.outcomes : {}
}
