'use client'

import { createContext, useContext, useMemo } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { createBuildingDataClient } from '@/lib/ob/buildingDataClient'
import { requestBuildingCommand, type ObBuildingContextValue } from '@/lib/ob/buildingStructure'

export const ObBuildingContext = createContext<ObBuildingContextValue | null>(null)
export const useObBuilding = () => useContext(ObBuildingContext)
export function useObBuildingData() {
  const context = useObBuilding()
  const inspectionId = context?.inspectionId
  const partId = context?.part?.id
  const active = Boolean(context?.overview.structure)
  return useMemo(() => {
    if (active && (!partId || !inspectionId)) throw Error('Byggnaden kunde inte verifieras. Uppdatera sidan.')
    return partId && inspectionId ? createBuildingDataClient(supabase, inspectionId, partId,
      (operation, payload) => requestBuildingCommand(inspectionId, operation, payload)) : { client: supabase, remember: (_value: unknown) => {} }
  }, [inspectionId, partId, active])
}
