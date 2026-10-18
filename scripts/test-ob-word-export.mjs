// Synthetic reports only. Use the bundled document runtime for generation and visual QA.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { loadWordModule } from '../test/helpers/load-word-report.ts'

if (!process.env.DOCUMENT_NODE_MODULES) throw Error('Set DOCUMENT_NODE_MODULES to the bundled workspace packages.')
const require = createRequire(resolve(process.env.DOCUMENT_NODE_MODULES, '../package.json'))
const sharp = require('sharp')
const { buildWordReport } = loadWordModule('src/lib/report/word/buildWordReport.ts')
const { snapshotWithBuildings } = loadWordModule('test/fixtures/report-snapshot-buildings-data.ts')
const { buildReportSpec } = loadWordModule('src/lib/report/reportSpec.ts')
const output = resolve('.cache/ob-word-export')
await mkdir(output, { recursive: true })
for (const side of ['buyer', 'status']) {
  const snapshot = snapshotWithBuildings()
  snapshot.inspectionSide = side
  snapshot.reportData.mock.profile = {
    full_name: 'Anna Andersson', sbr_group: 'Av SBR godkänd besiktningsman', sbr_status: '', certification_number: '12345',
    phone: '0701234567', email: 'anna@example.test', company_name: 'Exempelbesiktning AB',
    company_address: 'Testvägen 1', company_postal_code: '12345', company_city: 'Teststad', company_website: '',
  }
  snapshot.reportData.mock.company = { logo_url: '/report-assets/BesiktApp.png' }
  Object.assign(snapshot.reportData.mock.properties, { municipality: 'Teststad', owner_name: 'Testägare',
    brf_name: 'Brf Exempel', apartment_number: '1001', apartment_holder_name: 'Testinnehavare' })
  Object.assign(snapshot.reportData.mock.inspections, { side, assignment_number: '2026-0101-01', client_name: 'Testbeställare',
    date_time: '2026-09-25 10:00', attendees_text: 'Beställare och besiktningsman', assignment_confirmation_date: '2026-09-24' })
  snapshot.reportData.mock.documents = { provided: ['Energideklaration: Tillhandahållen\nUtfärdad 2024-01-01', 'Kvalitetsdokument för våtrum: Inte tillhandahållet'] }
  snapshot.reportData.mock.disclosures = { acquisition_text: 'Ägaren uppger att fastigheten förvärvades 2010.', renovations: ['Yttertak renoverades 2015.'], property_faults: 'Inga ytterligare fel har upplysts.' }
  snapshot.reportData.mock.buildingData.text = 'Möblering: Fullt möblerad\nVäderlek: 12 grader och moln\nByggnadstyp: Friliggande villa\nByggnadsår: 1985\nGrundläggning: Platta på mark'
  snapshot.reportData.mock.inspection_conditions = { furnishing_level: 'fullt_moblerad' }
  const note = snapshot.reportData.mock.interior.blocks[0]
  note.noteText = 'Vid besiktningen noterades fuktindikation vid anslutningen mellan golv och vägg. Observationen avser den synliga och åtkomliga delen av konstruktionen.\n\n' +
    'Det går inte att fastställa skadans fullständiga omfattning utan vidare undersökning. '.repeat(24)
  Object.assign(note, { riskText: 'Det finns risk för fuktskador i bakomliggande konstruktion.', ftuText: 'Fortsatt teknisk utredning rekommenderas för att fastställa orsak och omfattning.',
    recommendationText: 'Orsak och omfattning bör undersökas av sakkunnig.', commentText: 'Bedömningen grundas på synliga och åtkomliga delar.',
    photoUrls: ['/fixture-landscape.png', '/fixture-portrait.png', '/fixture-square.png'] })
  if (side === 'status') snapshot.reportData.mock.status_report = { terms: 'Frysta villkor för statusbesiktning.\n\nDenna text kommer från den sparade rapportversionen.',
    assignmentNotice: 'Fryst uppdragstext för statusbesiktning.', visualConditions: 'Endast synliga och åtkomliga delar har undersökts.', oralInformation: 'Muntliga uppgifter är lämnade av beställaren.' }
  const appendices = snapshot.reportData.mock.appendices
  appendices.environmental = [{ kind: 'radon', title: 'Radonmätning', rows: [{ location: 'Kontor', result: 'Fryst resultat för kontroll av bilagor.' }],
    source: 'Protokoll', details: 'Mätning under avtalad period.', conclusion: 'Fryst slutsats.', notice: 'Fryst avgränsning.', fileSummary: 'Originalbilaga: laboratorieprotokoll.pdf' }]
  appendices.area_measurement = { enabled: true, object: { assignment_number: '2026-0101-01', address: 'Testgatan 1', building_type: 'Villa', building_year: '1985' },
    measurement: { instrument: 'Lasermätare', comment: 'Avtalad mätning', other_notes: '--' }, summary: { boarea_total: '120 m²', biarea_total: '40 m²' },
    rows: [{ floor_or_part: 'Plan 0', boarea_display: '60 m²', biarea_display: '40 m²' }, { floor_or_part: 'Plan 1', boarea_display: '60 m²', biarea_display: '0 m²' }],
    signing: { place_date: 'Teststad, 2026-09-25', company_name: 'Exempelbesiktning AB', inspector_name: 'Anna Andersson' } }
  snapshot.reportSpec = buildReportSpec({ layoutVersion: 2, inspectionSide: side, dynamicAppendices: {
    buildings: appendices.buildings, environmental: appendices.environmental, includeAreaMeasurement: true,
  } })
  const cache = new Map()
  const loadImage = async url => {
    if (!cache.has(url)) {
      const file = url.startsWith('/fixture-') ? 'test/fixtures/ob-brand-assets/bathroom-demo.png' : url.startsWith('/report-assets/') ? `public${url}` : 'public/landing/besiktning-editorial-v2.png'
      let source = sharp(await readFile(file)).rotate()
      if (url.startsWith('/fixture-')) {
        const dimensions = url.includes('portrait') ? [450, 650] : url.includes('square') ? [500, 500] : [650, 400]
        source = source.resize(...dimensions, { fit: 'cover' })
      }
      cache.set(url, source.png().toBuffer({ resolveWithObject: true }).then(result => ({ data: result.data, width: result.info.width, height: result.info.height })))
    }
    return cache.get(url)
  }
  const bytes = await buildWordReport(snapshot, { loadImage })
  const file = resolve(output, `${side === 'status' ? 'status' : 'ob'}-sample.docx`)
  await writeFile(file, bytes)
  console.log(`${file} (${bytes.length} bytes)`)
}
