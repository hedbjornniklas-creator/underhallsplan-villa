import assert from 'node:assert/strict'
import { createServer, request as upstreamRequest } from 'node:http'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { allowedStagingApi, stagingUrl } from './ob-staging-app.mjs'

const digest=value=>createHash('sha256').update(value).digest()
const readOnly=method=>['GET','HEAD'].includes(method)
export function mobileTestRoute(path,method,{property,inspection}) {
  const url=new URL(path,'http://localhost')
  if(/%2f|%5c|%2e|\\/i.test(path)||!path.startsWith('/')||path.startsWith('//'))return false
  const name=url.pathname
  if(name===`/properties/${property}/ob/${inspection}`)return readOnly(method)
  if(name.startsWith('/_next/static/')&&!name.endsWith('.map'))return readOnly(method)
  if(['/favicon.ico','/logo.png','/icon.png'].includes(name)||/^\/report-assets\/[a-zA-Z0-9_.-]+$/.test(name))return readOnly(method)
  if(name==='/_next/image'||name==='/api/image-proxy') {
    const image=url.searchParams.get('url')
    if(!image||!readOnly(method))return false
    try { const parsed=new URL(image);return parsed.origin===stagingUrl&&parsed.pathname.startsWith('/storage/v1/object/public/') }
    catch { return /^\/report-assets\/[a-zA-Z0-9_.-]+$/.test(image) }
  }
  if(name==='/api/organizations/context')return readOnly(method)
  return ['GET','POST'].includes(method)&&name.startsWith(`/api/ob/inspections/${inspection}/`)&&allowedStagingApi(name)
}

const loginPage=`<!doctype html><html lang="sv"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>OB Androidtest</title><style>*{box-sizing:border-box}body{margin:0;background:#f4f7f6;color:#192c32;font:16px system-ui;letter-spacing:0}main{max-width:420px;margin:12vh auto;padding:24px}h1{font-size:28px;margin:0 0 28px}label{display:block;margin-bottom:8px}input,button{width:100%;min-height:52px;border:1px solid #8a9ca6;border-radius:6px;padding:12px;font:inherit}button{margin-top:16px;background:#3154a5;color:white;border:0;font-weight:600}input:focus-visible,button:focus-visible{outline:3px solid #91b4f3;outline-offset:2px}</style>
<main><h1>&Ouml;B Androidtest</h1><form method="post" action="/__mobile/login"><label for="code">&Aring;tkomstkod</label><input id="code" name="code" type="password" autocomplete="one-time-code" autocapitalize="none" spellcheck="false" required><button>&Ouml;ppna testbesiktningen</button></form></main></html>`

export function createMobileTestGateway({target,property,inspection,code,expiresAt,signIn}) {
  assert.match(target,/^http:\/\/127\.0\.0\.1:\d+$/)
  assert.match(property,/^[a-f0-9-]{36}$/);assert.match(inspection,/^[a-f0-9-]{36}$/)
  assert.ok(code.length>=16)
  const expected=digest(code),sessions=new Set(),attempts=[]
  let publicOrigin=null
  const destination=`/properties/${property}/ob/${inspection}?embed=1&round=mobile-v2`
  function setPublicOrigin(value) {
    assert.match(value,/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/)
    assert.ok(!publicOrigin||publicOrigin===value,'Cannot switch the live origin')
    publicOrigin=value
  }
  const server=createServer(async(req,res)=>{
    const send=(status,body)=>{res.writeHead(status,{'Content-Type':'text/plain; charset=utf-8'});res.end(body)}
    res.setHeader('Cache-Control','no-store')
    res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive')
    res.setHeader('Referrer-Policy','same-origin')
    res.setHeader('X-Content-Type-Options','nosniff')
    res.setHeader('X-Frame-Options','DENY')
    res.setHeader('X-OB-Test-Project',new URL(stagingUrl).hostname)
    res.setHeader('Content-Security-Policy',`default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: ${stagingUrl}; connect-src 'self' ${stagingUrl} wss://${new URL(stagingUrl).hostname}; font-src 'self' data:; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`)
    try {
      if(!publicOrigin)return send(503,'Test entry not ready')
      if(req.headers.host!==new URL(publicOrigin).host)return send(421,'Wrong host')
      if(Date.now()>=expiresAt)return send(410,'Testlanken har stangts. Kontakta din testansvarige.')
      if(!readOnly(req.method)&&req.headers.origin!==publicOrigin)return send(403,'Origin denied')
      if(req.url==='/'&&req.method==='GET') {
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(loginPage);return
      }
      if(req.url==='/__mobile/login'&&req.method==='POST') {
        const now=Date.now()
        while(attempts.length&&attempts[0]<now-600000)attempts.shift()
        if(attempts.length>=30)return send(429,'For manga forsok. Vanta tio minuter.')
        attempts.push(now)
        if(!String(req.headers['content-type']).startsWith('application/x-www-form-urlencoded'))return send(415,'Unsupported form')
        let body=''
        for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>2048)return send(413,'Form too large')}
        if(!timingSafeEqual(expected,digest(new URLSearchParams(body).get('code')?.trim()??'')))return send(401,'Fel atkomstkod. Ga tillbaka och forsok igen.')
        const cookies=await signIn()
        const token=randomBytes(32).toString('hex');sessions.add(token)
        const ttl=Math.floor((expiresAt-Date.now())/1000)
        res.writeHead(303,{Location:destination,'Set-Cookie':[
          `__Host-ob-mobile-test=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${ttl}`,...cookies]})
        res.end();return
      }
      const session=String(req.headers.cookie??'').split(';').map(s=>s.trim()).find(s=>s.startsWith('__Host-ob-mobile-test='))?.split('=')[1]
      if(!sessions.has(session))return send(401,'Test access required')
      if(!mobileTestRoute(req.url,req.method,{property,inspection}))return send(403,'Denna funktion ar avstangd i mobiltestet.')
      const headers={host:new URL(target).host,'accept-encoding':'identity'}
      for(const key of ['cookie','content-type','accept','accept-language','user-agent','rsc','next-router-state-tree','next-router-prefetch','next-url','if-none-match']) {
        if(req.headers[key])headers[key]=req.headers[key]
      }
      headers.cookie=String(headers.cookie??'').split(';').filter(s=>!s.trim().startsWith('__Host-ob-mobile-test=')).join(';')
      if(!readOnly(req.method))headers.origin=target
      const upstream=upstreamRequest(new URL(req.url,target),{method:req.method,headers,timeout:60000},response=>{
        if(response.headers.location) {
          const location=new URL(response.headers.location,target)
          if(location.origin!==target||!mobileTestRoute(location.pathname,'GET',{property,inspection})) {
            response.resume();send(502,'Unexpected app redirect');return
          }
          res.setHeader('Location',location.pathname+location.search)
        }
        for(const key of ['content-type','content-encoding','vary','etag','content-disposition'])if(response.headers[key])res.setHeader(key,response.headers[key])
        if(response.headers['set-cookie'])res.setHeader('Set-Cookie',response.headers['set-cookie'].map(cookie=>/;\s*Secure/i.test(cookie)?cookie:cookie+'; Secure'))
        res.writeHead(response.statusCode??502)
        response.pipe(res)
      })
      upstream.on('timeout',()=>upstream.destroy(Error('Upstream timeout')))
      upstream.on('error',()=>{if(!res.headersSent)send(502,'Testappen kunde inte nas. Forsok igen.');else res.destroy()})
      req.on('aborted',()=>upstream.destroy())
      let bytes=0
      req.on('data',chunk=>{bytes+=chunk.length;if(bytes>30*1024*1024){upstream.destroy();req.destroy()}})
      req.pipe(upstream)
    } catch {if(!res.headersSent)send(503,'Testinloggningen kunde inte slutforas. Forsok igen.');else res.destroy()}
  })
  server.on('upgrade',(_req,socket)=>socket.destroy())
  server.requestTimeout=90000;server.headersTimeout=15000
  return {server,setPublicOrigin,destination}
}
