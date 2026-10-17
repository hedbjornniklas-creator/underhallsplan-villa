import { createRoot } from 'react-dom/client'
import TuPrintPagedDocument, { type TuPrintPagedDocumentProps } from '../../src/components/tu/TuPrintPagedDocument'

function testImage(portrait: boolean, index: number) {
  const width = portrait ? 900 : 1200
  const height = portrait ? 1200 : 900
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="100%" height="100%" fill="#e8f0ec"/><rect x="12" y="12" width="${width - 24}" height="${height - 24}" fill="none" stroke="#216644" stroke-width="24"/>
    <path d="M0 0L${width} ${height}M${width} 0L0 ${height}" stroke="#819eaf" stroke-width="4"/>
    <text x="50%" y="45%" text-anchor="middle" font-family="Arial" font-size="60">BILD ${index + 1}</text>
    <text x="50%" y="54%" text-anchor="middle" font-family="Arial" font-size="40">${portrait ? 'Stående 3:4' : 'Liggande 4:3'}</text>
    <text x="50%" y="94%" text-anchor="middle" font-family="Arial" font-size="30">Hela den gröna ramen ska synas</text>
  </svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

const parameters = new URLSearchParams(location.search)
const count = Number(parameters.get('count') || 9)
const input: TuPrintPagedDocumentProps = {
  companyLogoUrl: null, companyLogoAlt: 'Testbolag', coverTitle: 'Layoutkontroll', coverImage: null,
  parties: null, metaRows: [], objectRows: [], signature: null, sections: [],
  header: { documentTitle: 'Layoutkontroll av bildbilaga', objectIdentifierLabel: 'Objekt', objectIdentifier: 'Testobjekt',
    projectType: 'Teknisk utredning', reportDate: '2026-10-17', address: 'Testgatan 1', assignmentNumber: 'TEST-01' },
  footer: { companyLines: ['Testbolag'], contactLines: ['test@example.test'] },
  appendixImages: Array.from({ length: count }, (_, index) => ({
    id: `image-${index}`, src: testImage(index % 2 === 1, index),
    caption: parameters.has('long')
      ? `Bild ${index + 1}. ` + 'Längre bildtext som ska följa med bilden och aldrig klippas bort. '.repeat(10)
      : `Bild ${index + 1}. Dokumentation av kontrollpunkten med hela bildytan synlig. Bildtexten behålls direkt under bilden även när den tar flera rader.`,
  })),
}
createRoot(document.getElementById('root')!).render(<TuPrintPagedDocument {...input} />)
