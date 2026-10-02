import type { TuAssignmentListItem, TuInspectionSummary } from '../../src/lib/tu/server'

export const tuPreviewOrg = '11111111-1111-4111-8111-111111111111'

export function tuAssignment(overrides: Partial<TuAssignmentListItem> = {}): TuAssignmentListItem {
  return {
    id: 'assignment-1', org_id: tuPreviewOrg, assignment_type: 'TU', organization_customer_id: null,
    status: 'ordered', customer_name: 'Anna Andersson', customer_email: 'anna@example.invalid',
    customer_phone: null, customer_postal_code: null, customer_city: null,
    preferred_date: '2026-10-02', preferred_time: '10:00', preliminary_address: null,
    scope_description: 'Kontroll av vinden', property_address: 'Testgatan 1', property_postal_code: '111 11',
    property_city: 'Stockholm', cadastral_id: 'Exemplet 1:1', brf_name: null, apartment_number: null,
    apartment_holder_name: null, accepted_at: null, booked_at: null, converted_at: null,
    inspection_id: null, responsible_profile_id: 'preview-user', created_at: '2026-10-01T08:00:00Z',
    updated_at: '2026-10-01T08:00:00Z', last_sent_at: null, archived_at: null, archived_by: null,
    ...overrides,
  }
}

export function tuInvestigation(overrides: Partial<TuInspectionSummary> = {}): TuInspectionSummary {
  return {
    inspectionId: 'inspection-1', propertyId: null, assignmentId: null, assignmentNumber: '2026-1002-01',
    title: 'Fuktskadeutredning', projectType: 'Fuktskadeutredning', objectType: 'villa', status: 'draft',
    date: '2026-10-02', inspectionTime: '10:00', customerName: 'Anna Andersson', customerEmail: 'anna@example.invalid',
    propertyAddress: 'Testgatan 1', propertyCity: 'Stockholm', cadastralId: 'Exemplet 1:1',
    brfName: null, apartmentNumber: null, apartmentHolderName: null, scopeDescription: 'Kontroll av vinden',
    reportLockedAt: null, createdAt: '2026-10-01T08:00:00Z', updatedAt: '2026-10-01T08:00:00Z', ...overrides,
  }
}

export function tuOverviewDemo() {
  const assignments = [
    tuAssignment({ status: 'completed', inspection_id: 'inspection-1', accepted_at: '2026-10-01T08:00:00Z' }),
    tuAssignment({ id: 'assignment-2', property_address: 'Långgatan 18', customer_name: 'Bengt Berg', preferred_date: '2026-10-05' }),
    tuAssignment({ id: 'assignment-3', status: 'sent', property_address: 'Parkvägen 12', customer_name: 'BRF Parken', preferred_date: '2026-10-04' }),
    tuAssignment({ id: 'assignment-4', status: 'draft', property_address: null, preferred_date: null }),
    tuAssignment({ id: 'assignment-5', status: 'cancelled', property_address: 'Ängsvägen 8', preferred_date: '2026-09-27', archived_at: '2026-10-01T08:00:00Z' }),
  ]
  const investigations = Array.from({ length: 12 }, (_, index) => ({
    ...tuInvestigation({
      inspectionId: `inspection-${index + 1}`, assignmentId: index === 0 ? 'assignment-1' : null,
      propertyAddress: index === 1 ? 'Södra Strandpromenaden vid Östra Långholmens allé 128 B, gårdshuset' : `Testgatan ${index + 1}`,
      customerName: index === 1 ? 'Bostadsrättsföreningen med det långa organisationsnamnet' : ['Anna Andersson', 'Bengt Berg', 'Cecilia Carlsson'][index % 3],
      title: index % 2 ? 'Teknisk uppföljningskontroll efter skadeåtgärd' : 'Fuktskadeutredning',
      propertyCity: index % 2 ? 'Stockholm' : 'Täby', date: `2026-09-${String(30 - index).padStart(2, '0')}`,
      status: index % 3 === 0 ? 'draft' : 'in_progress', reportLockedAt: index > 7 ? '2026-10-01T08:00:00Z' : null,
    }),
    hasReadyPdf: index > 7,
  }))
  return { assignments, investigations }
}
