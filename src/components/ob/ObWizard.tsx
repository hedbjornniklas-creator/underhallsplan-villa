'use client'

import { useEffect } from 'react'
import ObStepGrunddata from './ObStepGrunddata'
import ObStepHandlingar from './ObStepHandlingar'
import ObStepForutsattningar from './ObStepForutsattningar'
import ObStepUtsida from './ObStepUtsida'
import ObStepInsida from './ObStepInsida'

export type TenureType = 'freehold' | 'bostadsratt' | null
export type DwellingType = 'house' | 'apartment' | null
export type InspectionSide = 'buyer' | 'seller' | null

type Property = {
  id: string
  name: string
  address: string | null
  postal_code: string | null
  city: string | null
  municipality: string | null
  cadastral_id: string | null
  owner_name: string | null

  tenure_type: TenureType
  dwelling_type: DwellingType
}

type Inspection = {
  id: string
  property_id: string
  date: string | null
  type: string | null
  status: string | null
  inspector_name: string | null
  created_at: string
  client_name: string | null
  client_contact: string | null
  assignment_number: string | null
  scope: string | null
  inspection_time: string | null
  attendees: string | null
  attendees_other?: string | null
  inspection_side: InspectionSide
}

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
                {inspection.assignment_number || inspection.id}
              </span>{' '}
              {inspection.date && <>· {inspection.date}</>}
            </p>
          </div>
        </div>
      )

    case 'grunddata':
      return (
        <ObStepGrunddata
          property={property}
          inspection={inspection}
          onPropertyUpdated={onPropertyUpdated}
          onInspectionUpdated={onInspectionUpdated}
        />
      )

    case 'handlingar':
      return <ObStepHandlingar property={property} inspection={inspection} />

    case 'forutsattningar':
      return <ObStepForutsattningar property={property} inspection={inspection} />

    case 'utsida':
      return <ObStepUtsida inspection={inspection} />

    case 'insida':
      return <ObStepInsida inspection={inspection} />

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
