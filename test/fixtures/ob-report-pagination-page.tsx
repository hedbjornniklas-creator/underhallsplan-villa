import ReportRendererClient from '@/components/report/ReportRendererClient'
import type { ReportSection } from '@/lib/report/reportSpec'

// Synthetic renderer-only stress fixture: no database, login, uploads or delivery.
const buildings = ['Huvudbyggnad', 'Garage', 'Guesthouse', 'Studio med ett mycket langt byggnadsnamn']
const photo = '/landing/besiktning-editorial-v2.png'
const groups = buildings.map((name, index) => ({ interior: { blocks: [
  {
    title: `${index === 0 ? 'Plan 1' : 'Plan -1'} - Hall i ${name}`,
    noteText: `NOTE-${index}-A. ` + 'Fiktiv observation som endast anvands for sidbrytningstest. '.repeat(8),
    riskText: 'Fiktiv risktext for att kontrollera rubriker over sidgranser. '.repeat(10),
    ftuText: 'Fiktiv utredningstext med samma byggnad och plats. '.repeat(4),
    photoUrls: Array.from({ length: 5 }, () => photo),
  },
  { title: `Plan 0 - Kok i ${name}`, noteText: `NOTE-${index}-B. Separat rum.`, photoUrls: [photo] },
] } }))
const spec: ReportSection[] = buildings.map((name, index) => ({
  id: index === 0 ? 'notes-interior' : `appendix-building-${index}`,
  title: index === 0 ? name : `Bilaga ${index + 3}: ${name}`,
  type: 'standard', startOnNewPage: true,
  blocks: [
    { type: 'heading', level: 2, text: name, marginTopMm: 0, marginBottomMm: 4 },
    { type: 'inspectionBlocks', itemsPath: `mock.stress.${index}.interior.blocks`, marginTopMm: 0, marginBottomMm: 4 },
  ],
}))

export default function ObReportPaginationFixture() {
  return <ReportRendererClient spec={spec} mockData={{ mock: {
    properties: { cadastral_id: 'SYNTETISKT SIDBRYTNINGSTEST' }, inspections: { date: '2026-09-13' }, stress: groups,
  } }} coverNotice="" inspectionSide="buyer" rootClassName="report-root--pdf" />
}
