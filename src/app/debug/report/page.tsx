import ReportRenderer from '@/components/report/ReportRenderer'
import {
  buildBuildingDataMap,
  buildBuildingTypeParts,
  renderBuildingDataTextFromTemplate,
} from '@/lib/report/buildingData'
import { buildReportSpec } from '@/lib/report/reportSpec'

export default function DebugReportPage() {
  const mockConditions = {
    weather: '12 grader och moln',
    weather_note: '',
    building_type: 'Friliggande villa',
    building_form: '',
    building_year: 1985,
    foundation: 'Platta på mark',
    frame: 'Trä',
    joists: 'Trä',
    facade: 'Träpanel',
    windows: '2-glas',
    roof: 'Tegel',
    heating: 'Fjärrvärme',
    ventilation: 'Självdrag',
    water: 'Kommunalt',
    sewer: 'Kommunalt',
  }

  const buildingDataMap = buildBuildingDataMap({
    selections: [],
    items: [],
    groups: [],
    options: [],
    conditions: mockConditions,
  })
  const buildingTypeParts = buildBuildingTypeParts({
    selections: [],
    items: [],
    groups: [],
    options: [],
    conditions: mockConditions,
  })
  const buildingDataText = renderBuildingDataTextFromTemplate(
    buildingDataMap,
    undefined,
    buildingTypeParts
  )

  const mockData = {
    mock: {
      company: {
        logo_url: '/report-assets/mock-company-logo.png',
      },
      profile: {
        full_name: 'Niklas Hedbjörn',
        sbr_group: 'Medlem i SBR Överlåtelsebesiktningsgrupp',
        sbr_status: 'Av SBR godkänd besiktningsman',
        membership_number: '22015326',
        phone: '0735678716',
        email: 'niklas.h@bbsab.nu',
        company_name: 'Besiktningsbolaget Stockholm',
        company_orgno: '559281-0823',
        company_address: 'Bryggvägen 7',
        company_postal_code: '117 71',
        company_city: 'Stockholm',
      },
      properties: {
        cadastral_id: 'Stockholm Hammarby 1:23',
        address: 'Exempelvägen 12, 117 71 Stockholm',
        city: 'Stockholm',
        municipality: 'Stockholm',
        owner_name: 'Namn efternamn',
      },
      documents: {
        provided: ['Köpekontrakt', 'Bygglovsritningar', 'Tidigare besiktningsprotokoll'],
      },
      disclosures: {
        acquisition_text: 'Säljaren förvärvade fastigheten 2018.',
        renovations: ['Takomläggning 2016', 'Fasad ommålad 2019'],
        property_faults: ['Inga kända fel har upplysts.'],
      },
      inspection_conditions: {
        furnishing_level: 'delvis möblerad',
      },
      buildingData: {
        text: buildingDataText,
      },
      inspections: {
        date: '2025-01-15',
        date_time: '2025-01-15 klockan 08:00',
        inspector_name: 'Anna Andersson',
        assignment_number: 'UP-2025-001',
        client_name: 'Uppdragsgivare Namn',
        inspection_side: 'seller',
        assignment_confirmation_date: '2025-01-10',
        scope_text:
          'En okulär besiktning av huvudbyggnaden\nBesiktning av komplementbyggnader\nFuktmätning eller fuktindikering av riskkonstruktion',
        attendees_text: 'Fastighetsägare\nBesiktningsman\nÖvrig närvarande',
        assignment_confirmation_text:
          'En uppdragsbekräftelse med bifogad villkorsbilaga överlämnades till uppdragsgivaren den 2025-01-10.',
      },
    },
  }

  let content = null
  let errorMessage = ''

  try {
    content = (
      <ReportRenderer
        spec={buildReportSpec({ inspectionSide: 'seller' })}
        mockData={mockData}
        inspectionSide="seller"
      />
    )
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : 'Okänt fel vid rendering.'
  }

  return (
    <main className="min-h-screen bg-gray-100 p-6 text-sm text-gray-800">
      <div className="mb-4 text-base font-semibold text-gray-900">
        Debugg: Rapportrenderare
      </div>
      <div className="mb-4 text-xs text-gray-500 print:hidden">
        Layoutförhandsvisning – använder mockdata. Produktionskoppling sker i
        `/utlatande/...`.
      </div>
      {errorMessage ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {errorMessage}
        </div>
      ) : (
        content
      )}
    </main>
  )
}

