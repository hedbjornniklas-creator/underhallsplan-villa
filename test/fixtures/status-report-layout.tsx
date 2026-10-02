import { createRoot } from 'react-dom/client'
import ReportRenderer from '@/components/report/ReportRenderer'
import { buildReportSpec } from '@/lib/report/reportSpec'
import { STB_REPORT_SOURCE, STB_REPORT_TERMS, STB_REPORT_TEXTS } from '@/content/standardtexts/status/originals'

const unknownFurnishing = new URLSearchParams(location.search).has('unknown-furnishing')
const apartment = new URLSearchParams(location.search).has('apartment')
const rental = new URLSearchParams(location.search).has('rental')
const data = { mock: {
  properties: { cadastral_id: 'TEST 1:1', address: 'Testgatan 1', owner_name: 'Testperson',
    object_type: apartment ? 'apartment' : 'property', brf_name: apartment && !rental ? 'BRF Testföreningen' : '',
    apartment_number: apartment ? '1203' : '', apartment_holder_name: apartment ? 'Testinnehavaren' : '' },
  inspections: { side: 'status', date: '2026-10-02', date_time: '2026-10-02 kl. 10:00',
    assignment_number: 'STB TEST-01', assignment_confirmation_date: '2026-10-01', client_name: 'Testperson',
    attendees_text: 'Testperson och testbesiktningsman', scope_text: 'Okulär statusbesiktning av badrummet på plan 1. Övriga delar av byggnaden ingår inte i uppdraget.' },
  profile: { full_name: 'Testbesiktningsman', company_name: 'Testbolag', phone: '010-0000000',
    email: 'test@example.se', company_address: 'Testgatan 1', company_postal_code: '12345',
    company_city: 'Teststad', company_orgno: '000000-0000' },
  inspection_conditions: { furnishing_level: unknownFurnishing ? null : 'delvis_moblerad' },
  buildingData: { text: `Byggnadstyp: ${apartment ? 'Lägenhet' : 'Villa'}\nByggnadsår: 2023\nBesiktningen omfattar endast det avtalade badrummet.` },
  documents: { provided: ['Kvalitetsdokument för våtrummet - tillhandahållet'] },
  disclosures: { acquisition_text: '', renovations: [], property_faults: [] },
  exterior: { blocks: [] },
  interior: { blocks: [
    { title: 'Plan 1 - Badrum', noteText: 'Fuktskyddet är begränsat till ytan under badkaret. Anslutning vid genomföring kunde inte verifieras.',
      riskText: 'OB RISK MUST NOT LEAK', ftuText: 'OB FTU MUST NOT LEAK',
      recommendationText: 'Låt en sakkunnig kontrollera utförandet och bedöma behovet av åtgärder.',
      commentText: 'Bedömningen avser synliga och åtkomliga delar vid besiktningstillfället.', photoUrls: [] },
    { title: 'Plan 1 - Badrum', noteText: '', riskText: '', ftuText: '',
      recommendationText: 'Begär installationsanvisning och dokumentation för golvbrunnen.', commentText: '', photoUrls: [] },
    { title: 'Plan 1 - Badrum', noteText: 'Inbyggnadsblandare saknar synlig läckageindikering. Dolda anslutningar kunde inte kontrolleras.',
      riskText: '', ftuText: '', recommendationText: '', commentText: '', photoUrls: ['/landing/besiktning-editorial-v2.png'] },
  ] },
  appendices: { buildings: [] },
  status_report: { source: { id: STB_REPORT_SOURCE.sourceId, version: STB_REPORT_SOURCE.sourceVersion,
      fileName: STB_REPORT_SOURCE.sourceFileName, fileSha256: STB_REPORT_SOURCE.sourceFileSha256 },
    ...STB_REPORT_TEXTS,
    assignmentNotice: STB_REPORT_TEXTS.assignmentNotice.replace('till uppdragsgivaren .', 'till uppdragsgivaren 2026-10-01.'),
    furnishing: unknownFurnishing ? '' : 'delvis möblerad', terms: STB_REPORT_TERMS },
} }
createRoot(document.getElementById('root')!).render(<ReportRenderer
  spec={buildReportSpec({ layoutVersion: 2, inspectionSide: 'status', objectType: apartment ? 'apartment' : 'property' })}
  mockData={data} inspectionSide="status" rootClassName="report-root--pdf"
/>)
