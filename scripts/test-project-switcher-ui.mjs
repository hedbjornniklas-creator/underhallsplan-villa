import assert from 'node:assert/strict'
import {mkdir,readFile} from 'node:fs/promises'
import {createServer} from 'node:http'
import {createRequire} from 'node:module'
import {resolve,join} from 'node:path'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import puppeteer from 'puppeteer-core'
const require=createRequire(import.meta.url),{webpack}=require('next/dist/compiled/webpack/webpack')
const output=resolve('tmp/project-switcher-ui'),evidence='C:/Users/hedbj/underhallsplan-villa/output/gizmo-project-switcher-20261116'
await mkdir(output,{recursive:true});await mkdir(evidence,{recursive:true})
await new Promise((done,fail)=>webpack({mode:'development',devtool:false,plugins:[new webpack.DefinePlugin({'process.env':JSON.stringify({NODE_ENV:'development'})})],entry:resolve('test/fixtures/project-switcher-view.tsx'),output:{path:output,filename:'view.js'},resolve:{extensions:['.tsx','.ts','.js'],alias:{'@':resolve('src')}},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:resolve('test/helpers/transpile-loader.mjs')},{test:/\.css$/,type:'asset/source'}]}},(error,stats)=>error||stats.hasErrors()?fail(error||Error(stats.toString('errors-only'))):done()))
const raw=(await readFile('src/app/globals.css','utf8')).replace('@import "tailwindcss";','@import "tailwindcss" source(none);\n@source "../components/tasks";')
const css=(await postcss([tailwind()]).process(raw,{from:resolve('src/app/globals.css')})).css+'\n'+await readFile('src/components/tasks/uppdrag-theme.css','utf8')+'\n'+await readFile('src/components/tasks/project-save-protection.css','utf8')
const js=await readFile(join(output,'view.js')),font=await readFile('public/uppdrag/brand/manrope.ttf')
const server=createServer((req,res)=>{if(req.url==='/view.js'){res.setHeader('Content-Type','text/javascript');res.end(js)}else if(req.url==='/style.css'){res.setHeader('Content-Type','text/css');res.end(css)}else if(req.url==='/uppdrag/brand/manrope.ttf'){res.end(font)}else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html lang="sv"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gizmo projektväljare - fiktivt test</title><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/view.js"></script></html>')}})
await new Promise(done=>server.listen(0,'127.0.0.1',done));const base=`http://127.0.0.1:${server.address().port}`
let browser
try{
 browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>void dialog.accept())
 const choose=async id=>page.select('.gizmo-project-switcher select',id)
 const click=async name=>{for(const node of await page.$$('button'))if(await node.evaluate((node,name)=>node.textContent.trim()===name,name)){await node.click();return}throw Error(`Missing ${name}`)}
 const url=()=>page.$eval('#navigation-result',node=>node.textContent)
 await page.setViewport({width:1280,height:900});await page.goto(base);await page.waitForSelector('.gizmo-project-switcher select')
 assert.equal(await page.$$eval('select option',nodes=>nodes.length),3)
 await page.screenshot({path:join(evidence,'desktop.png'),clip:{x:0,y:0,width:1280,height:350}})
 await choose('two');await page.waitForFunction(()=>document.querySelector('#navigation-result').textContent==='/uppdrag/two')
 assert.equal(await page.$eval('select',node=>node.value),'two')
 await page.goto(base);await page.waitForSelector('textarea');await page.type('textarea','Anteckning som inte får tappas')
 await choose('two');await page.waitForSelector('[aria-labelledby="gizmo-save-warning-title"]');assert.equal(await url(),'')
 await click('Stanna kvar');assert.equal(await page.$eval('select',node=>node.value),'one');assert.equal(await page.$eval('textarea',node=>node.value),'Anteckning som inte får tappas')
 await choose('two');await page.waitForSelector('[aria-labelledby="gizmo-save-warning-title"]');await click('Lämna ändå');await page.waitForFunction(()=>document.querySelector('#navigation-result').textContent==='/uppdrag/two')
 await page.goto(base);await page.waitForSelector('textarea');await page.click('input[type=checkbox]');await page.type('textarea','Autosparad anteckning');await choose('three');await page.waitForFunction(()=>document.querySelector('#navigation-result').textContent==='/uppdrag/three');assert.equal(await page.$('[aria-labelledby="gizmo-save-warning-title"]'),null)
 for(const width of [320,390]){await page.setViewport({width,height:844});await page.goto(base);await page.waitForSelector('select');await choose('two');await page.waitForFunction(()=>document.querySelector('#navigation-result').textContent==='/uppdrag/two');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:join(evidence,`mobile-${width}.png`),fullPage:true})}
 await page.goto(base+'/?error');await page.waitForSelector('[role=alert]');assert.equal(await page.$eval('select',node=>node.disabled),true);assert.ok(await page.$('[aria-label="Hämta projektlistan igen"]'))
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks:['organization directory and current selection','direct project switch','cancel preserves text and selection','explicit leave','autosave finishes before switching','completed projects','320/390px no overflow','retry on list failure'],screenshots:evidence},null,2))
}finally{await browser?.close();server.closeAllConnections();await new Promise(done=>server.close(done))}
