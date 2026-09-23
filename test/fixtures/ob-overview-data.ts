import { buildObOverview, type OverviewAssignment, type OverviewInspection } from '../../src/lib/ob/overview'

export function overviewAssignment(overrides: Partial<OverviewAssignment> = {}): OverviewAssignment {
  return {
    id: 'assignment-1', inspection_id: null, status: 'sent', customer_name: 'Anna Berg',
    customer_email: 'anna@example.invalid', property_address: 'Lindvägen 12', preliminary_address: null,
    property_city: 'Täby', preferred_date: '2026-09-25', accepted_at: null, booked_at: null,
    archived_at: null, created_at: '2026-09-20T12:00:00Z', approvalVerified: false, activeLink: true,
    linkIssue: false, ...overrides,
  }
}

export function overviewInspection(overrides: Partial<OverviewInspection> = {}): OverviewInspection {
  return {
    id: 'inspection-1', property_id: 'property-1', status: 'ongoing', date: '2026-09-25',
    created_at: '2026-09-20T12:00:00Z', assignment_number: '2026-0925-01', customer_name: 'Anna Berg',
    client_name: null, address: 'Lindvägen 12', city: 'Täby', snapshot_customer: null, ...overrides,
  }
}

export function overviewDemoItems() {
  const assignments = [
    overviewAssignment({ inspection_id: 'inspection-1' }),
    overviewAssignment({ id: 'assignment-2', customer_name: 'Johan Lind', property_address: 'Björkgatan 8',
      preferred_date: '2026-09-24', status: 'ordered', accepted_at: '2026-09-22T12:00:00Z', approvalVerified: true }),
    overviewAssignment({ id: 'assignment-3', inspection_id: 'inspection-3', property_address: 'Solhemsvägen 4',
      customer_name: 'Maria Ekström', status: 'completed', accepted_at: '2026-09-19T12:00:00Z',
      booked_at: '2026-09-20T12:00:00Z', approvalVerified: true }),
    overviewAssignment({ id: 'assignment-4', status: 'draft', customer_name: 'Erik Svensson',
      property_address: 'Ängsvägen 21', preferred_date: '2026-09-23' }),
    overviewAssignment({ id: 'assignment-5', status: 'expired', property_address: 'Tallstigen 6',
      preferred_date: '2026-09-22', customer_name: 'Sara Holm' }),
  ]
  const inspections = [
    overviewInspection(),
    overviewInspection({ id: 'inspection-3', property_id: 'property-3', status: 'completed', date: '2026-09-23',
      address: 'Solhemsvägen 4', customer_name: 'Maria Ekström', assignment_number: '2026-0923-02' }),
    ...Array.from({ length: 9 }, (_, index) => overviewInspection({ id: `legacy-${index}`, property_id: `legacy-property-${index}`,
      date: `2026-09-${String(21 - index).padStart(2, '0')}`, status: index === 8 ? 'archived' : 'completed',
      address: index === 0 ? 'Södra Strandpromenaden vid Östra Långholmens allé 128 B' : `Parkvägen ${index + 1}`,
      customer_name: index === 0 ? 'Alexandra Sjöström-Lindström och Christopher Andersson' : 'Testkund Andersson',
      assignment_number: `2026-0910-${index + 1}`,
    })),
  ]
  return buildObOverview(assignments, inspections, [{ inspection_id: 'inspection-1', initial_assignment_id: 'assignment-1',
    current_assignment_id: 'assignment-1', needsReview: true, paused: false, reason: 'Inväntar kundens godkännande.' }])
}
