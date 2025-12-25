'use client'

import { useEffect, useMemo } from 'react'
import ObStepGrunddata from './ObStepGrunddata'
import ObStepHandlingar from './ObStepHandlingar'
import ObStepForutsattningar from './ObStepForutsattningar'
import ObStepUtsida from './ObStepUtsida'
import ObStepInsida from './ObStepInsida'
import type { Tables } from '@/types/supabase'

type DbInspection = Tables<'inspections'>
type DbProperty = Tables<'properties'>

export type ObWizardInspectionInput = DbInspection & {
  defect_disclosures?: string | null
  attendees_other?: string | null
}

export type ObWizardInspection = DbInspection & {
  defect_disclosures: string | null
  attendees_other: string | null
}

export type ObWizardPropertyInput = Partial<DbProperty> & Pick<DbProperty, 'id' | 'name'>
export type ObWizardProperty = DbProperty

export type TenureType = Tables<'properties'>['tenure_type']
export type DwellingType = Tables<'properties'>['dwelling_type']
export type InspectionSide = Tables<'inspections'>['inspection_side']

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
  property: ObWizardPropertyInput
  inspection: ObWizardInspectionInput
  activeSection: ObSectionKey
  onPropertyUpdated?: (p: ObWizardProperty) => void
  onInspectionUpdated?: (i: ObWizardInspection) => void
}

export default function ObWizard({
  property,
  inspection,
  activeSection,
  onPropertyUpdated,
  onInspectionUpdated,
}: ObWizardProps) {
  const normalizedProperty = useMemo<ObWizardProperty>(
    () => ({
      id: property.id,
      name: property.name ?? '',
      address: property.address ?? null,
      area_m2: property.area_m2 ?? null,
      area_sqm: property.area_sqm ?? null,
      cadastral_id: property.cadastral_id ?? null,
      city: property.city ?? null,
      client_name: property.client_name ?? null,
      contact_person: property.contact_person ?? null,
      cover_path: property.cover_path ?? null,
      created_at: property.created_at ?? null,
      dwelling_type: property.dwelling_type ?? null,
      heating: property.heating ?? null,
      last_inspected: property.last_inspected ?? null,
      last_inspection_at: property.last_inspection_at ?? null,
      municipality: property.municipality ?? null,
      owner: property.owner ?? '',
      owner_name: property.owner_name ?? null,
      planning_status: property.planning_status ?? null,
      plot_area_m2: property.plot_area_m2 ?? null,
      postal_code: property.postal_code ?? null,
      property_type: property.property_type ?? null,
      roof_type: property.roof_type ?? null,
      status: property.status ?? null,
      tax_value: property.tax_value ?? null,
      tenure_type: property.tenure_type ?? null,
      type_code: property.type_code ?? null,
      ventilation: property.ventilation ?? null,
      year_built: property.year_built ?? null,
    }),
    [property]
  )

  // Säkerställ att attendees_other aldrig är undefined
  const normalizedInspection = useMemo<ObWizardInspection>(
    () => ({
      ...inspection,
      attendees_other: inspection.attendees_other ?? null,
      defect_disclosures: inspection.defect_disclosures ?? null,
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
                {normalizedProperty.name}
                {normalizedProperty.address ? ` – ${normalizedProperty.address}` : ''}
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
          property={normalizedProperty}
          inspection={normalizedInspection}
          onPropertyUpdated={onPropertyUpdated}
          onInspectionUpdated={onInspectionUpdated}
        />
      )

    case 'handlingar':
      return (
        <ObStepHandlingar
          property={normalizedProperty}
          inspection={normalizedInspection}
        />
      )

    case 'forutsattningar':
      return (
        <ObStepForutsattningar
          property={normalizedProperty}
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
