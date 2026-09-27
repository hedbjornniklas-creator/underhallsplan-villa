import type { ReportSnapshotPayloadV1 } from '../../src/lib/report/reportSnapshotPayload'

const photo = '/landing/besiktning-editorial-v2.png'
const note = (title: string, text: string) => ({
  title, noteText: text, riskText: '', ftuText: '', photoUrls: [photo],
})

export function snapshotWithBuildings(): ReportSnapshotPayloadV1 {
  return {
    schemaVersion: 'v1', createdAt: '2026-09-27T09:28:54.000Z',
    inspectionId: 'synthetic-inspection', propertyId: 'synthetic-property', inspectionSide: 'buyer',
    reportSpec: [],
    reportData: { mock: {
      properties: { address: 'Testgatan 1', cadastral_id: 'TEST 1:1', cover_path: photo },
      inspections: { date: '2026-09-25', scope_text: 'Huvudbyggnad och komplementbyggnader' },
      buildingData: { text: 'Huvudbyggnadens frysta byggnadsdata' },
      exterior: { blocks: [note('Yttertak', 'Huvudbyggnadens sparade taknotering')] },
      interior: { blocks: [note('Plan 1 - Kök', 'Huvudbyggnadens sparade köksnotering')] },
      appendices: { buildings: [
        {
          id: 'garage', name: 'Garage',
          introduction: [{ title: 'Garage', noteText: '', photoUrls: [photo] }],
          conditions: { furnishing_level: 'fullt möblerad' },
          buildingData: { text: 'Byggnadsår: 2023\nGrundläggning: Platta på mark\nPlan 0 - Garage\nPlan 1 - Kontor' },
          exterior: { blocks: [{ ...note('Yttertak', 'Garagets sparade taknotering'), riskText: 'Garagets frysta risktext' }] },
          interior: { blocks: [{ ...note('Plan 1 - Kök', 'Garagets sparade köksnotering'), ftuText: 'Garagets frysta FTU-text' }] },
        },
        {
          id: 'guest-house', name: 'Gästhus med en längre byggnadsrubrik för kontroll av mobilvyn',
          introduction: [{ title: 'Gästhus', noteText: 'Endast den avtalade byggnadsdelen.', photoUrls: [] }],
          conditions: { furnishing_level: 'omöblerad' },
          buildingData: { text: 'Byggnadsår: 1998' },
          exterior: { blocks: [] }, interior: { blocks: [note('Plan 1 - Kök', 'Gästhusets sparade köksnotering')] },
        },
      ] },
    } } as ReportSnapshotPayloadV1['reportData'],
  }
}
