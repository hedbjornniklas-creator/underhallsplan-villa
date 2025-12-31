'use client'

import Link from 'next/link'
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const isValidUuid = (value?: string | null) => !!value && UUID_RE.test(value)

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

  // SÃ¤kerstÃ¤ll att attendees_other aldrig Ã¤r undefined
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
      {
        const propertyId = normalizedProperty.id ?? null
        const inspectionId = normalizedInspection.id ?? null
        const hasValidIds = isValidUuid(propertyId) && isValidUuid(inspectionId)
        const reportHref = hasValidIds
          ? `/utlatande/${propertyId}/${inspectionId}`
          : ''
        const newTabHref = reportHref
        const autoPrintHref = hasValidIds ? `${reportHref}?autoprint=1` : ''
        const iframeSrc = hasValidIds ? `${reportHref}?embed=1` : ''
        return (
          <div className="rounded-xl border bg-white p-4 text-sm text-gray-700 space-y-3">
            <h2 className="text-base font-semibold text-gray-900">Översikt och förhandsgranskning</h2>
            <p>
              Här visas utlåtandet i förhandsgranskning. Använd knapparna för att öppna i ny flik eller skriva ut.
            </p>
            
            {hasValidIds ? (
              <>
                <div className="flex flex-wrap items-center gap-2 print:hidden">
                  <Link
                    href={newTabHref}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 shadow-sm hover:bg-gray-50"
                  >
                    Öppna i ny flik
                  </Link>
                  <Link
                    href={autoPrintHref}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center rounded-md bg-gray-900 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-black"
                  >
                    Skriv ut
                  </Link>
                </div>

                <div className="rounded-xl border bg-gray-100 p-3">
                  <div className="flex justify-center">
                    <div className="overflow-auto rounded-lg border border-gray-300 bg-white shadow">
                      <iframe
                        title="Utlåtande"
                        src={iframeSrc}
                        className="w-full"
                        style={{
                          width: '210mm',
                          maxWidth: '100%',
                          minHeight: '320mm',
                          border: '0',
                        }}
                      />
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-gray-600">
                    Om förhandsgranskningen inte visas kan du{' '}
                    <Link href={reportHref} target="_blank" rel="noreferrer" className="underline">
                      öppna utlåtandet här
                    </Link>
                    .
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                Utlåtande kan inte öppnas innan fastighet och besiktning är valda.
              </div>
            )}
          </div>
        )
      }

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
            HÃ¤r kommer systemet sammanstÃ¤lla FTU-punkter utifrÃ¥n risker.
          </p>
        </div>
      )

    default:
      return (
        <div className="rounded-xl border bg-white p-4 text-sm text-gray-600">
          <p>
            Steget{' '}
            <span className="font-mono">
              {activeSection ?? '(okÃ¤nt vÃ¤rde)'}
            </span>{' '}
            Ã¤r Ã¤nnu inte byggt.
          </p>
        </div>
      )
  }
}



