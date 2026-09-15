import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer,request as httpRequest } from 'node:http'
import { once } from 'node:events'
import { createMobileTestGateway,mobileTestRoute } from '../scripts/lib/ob-mobile-test-gateway.mjs'

const property='11111111-1111-4111-8111-111111111111',inspection='22222222-2222-4222-8222-222222222222'
const host='android-test-protected.trycloudflare.com',origin='https://'+host
const page=`/properties/${property}/ob/${inspection}`,api=`/api/ob/inspections/${inspection}/buildings`
const code='test-access-code-for-unit-test'
const fetchLocal=(url,options={})=>new Promise((resolve,reject)=>{
  const request=httpRequest(url,{method:options.method??'GET',headers:options.headers},response=>{
    const chunks=[]
    response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>{
      const headers=new Headers()
      for(const [key,value] of Object.entries(response.headers))for(const entry of Array.isArray(value)?value:[value])if(entry!==undefined)headers.append(key,entry)
      resolve({status:response.statusCode,headers,text:async()=>Buffer.concat(chunks).toString()})
    })
  })
  request.on('error',reject);request.end(options.body===undefined?undefined:String(options.body))
})
test('route allowlist limits the mobile app, all APIs and image origins',()=>{
  for(const path of [page,api,'/_next/static/chunks/app.js','/api/organizations/context'])assert.equal(mobileTestRoute(path,'GET',{property,inspection}),true,path)
  for(const path of ['/api/staging/login','/api/fortnox/export','/api/reports/send',api.replace(inspection,property),'/admin',page+'/other','/_next/static/app.js.map',api+'/../../send',
    '/_next/image?url=https://production.example.invalid/photo.png','/api/image-proxy?url=http://127.0.0.1:3000/private','//example.invalid/'+api,
    '/api/ob/%2e%2e/secrets'])assert.equal(mobileTestRoute(path,'GET',{property,inspection}),false,path)
  assert.equal(mobileTestRoute(page,'POST',{property,inspection}),false,'No server action POSTs')
  assert.equal(mobileTestRoute(api,'POST',{property,inspection}),true)
  assert.equal(mobileTestRoute('/api/organizations/context','POST',{property,inspection}),false)
})

test('all app access needs code, trusted host and live session; mutations require same origin',async t=>{
  let calls=0,received
  const upstream=createServer((req,res)=>{calls++;received=req.headers;res.writeHead(200,{'Content-Type':'text/plain'});res.end('synthetic app')})
  upstream.listen(0,'127.0.0.1');await once(upstream,'listening')
  const gateway=createMobileTestGateway({target:`http://127.0.0.1:${upstream.address().port}`,property,inspection,code,expiresAt:Date.now()+60000,
    signIn:async()=>['synthetic-auth=fixture; Path=/; Secure; SameSite=Lax']})
  gateway.server.listen(0,'127.0.0.1');await once(gateway.server,'listening')
  t.after(()=>{gateway.server.closeAllConnections();gateway.server.close();upstream.closeAllConnections();upstream.close()})
  const request=(path,options={})=>fetchLocal(`http://127.0.0.1:${gateway.server.address().port}${path}`,{...options,headers:{host,...options.headers}})
  assert.equal((await request('/')).status,503)
  gateway.setPublicOrigin(origin)
  assert.throws(()=>gateway.setPublicOrigin('https://other-public-host.trycloudflare.com'),/Cannot switch/)
  const form=await request('/');assert.equal(form.status,200);assert.ok(!(await form.text()).includes(code))
  assert.equal(form.headers.get('referrer-policy'),'same-origin','Form POSTs must retain their same-origin Origin header')
  assert.equal((await request(page)).status,401)
  assert.equal((await request(api)).status,401)
  assert.equal((await request('/_next/static/test.js')).status,401)
  assert.equal((await request('/',{headers:{host:'untrusted.example'}})).status,421)
  const login=(value,site=origin)=>request('/__mobile/login',{method:'POST',headers:{origin:site,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code:value})})
  assert.equal((await login(code,'https://evil.example')).status,403)
  assert.equal((await login('wrong')).status,401)
  const success=await login(code);assert.equal(success.status,303)
  assert.equal(success.headers.get('location'),gateway.destination)
  const cookies=success.headers.getSetCookie()
  assert.match(cookies[0],/HttpOnly; Secure; SameSite=Strict/)
  const cookie=cookies.map(c=>c.split(';')[0]).join('; ')
  assert.equal((await request(page,{headers:{cookie}})).status,200)
  assert.equal(received.cookie.trim(),'synthetic-auth=fixture')
  assert.ok(!received.cookie.includes('__Host-ob-mobile-test'))
  assert.equal((await request(api,{method:'POST',headers:{cookie}})).status,403)
  assert.equal((await request(api,{method:'POST',headers:{cookie,origin},body:'{}'})).status,200)
  assert.match(received.origin,/^http:\/\/127.0.0.1:/)
  assert.equal((await request('/api/staging/login',{method:'POST',headers:{cookie,origin}})).status,403)
  assert.equal((await request(page,{method:'POST',headers:{cookie,origin}})).status,403)
  assert.equal((await request('/admin',{headers:{cookie}})).status,403)
  assert.equal(calls,2)
})

test('expired test windows fail closed and cannot issue an app session',async t=>{
  const gateway=createMobileTestGateway({target:'http://127.0.0.1:9',property,inspection,code,expiresAt:Date.now()-1,signIn:()=>assert.fail('No sign-in after expiry')})
  gateway.setPublicOrigin(origin);gateway.server.listen(0,'127.0.0.1');await once(gateway.server,'listening')
  t.after(()=>{gateway.server.closeAllConnections();gateway.server.close()})
  const response=await fetchLocal(`http://127.0.0.1:${gateway.server.address().port}/`,{headers:{host}})
  assert.equal(response.status,410)
})
