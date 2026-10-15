import type { EbInspectionSummary, EbProjectListItem } from '../../src/lib/eb/server'

export const ebPreviewOrg = '11111111-1111-4111-8111-111111111111'

export function ebOverviewInspection(overrides: Partial<EbInspectionSummary> = {}): EbInspectionSummary {
  return {
    inspectionId: 'inspection-slab', projectId: 'project-alpha', variant: 'SLB', variantLabel: 'Slutbesiktning',
    sequenceNo: 1, parentInspectionId: null, status: 'draft', date: '2026-10-20', inspectionTime: '10:00',
    meetingPlace: null, startMeetingTime: null, finalMeetingTime: null, clientName: 'Anna Andersson',
    assignmentNumber: 'EB 2026-1020-01', invitationSentAt: null, inspectorAppointedBy: 'client',
    invitationMethod: null, invitationDate: null, approvalStatus: null, approvalNote: null,
    requiresContinuedFinalInspection: null, continuedFinalInspectionDate: null, continuedFinalInspectionTime: null,
    warrantyPeriodYears: null, warrantyEndDate: null, warrantyScope: null, defaultRemedyDeadline: null,
    afterInspectionRequested: null, afterInspectionRequestedBy: null, afterInspectionDueDate: null,
    afterInspectionNoticeInReport: false, inspectionCostDistribution: null, reportDistributionDate: null,
    previousInspections: [], defectNumberingExplanation: null, defectNoErrorPartsPolicy: null,
    invoiceRecipientMatchesClient: true, invoiceName: null, invoiceOrgNo: null, invoiceReference: null,
    invoiceEmailMatchesClient: true, invoiceEmail: null, invoiceAddressMatchesClient: true,
    invoiceAddress: null, invoicePostalCode: null, invoiceCity: null,
    reportLockedAt: null, reportLockedBy: null, reportPdfStatus: null, reportPdfError: null,
    reportPdfDownloadUrl: null, reportPdfCreatedAt: null, reportDeliveryStatus: 'not_sent',
    reportLastSentAt: null, createdAt: '2026-10-01T08:00:00Z', ...overrides,
  }
}

export function ebOverviewProject(overrides: Partial<EbProjectListItem> = {}): EbProjectListItem {
  return {
    id: 'project-alpha', orgId: ebPreviewOrg, ownerProfileId: 'preview-user', propertyId: 'property-alpha',
    projectTemplateKey: null, drainageSystem: null, drainageInspectionStage: null, drainageGuidanceVersion: null,
    title: 'Renovering Testvillan', contractName: 'Renovering Testvillan', objectDescription: 'Totalrenovering',
    propertyDesignation: 'Exemplet 1:1', brfApartmentNumber: null, address: 'Testgatan 1', postalCode: '111 11',
    city: 'Stockholm', municipality: 'Stockholm', standardAgreement: 'Konsumententreprenad', contractForm: null,
    procurementForm: null, contractDate: '2026-08-01', agreementNote: null, notePrefix: 'BES',
    clientName: 'Anna Andersson', clientOrgNo: null, clientEmail: 'anna@example.invalid', clientPhone: '0701234567',
    clientAddressMatchesObject: true, clientAddress: null, clientPostalCode: null, clientCity: null,
    clientIsPropertyOwner: true, propertyOwnerName: null,
    contractorName: 'Exempelbygg AB', contractorOrgNo: null, contractorEmail: 'bygg@example.invalid',
    contractorPhone: null, contractorAddress: null, contractorPostalCode: null, contractorCity: null,
    invoiceRecipientMatchesClient: true, invoiceName: null, invoiceOrgNo: null, invoiceReference: null,
    invoiceEmailMatchesClient: true, invoiceEmail: null, invoiceAddressMatchesClient: true,
    invoiceAddress: null, invoicePostalCode: null, invoiceCity: null, agreementItems: [],
    status: 'active', createdAt: '2026-10-01T08:00:00Z', updatedAt: '2026-10-15T08:00:00Z',
    inspections: [], ...overrides,
  }
}

export function ebOverviewDemo(): EbProjectListItem[] {
  const locked = {
    status: 'completed', reportLockedAt: '2026-10-13T08:00:00Z', reportLockedBy: 'preview-user',
    reportPdfStatus: 'ready' as const, reportPdfDownloadUrl: '/synthetic/report.pdf',
    reportPdfCreatedAt: '2026-10-13T08:01:00Z',
  }
  const sent = { reportDeliveryStatus: 'sent' as const, reportLastSentAt: '2026-10-13T08:05:00Z' }
  return [
    ebOverviewProject({ inspections: [
      ebOverviewInspection(),
      ebOverviewInspection({ inspectionId: 'inspection-after', variant: 'EB', variantLabel: 'Efterbesiktning',
        sequenceNo: 2, parentInspectionId: 'inspection-closed', date: '2026-10-21', assignmentNumber: 'EB 2026-1021-01' }),
      ebOverviewInspection({ ...locked, inspectionId: 'inspection-delivery', date: '2026-10-19', assignmentNumber: 'EB 2026-1019-01' }),
      ebOverviewInspection({ ...locked, ...sent, inspectionId: 'inspection-closed', date: '2026-10-10', assignmentNumber: 'EB 2026-1010-01' }),
    ] }),
    ...Array.from({ length: 12 }, (_, index) => {
      const projectId = `project-${index}`
      return ebOverviewProject({
        id: projectId, propertyId: `property-${index}`,
        title: index === 1 ? 'Åtgärder efter renovering av bostadsrättsföreningens gemensamma utrymmen' : `Entreprenad ${index + 2}`,
        address: index === 1 ? 'Södra Strandpromenaden vid Östra Långholmens allé 128 B, gårdshuset' : `Exempelvägen ${index + 2}`,
        propertyDesignation: `Exemplet 2:${index + 1}`,
        clientName: index === 1 ? 'Bostadsrättsföreningen med det långa organisationsnamnet' : ['Bengt Berg', 'Cecilia Carlsson', 'David Davidsson'][index % 3],
        inspections: [ebOverviewInspection({
          inspectionId: `inspection-${index}`, projectId, date: `2026-10-${String(18 - index).padStart(2, '0')}`,
          assignmentNumber: `EB 2026-${String(index + 1).padStart(4, '0')}-01`,
          ...(index >= 9 ? { ...locked, ...sent } : {}),
          ...(index === 10 ? { reportPdfStatus: 'failed', reportPdfError: 'Synthetic PDF failure' } : {}),
          clientName: index === 1 ? 'Bostadsrättsföreningen med det långa organisationsnamnet' : ['Bengt Berg', 'Cecilia Carlsson', 'David Davidsson'][index % 3],
        })],
      })
    }),
    ebOverviewProject({ id: 'project-without-inspections', title: 'Entreprenad utan besiktning', address: 'Tomtgatan 18' }),
    ebOverviewProject({ id: 'project-archived', title: 'Arkiverad entreprenad', status: 'archived' }),
    ebOverviewProject({ id: 'project-cancelled', title: 'Avbokad entreprenad', status: 'cancelled' }),
  ]
}
