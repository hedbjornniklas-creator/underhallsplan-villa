import { readFile, mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import puppeteer from 'puppeteer-core'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
const require=createRequire(import.meta.url)
const {webpack}=require('next/dist/compiled/webpack/webpack')
const out=resolve('outputs/renoapp-film/combined')
await mkdir(out,{recursive:true})
await new Promise((ok,no)=>webpack({mode:'development',devtool:false,entry:resolve('outputs/renoapp-film/capture-list.tsx'),output:{path:out,filename:'list.js'},resolve:{extensions:['.tsx','.ts','.js'],alias:{'@':resolve('src'),'next/navigation':resolve('test/fixtures/renoapp-navigation.ts')}},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:resolve('test/helpers/transpile-loader.mjs')}]}},(e,s)=>e||s.hasErrors()?no(e??new Error(s.toString('errors-only'))):ok()))
const {css}=await postcss([tailwind()]).process(await readFile('src/app/globals.css','utf8'),{from:resolve('src/app/globals.css')})
const js=await readFile(resolve(out,'list.js'))
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/list.js'?'application/javascript':'text/html; charset=utf-8');res.end(req.url==='/list.js'?js:`<!doctype html><html><head><style>${css}</style></head><body><div id="root"></div><script src="/list.js"></script></body></html>`)})
await new Promise(ok=>server.listen(0,'127.0.0.1',ok))
let browser
try {
 browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
 const page=await browser.newPage()
 page.on('pageerror',error=>console.error(error.message))
 page.on('console',message=>console.log(message.text()))
 await page.setViewport({width:1280,height:800})
 await page.setRequestInterception(true)
 page.on('request',req=>new URL(req.url()).hostname==='127.0.0.1'?req.continue():req.abort())
 await page.evaluateOnNewDocument(()=>{window.process={env:{NODE_ENV:'development'}}})
 await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'networkidle0'})
 await page.waitForFunction(()=>document.body.textContent.includes('Anna Exempel'))
 await page.screenshot({path:resolve(out,'cases.png'),fullPage:true})
 console.log('Captured actual case-list component with isolated fictional data')
} finally {await browser?.close();await new Promise(ok=>server.close(ok))}
