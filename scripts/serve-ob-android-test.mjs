import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { readFile,writeFile,mkdir,readdir,open } from 'node:fs/promises'
import { randomBytes,createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { join,resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServerClient,serializeCookieHeader } from '@supabase/ssr'
import { stagingEnvironment,validateStagingKeys } from './lib/ob-staging-app.mjs'
import { createMobileTestGateway } from './lib/ob-mobile-test-gateway.mjs'

const root=fileURLToPath(new URL('../',import.meta.url)),folder=join(root,'.cache/ob-staging-app')
const sessionFile=process.argv[2] ?? 'android-session.json'
assert.match(sessionFile,/^android-session(?:-[a-z0-9-]+)?\.json$/,'Expected a private Android session manifest name')
const read=async file=>JSON.parse(await readFile(join(folder,file),'utf8'))
let previous
try { previous=await read(sessionFile) } catch(error) { if(error.code!=='ENOENT')throw error }
assert.ok(!previous?.ready || previous.expiresAt<=Date.now(),'Active session exists; keep it running and use a separate session manifest')
const keys=validateStagingKeys(await read('keys.json'))
const fixture=await read('android-fixture.json'),build=await read('release-build-latest.json')
assert.equal(fixture.project,keys.url);assert.equal(fixture.ready,true)
assert.equal(build.project,keys.url);assert.equal(build.exitCode,0);assert.equal(build.sourceVerified,true)
assert.equal(resolve(build.app,'..'),resolve(folder))
assert.match(build.app.split(/[\\/]/).pop(),/^release-build-\d+$/)
assert.ok((await readdir(build.app)).every(name=>!name.startsWith('.env')),'No inherited environment files')
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
async function sourceFiles(base,prefix='') {
  const result=[]
  for(const entry of await readdir(join(base,prefix),{withFileTypes:true})) {
    const name=join(prefix,entry.name)
    if(entry.isDirectory())result.push(...await sourceFiles(base,name))
    else if(entry.isFile())result.push(name)
    else throw Error('Unexpected source link')
  }
  return result.sort()
}
const current=await sourceFiles(join(root,'src')),saved=await sourceFiles(join(build.app,'src'))
assert.deepEqual(saved,current,'Build source inventory changed')
for(const file of current)assert.equal(hash(await readFile(join(root,'src',file))),hash(await readFile(join(build.app,'src',file))),`Rebuild required: ${file}`)
const binary=join(folder,'bin/cloudflared-2026.9.1.exe')
assert.equal(hash(await readFile(binary)),'2837888cc0f5d58f15b6dc478376de90b4d3ba5241c7947455d1e0a0df429712')
const output=join(folder,'android-session-'+Date.now())
await mkdir(join(output,'tunnel-home'),{recursive:true})
const manifest={project:keys.url,inspection:fixture.inspection,property:fixture.property,output,
  code:randomBytes(12).toString('base64url'),expiresAt:Date.now()+8*60*60*1000,startedAt:new Date().toISOString(),
  pid:process.pid,build:build.app,sourceFilesVerified:current.length,ready:false}
const save=async()=>{await writeFile(join(output,'session.json'),JSON.stringify(manifest,null,2),{mode:0o600});await writeFile(join(folder,sessionFile),JSON.stringify(manifest,null,2),{mode:0o600})}
await save()
const temporary=createServer();await new Promise(r=>temporary.listen(0,'127.0.0.1',r))
const appPort=temporary.address().port;await new Promise(r=>temporary.close(r))
const env={...stagingEnvironment(process.env,keys,appPort),NODE_ENV:'production'}
const log=await open(join(output,'app.log'),'a')
const app=spawn(process.execPath,[join(root,'node_modules/next/dist/bin/next'),'start',build.app,'--hostname','127.0.0.1','--port',String(appPort)],
  {cwd:build.app,env,stdio:['ignore',log.fd,log.fd],windowsHide:true})
manifest.appPid=app.pid;manifest.appPort=appPort
let tunnel,gateway,closing=false
async function stop(reason) {
  if(closing)return;closing=true
  manifest.ready=false;manifest.stoppedAt=new Date().toISOString();manifest.stopReason=reason
  gateway?.server.closeAllConnections();gateway?.server.close();tunnel?.kill();app.kill()
  await save();await log.close()
}
process.on('SIGINT',()=>void stop('stopped'));process.on('SIGTERM',()=>void stop('stopped'))
app.on('exit',()=>{if(!closing)void stop('test app stopped')})
app.on('error',()=>void stop('test app could not start'))
try {
  const target=`http://127.0.0.1:${appPort}`
  let ready=false
  for(let i=0;i<60&&!ready;i++) {
    if(closing)throw Error('App stopped')
    try {
      const response=await fetch(target+`/properties/${fixture.property}/ob/${fixture.inspection}`,{signal:AbortSignal.timeout(3000),redirect:'manual'})
      ready=response.ok||response.status===307&&response.headers.get('location')==='/login'
      await response.body?.cancel()
    }
    catch { /* bounded startup wait */ }
    if(!ready)await delay(500)
  }
  assert.ok(ready,'Reviewed test build did not start')
  gateway=createMobileTestGateway({target,property:fixture.property,inspection:fixture.inspection,code:manifest.code,expiresAt:manifest.expiresAt,
    signIn:async()=>{
      let cookies=[]
      const client=createServerClient(keys.url,keys.anonKey,{cookies:{getAll:()=>[],setAll:all=>{cookies=all.map(c=>serializeCookieHeader(c.name,c.value,{...c.options,secure:true,sameSite:'lax',path:'/'}))}}})
      const {data,error}=await client.auth.signInWithPassword({email:fixture.person.email,password:fixture.person.password})
      assert.ok(!error,'Staging sign-in failed');assert.equal(data.user.id,fixture.person.id)
      return cookies
    }})
  await new Promise(r=>gateway.server.listen(0,'127.0.0.1',r))
  manifest.gatewayPort=gateway.server.address().port
  const {SystemRoot,WINDIR,COMSPEC,PATH,PATHEXT,TEMP,TMP}=env
  tunnel=spawn(binary,['tunnel','--no-autoupdate','--protocol','http2','--url',`http://127.0.0.1:${manifest.gatewayPort}`],
    {cwd:output,env:{SystemRoot,WINDIR,COMSPEC,PATH,PATHEXT,TEMP,TMP,USERPROFILE:join(output,'tunnel-home'),HOME:join(output,'tunnel-home')},
      windowsHide:true,stdio:['ignore','pipe','pipe']})
  manifest.tunnelPid=tunnel.pid
  const tunnelLog=await open(join(output,'tunnel.log'),'a')
  let text=''
  const consume=chunk=>{
    void tunnelLog.write(chunk)
    text=(text+chunk.toString()).slice(-16000)
    if(!manifest.url) {
      const url=text.match(/https:\/\/[a-z0-9]+(?:-[a-z0-9]+){2,}\.trycloudflare\.com/)?.[0]
      if(url){gateway.setPublicOrigin(url);manifest.url=url;manifest.ready=true;void save();console.log('Protected Android test entry is ready. Details saved privately.')}
    }
  }
  tunnel.stdout.on('data',consume);tunnel.stderr.on('data',consume)
  tunnel.on('exit',()=>{void tunnelLog.close();if(!closing)void stop('tunnel stopped')})
  tunnel.on('error',()=>void stop('tunnel could not start'))
  for(let i=0;i<90&&!manifest.ready&&!closing;i++)await delay(1000)
  assert.ok(manifest.ready&&!closing,'Test tunnel did not become ready')
  setTimeout(()=>void stop('eight-hour test window ended'),Math.max(1,manifest.expiresAt-Date.now())).unref()
} catch(error){await stop(error.message);console.error(error.message);process.exitCode=1}
