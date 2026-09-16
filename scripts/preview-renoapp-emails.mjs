import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createServer } from 'node:http'
import ts from 'typescript'

const compiled = { exports: {} }
const source = readFileSync(new URL('../src/lib/renoapp/emailTemplate.ts', import.meta.url), 'utf8')
new Function('module', 'exports', ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText)(compiled, compiled.exports)
const { buildRenoAppEmailHtml: email, buildRenoAppEmailButton: button } = compiled.exports
const origin = 'https://hushub.se'
// Synthetic examples only: no real recipients, cases or invitation tokens.
const previews = {
  'inbjudan.html': email({ origin, preheader: 'Du har blivit inbjuden till RenoApp.', bodyHtml: `
    <h1>Välkommen till RenoApp</h1>
    <p>Hej Anna,</p>
    <p>Du har blivit inbjuden till styrelseportalen för <strong>BRF Exemplet</strong>.</p>
    <p>Här samlar ni föreningens renoveringsansökningar, underlag och beslut.</p>
    ${button('https://example.invalid/renoapp/invite/demo', 'Öppna RenoApp')}
    <p>Länken är personlig. Använd ditt befintliga HusHub-konto eller skapa din inloggning.</p>`,
  }),
  'komplettering.html': email({ origin, preheader: 'Styrelsen har begärt en komplettering.', bodyHtml: `
    <p>Hej Anna,</p><h1>Komplettera din ansökan</h1>
    <p>Ärendenummer: <strong>RA-2026-0916-01</strong></p>
    <p>Styrelsen behöver fler uppgifter för att kunna granska din ansökan.</p>
    <ul><li>Utlåtande från byggnadskonstruktör</li><li>Uppgifter om ansvarig entreprenör</li></ul>
    <p>Tidigare inskickade uppgifter finns kvar i ärendet.</p>
    ${button('https://example.invalid/renoapp/complete/demo', 'Öppna komplettering')}`,
  }),
  'lang-text.html': email({ origin, preheader: 'Test av långa uppgifter.', bodyHtml: `
    <h1>Förslag på renoveringstyp</h1>
    <p><strong>BRF:</strong> Bostadsrättsföreningen Exemplet med ett ovanligt långt föreningsnamn</p>
    <p><strong>Meddelande:</strong> Vi vill beskriva ett arbete som berör flera delar av lägenheten.</p>
    <p>${'LångUppgift'.repeat(35)}</p>
    ${button('https://example.invalid/renoapp/apply?demo=1&test=2', 'Öppna BRF-ansökningar')}`,
  }),
}
const directory = resolve('tmp/renoapp-email-preview')
mkdirSync(directory, { recursive: true })
for (const [name, html] of Object.entries(previews)) writeFileSync(resolve(directory, name), html)
console.log(`Preview files: ${directory}`)
if (process.argv.includes('--serve')) {
  const server = createServer((request, response) => {
    const name = new URL(request.url, 'http://localhost').pathname.slice(1) || 'inbjudan.html'
    const html = Object.hasOwn(previews, name) ? previews[name] : null
    response.writeHead(html ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(html || 'Not found')
  })
  server.listen(0, '127.0.0.1', () => console.log(`Preview: http://127.0.0.1:${server.address().port}/inbjudan.html`))
}
