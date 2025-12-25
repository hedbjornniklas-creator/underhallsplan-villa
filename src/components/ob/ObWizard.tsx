'use client'

import { useEffect, useMemo } from 'react'
import ObStepGrunddata from './ObStepGrunddata'
import ObStepHandlingar from './ObStepHandlingar'
import ObStepForutsattningar from './ObStepForutsattningar'
import ObStepUtsida from './ObStepUtsida'
import ObStepInsida from './ObStepInsida'
import type { Tables } from '@/types/supabase'

export type TenureType = Tables<'properties'>['tenure_type']
export type DwellingType = Tables<'properties'>['dwelling_type']
export type InspectionSide = Tables<'inspections'>['inspection_side']

type Property = Tables<'properties'>
type Inspection = Tables<'inspections'>

export type ObSectionKey =
  | 'overview'
  | 'grunddata'
  | 'handlingar'
  | 'forutsattningar'
  | 'utsida'
  | 'insida'
  | 'risk'
  | 'ftu'

interface ObWizardProps {
  property: Property
  inspection: Inspection
  activeSection: ObSectionKey
  onPropertyUpdated?: (p: Property) => void
  onInspectionUpdated?: (i: Inspection) => void
}

export default function ObWizard({
  property,
  inspection,
  activeSection,
  onPropertyUpdated,
  onInspectionUpdated,
}: ObWizardProps) {
  // Säkerställ att attendees_other aldrig är undefined
  const normalizedInspection = useMemo<Inspection>(
    () => ({
      ...inspection,
      attendees_other: inspection.attendees_other ?? null,
    }),
    [inspection]
  )

  useEffect(() => {
    console.log('ObWizard activeSection =', activeSection)
  }, [activeSection])

  switch (activeSection) {
    case 'overview':
      return (
        <div className="rounded-xl border bg-white p-4 text-sm text-gray-700 space-y-2">
          <h2 className="text-base font-semibold text-gray-900">
            Översikt över besiktningen
          </h2>
          <p>
            Här kommer vi senare samla en översikt med status för samtliga steg:
            grunddata, handlingar, förutsättningar, utsida/insida, riskanalys och FTU.
          </p>
          <div className="text-xs text-gray-500 space-y-1">
            <p>
              Fastighet:{' '}
              <span className="font-medium">
                {property.name}
                {property.address ? ` – ${property.address}` : ''}
              </span>
            </p>
            <p>
              Besiktning:{' '}
              <span className="font-medium">
                {normalizedInspection.assignment_number || normalizedInspection.id}
              </span>{' '}
              {normalizedInspection.date && <>· {normalizedInspection.date}</>}
            </p>
          </div>
        </div>
      )

    case 'grunddata':
      return (
        <ObStepGrunddata
          property={property}
          inspection={normalizedInspection}
          onPropertyUpdated={onPropertyUpdated}
          onInspectionUpdated={onInspectionUpdated}
        />
      )

    case 'handlingar':
      return (
        <ObStepHandlingar
          property={property}
          inspection={normalizedInspection}
        />
      )

    case 'forutsattningar':
      return (
        <ObStepForutsattningar
          property={property}
          inspection={normalizedInspection}
        />
      )

    case 'utsida':
      return <ObStepUtsida inspection={normalizedInspection} />

    case 'insida':
      return <ObStepInsida inspection={normalizedInspection} />

    case 'risk':
      return (
        <div className="rounded-xl border bg-white p-4 text-sm text-gray-700 space-y-1">
          <h2 className="text-base font-semibold text-gray-900">Riskanalys</h2>
          <p>
            Riskanalys-steget kommer att kopplas till risk-/FTU-databasen.
          </p>
        </div>
      )

    case 'ftu':
      return (
        <div className="rounded-xl border bg-white p-4 text-sm text-gray-700 space-y-1">
          <h2 className="text-base font-semibold text-gray-900">
            Fortsatt teknisk utredning (FTU)
          </h2>
          <p>
            Här kommer systemet sammanställa FTU-punkter utifrån risker.
          </p>
        </div>
      )

    default:
      return (
        <div className="rounded-xl border bg-white p-4 text-sm text-gray-600">
          <p>
            Steget{' '}
            <span className="font-mono">
              {activeSection ?? '(okänt värde)'}
            </span>{' '}
            är ännu inte byggt.
          </p>
        </div>
      )
  }
}
