import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Smartphone, Monitor, RotateCcw, ALargeSmall, WifiOff } from 'lucide-react'

const require = createRequire(import.meta.url)
const { webpack } = require('next/dist/compiled/webpack/webpack')
const forms = process.argv.includes('--forms')
const output = resolve(forms ? 'tmp/ob-forms-preview' : 'tmp/ob-brand-preview')
await mkdir(output, { recursive: true })
await new Promise((ok, fail) => webpack({
  mode: 'development', devtool: false, entry: resolve(forms ? 'test/fixtures/ob-forms-preview.tsx' : 'test/fixtures/ob-brand-preview.tsx'),
  output: { path: output, filename: 'view.js' },
  resolve: { extensions: ['.tsx', '.ts', '.js'], alias: {
    '@/lib/supabaseClient': resolve(forms ? 'test/fixtures/ob-forms-client.ts' : 'test/fixtures/ob-brand-preview-client.ts'),
    './mobile-round.css': false, './ob-forms.css': false, '@': resolve('src'),
  } },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') }] },
}, (error, stats) => error || stats.hasErrors() ? fail(error ?? Error(stats.toString('errors-only'))) : ok()))
const globalCss = await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: resolve('src/app/globals.css') })
const css = [globalCss.css, ...await Promise.all([
  'src/components/ob/mobile-round.css', 'src/components/ob/ob-forms.css', 'test/fixtures/ob-brand-preview.css',
].map(path => readFile(path, 'utf8')))].join('\n').replace("@import './mobile-round.css';", '')
const assets = new Map()
for (const [url, path, type] of [
  ['/view.js', resolve(output, 'view.js'), 'text/javascript'],
  ['/photo.png', 'test/fixtures/ob-brand-assets/bathroom-demo.png', 'image/png'],
  ['/logo.png', 'public/report-assets/BesiktApp.png', 'image/png'],
  ['/manrope.ttf', 'public/ob/brand/manrope.ttf', 'font/ttf'],
  ['/ob/brand/manrope.ttf', 'public/ob/brand/manrope.ttf', 'font/ttf'],
  ['/report-assets/BesiktApp.png', 'public/report-assets/BesiktApp.png', 'image/png'],
]) assets.set(url, { body: await readFile(path), type })
const icon = component => renderToStaticMarkup(createElement(component, { size: 20, 'aria-hidden': true }))
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1')
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; frame-src 'self'; form-action 'none'; base-uri 'none'")
  response.setHeader('X-Content-Type-Options', 'nosniff')
  if (url.pathname === '/favicon.ico') { response.writeHead(204); response.end(); return }
  if (request.method !== 'GET') { response.writeHead(405); response.end('Read-only preview server'); return }
  if (assets.has(url.pathname)) {
    const asset = assets.get(url.pathname); response.setHeader('Content-Type', asset.type); response.end(asset.body); return
  }
  if (!['/', '/round'].includes(url.pathname)) { response.writeHead(404); response.end('Not found'); return }
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  if (url.pathname === '/round') {
    response.end(`<!doctype html><html lang="sv"${url.searchParams.has('large-text') ? ' data-large-text' : ''}><head><meta name="viewport" content="width=device-width, initial-scale=1, interactive-widget=resizes-content"><title>ÖB · layoutprov · testdata</title><style>${css}</style></head><body class="ob-brand"><div id="root"></div><script src="/view.js"></script></body></html>`)
    return
  }
  response.end(`<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>ÖB · profilprov 1.1</title><style>
    @font-face{font-family:Manrope;src:url('/manrope.ttf')}*{box-sizing:border-box}body{margin:0;background:#e9edef;color:#25313b;font:14px/1.5 Manrope,Arial,sans-serif;height:100dvh;display:flex;flex-direction:column}
    header{background:white;border-bottom:1px solid #d4dce4;padding:10px 20px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}header img{width:125px;height:auto}header strong{font-size:14px}header small{color:#596571}nav{display:flex;align-items:center;gap:6px;margin-left:auto}button{width:44px;height:44px;display:grid;place-items:center;border:1px solid #78838f;border-radius:6px;background:white;color:#245eb5;cursor:pointer}button[aria-pressed=true]{background:#edf3fc;border-color:#245eb5}button:focus-visible{outline:3px solid #245eb5;outline-offset:2px}select{min-height:44px;border:1px solid #78838f;border-radius:6px;background:white;color:#25313b;padding:8px;font:inherit}iframe{display:block;border:0;background:white;width:min(100%,390px);flex:1;min-height:0;margin:16px auto 0}body.desktop iframe{width:100%;margin-top:0} @media(max-width:600px){header{padding:8px;gap:8px}header img{width:100px}nav{margin-left:0;gap:4px}iframe{margin-top:0}}
    </style></head><body><header><img src="/logo.png" alt="BesiktApp"><div><strong>ÖB · profilprov 1.1</strong><br><small>Testdata · ej publicerat</small></div><nav aria-label="Förhandsvisning">
    <button id="mobile" aria-label="Mobilvy" title="Mobilvy" aria-pressed="true">${icon(Smartphone)}</button><button id="desktop" aria-label="Datorvy" title="Datorvy" aria-pressed="false">${icon(Monitor)}</button>
    <select id="width" aria-label="Skärmbredd"><option>320</option><option>360</option><option selected>390</option><option>430</option></select>
    <button id="text" aria-label="200 procent text" title="200 procent text" aria-pressed="false">${icon(ALargeSmall)}</button>
    <button id="failure" aria-label="Simulera sparfel" title="Simulera sparfel" aria-pressed="false">${icon(WifiOff)}</button>
    <button id="reset" aria-label="Återställ testdata" title="Återställ testdata">${icon(RotateCcw)}</button>
    </nav></header><iframe title="ÖB med testdata" src="/round?levels&swipe"></iframe><script>
    const frame=document.querySelector('iframe');
    function pressed(id){const button=document.getElementById(id);const next=button.getAttribute('aria-pressed')!=='true';button.setAttribute('aria-pressed',String(next));return next}
    document.getElementById('mobile').onclick=()=>{document.body.classList.remove('desktop');document.getElementById('mobile').setAttribute('aria-pressed','true');document.getElementById('desktop').setAttribute('aria-pressed','false');frame.style.width='min(100%,'+document.getElementById('width').value+'px)'};
    document.getElementById('desktop').onclick=()=>{document.body.classList.add('desktop');document.getElementById('mobile').setAttribute('aria-pressed','false');document.getElementById('desktop').setAttribute('aria-pressed','true');frame.style.width='100%'};
    document.getElementById('width').onchange=()=>document.getElementById('mobile').click();
    document.getElementById('text').onclick=()=>frame.contentDocument.documentElement.toggleAttribute('data-large-text',pressed('text'));
    document.getElementById('failure').onclick=()=>{frame.contentWindow.__obMobileTest.failSaves=pressed('failure')};
    document.getElementById('reset').onclick=()=>{for(const storage of [localStorage,sessionStorage])for(const key of Object.keys(storage))if(key.includes('ob-brand-preview:'))storage.removeItem(key);document.getElementById('failure').setAttribute('aria-pressed','false');document.getElementById('text').setAttribute('aria-pressed','false');frame.src='/round?levels&swipe'};
    frame.onload=()=>{frame.contentDocument.documentElement.toggleAttribute('data-large-text',document.getElementById('text').getAttribute('aria-pressed')==='true');if(frame.contentWindow.__obMobileTest)frame.contentWindow.__obMobileTest.failSaves=document.getElementById('failure').getAttribute('aria-pressed')==='true'};
    </script></body></html>`)
})
const portIndex = process.argv.indexOf('--port')
await new Promise((ok, fail) => { server.once('error', fail); server.listen(portIndex < 0 ? 0 : Number(process.argv[portIndex + 1]), '127.0.0.1', ok) })
const base = `http://127.0.0.1:${server.address().port}`
console.log(`OB brand preview (synthetic only): ${base}`)
if (process.argv.includes('--test') || process.argv.includes('--test-autosave') || process.argv.includes('--test-floors')) {
  try {
    if (process.argv.includes('--test-floors')) { const { testConditionFloors } = await import('../test/helpers/ob-condition-floors-browser.mjs'); await testConditionFloors(base, output) }
    else if (process.argv.includes('--test-autosave')) { const { testFormAutosave } = await import('../test/helpers/ob-form-autosave-browser.mjs'); await testFormAutosave(base, output) }
    else if (forms) { const { testFormsPreview } = await import('../test/helpers/ob-forms-preview-browser.mjs'); await testFormsPreview(base, output) }
    else { const { testBrandPreview } = await import('../test/helpers/ob-brand-preview-browser.mjs'); await testBrandPreview(base, output) }
  }
  finally { server.close() }
}
