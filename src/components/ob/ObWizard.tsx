'use client'

import ObStepGrunddata from './ObStepGrunddata'

type Property = {
  id: string
  name: string
  address: string | null
  postal_code: string | null
  city: string | null
  municipality: string | null
  cadastral_id: string | null
  owner_name: string | null
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
}

export type ObSectionKey =
  | 'overview'
  | 'grunddata'
  | 'handlingar'
  | 'utsida'
  | 'insida'
  | 'vindsutrymme'
  | 'vatrum'
  | 'risk'
  | 'ftu'
  | 'summary'

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
  // 🔹 Här styr vi vilken "sida" som syns

  if (activeSection === 'grunddata') {
    return (
      <ObStepGrunddata
        property={property}
        inspection={inspection}
        onPropertyUpdated={onPropertyUpdated}
        onInspectionUpdated={onInspectionUpdated}
      />
    )
  }

  // 🔹 Övriga steg är placeholders tills vi bygger dem
  return (
    <div className="rounded-xl border bg-white p-4 text-sm text-gray-600">
      <p>
        Steget <span className="font-mono">{activeSection}</span> är ännu inte byggt.
      </p>
      <p className="mt-1 text-xs text-gray-500">
        Här kommer vi senare lägga moduler för Handlingar, utsida, insida, våtrum, riskanalys,
        FTU och sammanfattning.
      </p>
    </div>
  )
}
