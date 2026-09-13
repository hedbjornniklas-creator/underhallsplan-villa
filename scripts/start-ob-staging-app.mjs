import { cp, mkdir, readFile, writeFile, symlink, access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { stagingEnvironment, allowedStagingApi, stagingUrl } from './lib/ob-staging-app.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const folder = join(root, '.cache/ob-staging-app')
const keys = JSON.parse(await readFile(join(folder, 'keys.json'), 'utf8'))
const port = Number(process.argv[2] ?? 57100)
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Invalid port')
const env = stagingEnvironment(process.env, keys, port)
const fixture = JSON.parse(await readFile(join(folder, 'fixtures.json'), 'utf8'))
if (fixture.project !== stagingUrl || !fixture.owner.id) throw Error('Create staging fixtures first')
env.OB_STAGING_EMAIL = fixture.owner.email
env.OB_STAGING_PASSWORD = fixture.owner.password
const app = join(folder, `app-${Date.now()}`)
await mkdir(app, { recursive: true })
// Explicit allowlist: no environment files, generated data, customer exports or git state.
for (const name of ['src', 'public', 'package.json', 'tsconfig.json', 'postcss.config.mjs', 'next-env.d.ts']) {
  await cp(join(root, name), join(app, name), { recursive: true })
}
for (const name of ['proxy.ts', 'middleware.ts']) {
  try { await access(join(app, 'src', name)); throw Error(`Review existing ${name} before staging`) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
}
await symlink(join(root, 'node_modules'), join(app, 'node_modules'), 'junction')
await cp(join(root, 'next.config.ts'), join(app, 'next.base.ts'))
await writeFile(join(app, 'next.config.ts'), `import base from './next.base'
export default { ...base, images: { remotePatterns: [{ protocol: 'https', hostname: '${new URL(stagingUrl).hostname}', pathname: '/storage/v1/object/public/**' }] },
async headers() { return [...await base.headers!(), { source: '/:path*', headers: [
{ key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: ${stagingUrl}; connect-src 'self' ${stagingUrl} ws://127.0.0.1:${port}; font-src 'self' data:; frame-src 'self' blob:; form-action 'self'; object-src 'none'" },
{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }, { key: 'X-OB-Test-Project', value: '${new URL(stagingUrl).hostname}' }] }] } }
`)
await writeFile(join(app, 'src/proxy.ts'), `import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
const allowedStagingApi = ${allowedStagingApi.toString()}
export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith('/api/') && !allowedStagingApi(request.nextUrl.pathname))
    return NextResponse.json({ error: 'Denna integration ar avstangd i testmiljon.' }, { status: 403 })
  return NextResponse.next()
}
export const config = { matcher: '/api/:path*' }
`)
await mkdir(join(app, 'src/app/staging'), { recursive: true })
await mkdir(join(app, 'src/app/staging/mobile'), { recursive: true })
await mkdir(join(app, 'src/app/api/staging/login'), { recursive: true })
await writeFile(join(app, 'src/app/staging/page.tsx'), `export default function Staging() {
return <main style={{maxWidth:480,margin:'48px auto',padding:24}}><h1>OB TEST</h1>
<p>Flerbyggnadsfastigheten, Testgatan 1</p><form method="post" action="/api/staging/login">
<button style={{padding:16,border:'1px solid #445bb0',borderRadius:4}} type="submit">Oppna testbesiktningen</button></form></main> }
`)
await writeFile(join(app, 'src/app/staging/mobile/page.tsx'), `export default function MobileStaging() {
return <main style={{background:'#e9eded',height:'100dvh',display:'flex',justifyContent:'center'}}>
<iframe title="OB TEST - mobilvy" src="/staging" style={{width:390,maxWidth:'100%',height:'100%',border:0,background:'white'}} /></main> }
`)
// This local-only login uses real staging Auth, not a bypass of application guards.
await writeFile(join(app, 'src/app/api/staging/login/route.ts'), `import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
export async function POST(request: Request) {
const origin = 'http://127.0.0.1:${port}'
if(request.headers.get('origin') !== origin || process.env.NEXT_PUBLIC_SUPABASE_URL !== '${stagingUrl}') return new Response('Forbidden',{status:403})
const response = NextResponse.redirect(new URL('/properties/${fixture.property}/ob/${fixture.inspection}?embed=1',origin),303)
const db = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{ cookies: {getAll:()=>[],setAll:(all)=>all.forEach(c=>response.cookies.set(c.name,c.value,c.options))} })
const result = await db.auth.signInWithPassword({email:process.env.OB_STAGING_EMAIL!,password:process.env.OB_STAGING_PASSWORD!})
if(result.error) return new Response('Test login failed',{status:401})
return response
}
`)
await writeFile(join(folder, 'running.json'), JSON.stringify({ app, port, url: `http://127.0.0.1:${port}`, project: new URL(stagingUrl).hostname }))
console.log(`Isolated staging app: http://127.0.0.1:${port}`)
const child = spawn(process.execPath, [join(root, 'node_modules/next/dist/bin/next'), 'dev', app, '--webpack', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: app, env, stdio: 'inherit' })
child.on('exit', code => { process.exitCode = code ?? 1 })
process.on('SIGINT', () => child.kill('SIGINT'))
