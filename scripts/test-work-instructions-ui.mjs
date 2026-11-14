// Production components with a loopback-only transport. No live database/storage/email.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { instructionSaveRequest, instructionFileKey } from '../src/lib/action-cases/workInstructions.ts'

const require = createRequire(import.meta.url), { webpack } = require('next/dist/compiled/webpack/webpack')
const output = resolve('tmp/work-instructions-ui')
await mkdir(output, { recursive: true })
await new Promise((done, fail) => webpack({ mode: 'development', devtool: false,
  plugins: [new webpack.DefinePlugin({ 'process.env': JSON.stringify({ NODE_ENV: 'development' }) }), new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 })],
  entry: resolve('test/fixtures/work-instructions-view.tsx'), output: { path: output, filename: 'view.js' },
  resolve: { extensions: ['.tsx','.ts','.js'], alias: { '@/lib/supabaseClient$': resolve('test/helpers/instruction-supabase-stub.ts'), '@': resolve('src') } },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') }, { test: /\.css$/, type: 'asset/source' }] },
}, (error, stats) => error || stats.hasErrors() ? fail(error || Error(stats.toString('errors-only'))) : done()))
const source = (await readFile('src/app/globals.css','utf8')).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source "../components/tasks";\n@source "../../test/fixtures/work-instructions-view.tsx";')
let css = (await postcss([tailwind()]).process(source, { from: resolve('src/app/globals.css') })).css
for (const name of ['uppdrag-theme.css','action-case-costs.css','work-instructions.css']) css += '\n' + await readFile(`src/components/tasks/${name}`, 'utf8')
css += '\n[data-testid=protected-state],[data-testid=instruction-dirty]{display:none}'
const js = await readFile(resolve(output,'view.js')), png = await readFile('public/landing/renovering-editorial-v2.png')
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`, caseId = id(1), itemId = id(2), endpoint = `/api/action-cases/${caseId}/items/${itemId}/instructions`
const file = (n,name,type='application/pdf') => ({ id:id(n),source:'project',sourceId:id(n),type:type.startsWith('image/')?'image':'document',title:null,fileName:name,contentType:type,fileSizeBytes:100,actionCaseItemId:null,createdAt:new Date().toISOString(),grantedParticipantIds:[],url:`/api/action-cases/${caseId}/attachments/${id(n)}` })
const projectFiles = [file(10,'Monteringsanvisning-golv.pdf'),file(11,'Läggningsritning.pdf'),file(12,'Golvyta.png','image/png')]
const diaryPhoto = { id:id(20),entryId:id(21),name:'Detaljbild.png',contentType:'image/png',size:png.length,sha256:'a'.repeat(64),workDate:'2026-11-14',personName:'Testperson',company:'Testföretag',itemTitle:'Golv',itemId,receivedAt:new Date().toISOString() }
const diaryFile = { ...file(20,'Detaljbild.png','image/png'),id:`diary:${id(20)}`,source:'diary',sourceId:id(20),url:`/api/action-cases/${caseId}/diary/photos/${id(20)}` }
let versions = [], failBefore=false, loseAfter=false, delay=0, failComplete=false, loseComplete=false, uploadFail=false, readOnly=false
const attempts = new Map(), uploads = new Map(), metrics = { saves:0, mutations:0, prepares:0, completeCalls:0 }
const allFiles = () => [...projectFiles,diaryFile,...[...uploads.values()].flatMap(upload=>upload.registered?[upload.registered]:[])]
const currentFiles = body => body.files.map(ref=>{ const file=allFiles().find(file=>file.id===instructionFileKey(ref)); assert.ok(file); return file })
const server = createServer(async(req,res)=>{
  const url=new URL(req.url,`http://${req.headers.host}`), send=(body,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body))}
  try {
    if(url.pathname==='/view.js'){res.setHeader('Content-Type','text/javascript');return res.end(js)}
    if(url.pathname==='/style.css'){res.setHeader('Content-Type','text/css');return res.end(css)}
    if(url.pathname.startsWith('/uppdrag/brand/')){res.setHeader('Content-Type',url.pathname.endsWith('.ttf')?'font/ttf':'image/svg+xml');return res.end(await readFile(resolve('public',url.pathname.slice(1))))}
    if(url.pathname==='/test/control'&&req.method==='POST'){
      const data=JSON.parse(await bytes(req));failBefore=Boolean(data.failBefore);loseAfter=Boolean(data.loseAfter);failComplete=Boolean(data.failComplete);loseComplete=Boolean(data.loseComplete);uploadFail=Boolean(data.uploadFail);delay=Number(data.delay)||0;readOnly=Boolean(data.readOnly)
      if(data.conflict){const old=versions.at(-1);versions.push({revision:(old?.revision||0)+1,body:{text:'Ändrad i annan flik.',files:[]},files:[],actorName:'Annan testperson',createdAt:new Date().toISOString()})}
      return send({ok:true})
    }
    if(url.pathname==='/test/metrics')return send({...metrics,versions:versions.length,uploads:uploads.size,registered:[...uploads.values()].filter(upload=>upload.registered).length})
    if(url.pathname.startsWith('/test/upload/')&&req.method==='PUT'){
      const key=decodeURIComponent(url.pathname.slice('/test/upload/'.length)), upload=uploads.get(key);assert.ok(upload)
      if(uploadFail)return send({error:'Upload failed'},503)
      upload.bytes=await bytes(req,false);return send({ok:true})
    }
    if(url.pathname===`/api/action-cases/${caseId}/diary/photos`)return send({images:[diaryPhoto],nextCursor:null})
    if(url.pathname.includes('/attachments/')||url.pathname.includes('/diary/photos/')){res.setHeader('Content-Type','image/png');return res.end(png)}
    if(url.pathname===endpoint){
      if(req.method==='GET'){
        if(url.searchParams.has('history')){let rows=[...versions].reverse();if(url.searchParams.has('before'))rows=rows.filter(v=>v.revision<Number(url.searchParams.get('before')));return send({versions:rows.slice(0,20),nextBeforeRevision:rows.length>20?rows[19].revision:null})}
        const latest=versions.at(-1);return send({revision:latest?.revision||0,body:latest?.body||{text:'',files:[]},files:latest?.files||[],projectFiles:allFiles().filter(file=>file.source==='project'),updatedAt:latest?.createdAt||null,updatedBy:latest?.actorName||'',cacheScope:'fictitious:test',readOnly})
      }
      const data=JSON.parse(await bytes(req))
      if(data.operation==='prepare'){
        const key=randomUUID();uploads.set(key,{...data});metrics.prepares++;return send({upload:{bucket:'fixture',filePath:key,token:'fictitious',contentType:data.contentType}})
      }
      if(data.operation==='complete'){
        metrics.completeCalls++;if(failComplete){failComplete=false;return send({error:'Simulerat registreringsfel'},503)}
        const upload=uploads.get(data.filePath);if(!upload?.bytes)return send({error:'Ingen uppladdad fil'},409)
        upload.registered??={...file(100+uploads.size,data.fileName,data.contentType),fileSizeBytes:data.fileSize}
        if(loseComplete){loseComplete=false;return send({error:'Registreringens svar försvann'},503)}
        return send({file:upload.registered})
      }
      const parsed=instructionSaveRequest(data);metrics.saves++
      if(delay)await new Promise(done=>setTimeout(done,delay))
      if(failBefore)return send({error:'Simulerat sparfel. Texten finns kvar.'},503)
      if(attempts.has(parsed.requestId)){const old=attempts.get(parsed.requestId);assert.deepEqual(parsed,old.request);return send(old.receipt)}
      if(parsed.revision!==(versions.at(-1)?.revision||0))return send({error:'Ändrad i annan flik. Hämta sparat.'},409)
      const version={revision:parsed.revision+1,body:parsed.body,files:currentFiles(parsed.body),actorName:'Testledare',createdAt:new Date().toISOString()}
      versions.push(version);const receipt={requestId:parsed.requestId,...version};attempts.set(parsed.requestId,{request:parsed,receipt})
      if(loseAfter){loseAfter=false;return send({error:'Svaret försvann efter sparning'},503)}
      return send(receipt)
    }
    res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Instruktioner · Fiktivt testprojekt</title><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/view.js"></script></body></html>')
  }catch(error){send({error:error.message},400)}
})
async function bytes(req,text=true){const data=[];for await(const part of req)data.push(part);const all=Buffer.concat(data);return text?all.toString('utf8'):all}
server.listen(Number(process.argv.find(arg=>arg.startsWith('--port='))?.slice(7))||0,'127.0.0.1',async()=>{
  const base=`http://127.0.0.1:${server.address().port}`;await writeFile(resolve(output,'url.txt'),base);console.log(base)
  if(process.argv.includes('--test')){try{const {testWorkInstructions}=await import('../test/helpers/work-instructions-browser.mjs');await testWorkInstructions(base,process.env.INSTRUCTIONS_TEST_OUTPUT||output)}catch(error){console.error(error);process.exitCode=1}finally{server.closeAllConnections();server.close()}}
})
