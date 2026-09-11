'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { readObFloorModel } from '@/lib/ob/floorModelStore'
import type { ObFloorModel } from '@/lib/ob/floorModel'

export const ObFloorContext = createContext<{
  model: ObFloorModel | null
  update: (model: ObFloorModel) => void
}>({ model: null, update: () => {} })
export const useObFloorModel = () => useContext(ObFloorContext)

export function ObFloorProvider({ inspectionId, children }: { inspectionId: string; children: ReactNode }) {
  const [state, setState] = useState<{ id: string; model: ObFloorModel | null } | null>(null)
  const [errorId, setErrorId] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let current = true
    readObFloorModel(supabase, inspectionId).then(model => {
      if (current) { setErrorId(null); setState({ id: inspectionId, model }) }
    }).catch(() => { if (current) setErrorId(inspectionId) })
    return () => { current = false }
  }, [inspectionId, retry])
  if (errorId === inspectionId) return <div role="alert" className="p-4 text-red-700">
    {'Besiktningens plan kunde inte h\u00e4mtas. '}
    <button type="button" className="underline" onClick={() => { setErrorId(null); setRetry(value => value + 1) }}>{'F\u00f6rs\u00f6k igen'}</button>
  </div>
  if (state?.id !== inspectionId) return <p role="status" className="p-4">{'H\u00e4mtar besiktning...'}</p>
  return <ObFloorContext.Provider value={{ model: state.model, update: model => setState({ id: inspectionId, model }) }}>
    {children}
  </ObFloorContext.Provider>
}
