import { createRoot } from 'react-dom/client'
import ReportRenderer from '@/components/report/ReportRenderer'
import { buildReportSpec } from '@/lib/report/reportSpec'

const query = new URLSearchParams(location.search)
const legacy = query.has('legacy')
const stress = query.has('stress')
const photo = '/landing/besiktning-editorial-v2.png'
const note = (title: string, id: string, photos = 1) => ({ title,
  noteText: `${id}. Syntetisk observation för kontroll av rapportlayouten.`,
  riskText: 'Risktexten hör till samma observation och ska följa med till nästa sida vid behov.',
  ftuText: 'Fortsatt teknisk utredning av den noterade delen föreslås.',
  photoUrls: Array.from({ length: photos }, () => photo),
})
const buildings = ['Garage', ...(stress ? ['Gästhus', 'Studio med ett längre byggnadsnamn'] : [])].map((name, i) => ({
  id: `extra-${i}`, name,
  introduction: [{ title: name, noteText: i ? 'Avgränsad omfattning för denna byggnad.' : '', photoUrls: [photo] }],
  conditions: { furnishing_level: 'fullt_moblerad' },
  buildingData: { text: `Väderlek: 12 grader och moln\nByggnadstyp: Komplementbyggnad med två plan\nByggnadsår: 2023\nGrundläggning: Platta på mark\nStomme: Trä\nFasad: Träpanel\nVentilation: Självdrag` },
  exterior: { blocks: [note('Yttertak', `${name}-TAK`), { title: 'Fasad', noteText: '--', photoUrls: [] }] },
  interior: { blocks: [note('Plan 0 - Teknikrum', `${name}-TEKNIK`), note('Plan 1 - Kök', `${name}-KÖK`),
    note('Plan 1 - Sovrum', `${name}-SOVRUM`, stress ? 5 : 1)] },
}))
const data = { mock: {
  properties: { cadastral_id: 'TEST 1:1', address: 'Testgatan 1', cover_path: photo, owner_name: 'Testperson' },
  inspections: { date: '2026-09-27', assignment_number: 'TEST-01', assignment_confirmation_date: '2026-09-27', scope_text: 'Huvudbyggnad och Garage' },
  profile: { full_name: 'Testbesiktningsman', company_name: 'Testbolag', company_website: query.has('website') ? 'https://foretag.example.se' + (query.has('long') ? '/' + 'kontakt/'.repeat(24) : '') : null,
    phone: '010-0000000', email: 'test@example.se', company_address: 'Testgatan 1', company_postal_code: '12345', company_city: 'Teststad', company_orgno: '000000-0000' },
  inspection_conditions: { furnishing_level: 'fullt_moblerad' },
  buildingData: { text: 'Byggnadstyp: Villa med två plan\nByggnadsår: 2023\nGrundläggning: Plintgrund\nStomme: Trä\nVentilation: FTX' },
  documents: { provided: ['Ritningar - tillhandahållna'] }, disclosures: { renovations: [], property_faults: [] },
  exterior: { blocks: [note('Mark', 'HUVUD-MARK'), note('Yttertak', 'HUVUD-TAK')] },
  interior: { blocks: [note('Plan 1 - Kök', 'HUVUD-KÖK'), note('Plan 1 - Teknikrum', 'HUVUD-TEKNIK'),
    note('Plan 2 - Badrum', 'HUVUD-BADRUM'), note('Plan 2 - Sovrum', 'HUVUD-SOVRUM', stress ? 6 : 1)] },
  appendices: { buildings },
} }
createRoot(document.getElementById('root')!).render(<ReportRenderer
  spec={buildReportSpec({ layoutVersion: legacy ? undefined : 2, inspectionSide: 'buyer', dynamicAppendices: { buildings } })}
  mockData={data} inspectionSide="buyer" rootClassName="report-root--pdf"
/> )
