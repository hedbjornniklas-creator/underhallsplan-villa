import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
// @ts-expect-error Node strip-types requires the TypeScript extension.
import { organizationSwitcherSurfaceForPath, organizationSwitchDestination } from '../src/lib/organizations/navigation.ts'

function load<T>(path: string, dependencies: Record<string, unknown>): T {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', code)((name: string) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name]
    throw new Error(`Unexpected dependency ${name}`)
  }, mod, mod.exports)
  return mod.exports as T
}

test('organization switching is available on the exact company and personal settings pages', () => {
  for (const path of ['/settings', '/settings/organisation', '/settings/profil']) assert.equal(organizationSwitcherSurfaceForPath(path), 'settings')
  for (const path of ['/settings/forutsattningar', '/settings-other', '/ob/settings', '/settings/organisation-admin']) assert.equal(organizationSwitcherSurfaceForPath(path), null)
  assert.equal(organizationSwitcherSurfaceForPath('/settings/kunder'), 'customers')
  assert.equal(organizationSwitchDestination({ pathname:'/settings/profil',search:'orgId=old',surface:'settings',orgId:'new' }), '/settings/profil?orgId=new')
  assert.equal(organizationSwitchDestination({ pathname:'/settings/organisation',search:'tab=members&orgId=old',surface:'settings',orgId:'new' }), '/settings/organisation?tab=members&orgId=new')
  assert.equal(organizationSwitchDestination({ pathname:'/tu/assignments/old',search:'id=old&orgId=old',surface:'tu',orgId:'new' }), '/tu?orgId=new')
})

type RedirectPage = { default: (props: {searchParams:Promise<Record<string, string | string[]>>}) => Promise<unknown> }
async function destination(path: string, params: Record<string,string|string[]>) {
  let target = ''
  const page = load<RedirectPage>(path, {'next/navigation':{ redirect: (value: string) => { target=value; throw new Error('REDIRECT') } }})
  await assert.rejects(page.default({searchParams:Promise.resolve(params)}), /REDIRECT/)
  return target
}

test('the stable Fortnox callback landing preserves result and selected company and opens integrations', async () => {
  const target = await destination('src/app/(app)/settings/page.tsx', {orgId:'company',fortnox:'connected'})
  const url = new URL(target,'https://hushub.se')
  assert.equal(url.pathname,'/settings/organisation')
  assert.equal(url.searchParams.get('orgId'),'company')
  assert.equal(url.searchParams.get('fortnox'),'connected')
  assert.equal(url.searchParams.get('tab'),'integrations')
  assert.equal(await destination('src/app/(app)/settings/page.tsx',{}),'/settings/organisation')
})

test('both old routes preserve duplicate or invalid selections for destination validation', async () => {
  for (const path of ['src/app/(app)/settings/page.tsx','src/app/(dashboard)/tu/settings/profile/page.tsx']) {
    const target = await destination(path,{orgId:['wrong','other']})
    assert.deepEqual(new URL(target,'https://hushub.se').searchParams.getAll('orgId'),['wrong','other'])
  }
  assert.equal(await destination('src/app/(dashboard)/tu/settings/profile/page.tsx',{orgId:'company'}),'/settings/profil?orgId=company')
})

test('settings switcher uses active membership without borrowing TU permission from another organization', async () => {
  const calls: unknown[] = []
  const memberships = [
    {org_id:'company-a',profile_id:'person',is_active:true,is_default:true,created_at:'1',organizations:{name:'A'}},
    {org_id:'company-b',profile_id:'person',is_active:true,is_default:false,created_at:'2',organizations:{name:'B'}},
    {org_id:'inactive',profile_id:'person',is_active:false,is_default:false,created_at:'3',organizations:{name:'Inactive'}},
    {org_id:'someone-else',profile_id:'other',is_active:true,is_default:false,created_at:'4',organizations:{name:'Other'}},
  ]
  const moduleGate = () => { throw new Error('Settings must not invoke work-module authorization') }
  const server = load<{getOrganizationSwitcherContext:(surface:string,orgId:string)=>Promise<{organization:{id:string};organizations:{id:string}[]}>}>('src/lib/organizations/server.ts',{
    'server-only':{},
    '@/lib/access/server':{hasCurrentUserAccess:moduleGate},
    '@/lib/tu/server':{requireTuContext:moduleGate},
    '@/lib/moisture/server':{requireMoistureContext:moduleGate},
    '@/lib/ob/organizationBindings': { requireObContext: moduleGate, requireObInspectionContext: moduleGate, requireObAssignmentContext: moduleGate, hasOrganizationObAccess: moduleGate },
    '@/lib/organizations/moduleAvailability':{hasOrganizationTuAccess:moduleGate},
    '@/lib/customers/server':{getOrganizationCustomerNavigationContext:moduleGate},
    './administration':{requireOrganizationContext:async (orgId:string)=>{
      calls.push(orgId)
      if (!['company-a','company-b'].includes(orgId)) throw new Error('ORG_MEMBERSHIP_REQUIRED')
      return {profileId:'person',organization:{id:orgId}}
    }},
    '@/lib/supabase/admin':{createSupabaseAdminClient:()=>({from:(table:string)=>{
      assert.equal(table,'org_members')
      const filters: [string,unknown][]=[]
      const query={select:()=>query,order:()=>query,eq:(key:string,value:unknown)=>{filters.push([key,value]);return query},
        then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({error:null,data:memberships.filter(row=>filters.every(([key,value])=>(row as Record<string,unknown>)[key]===value))}).then(resolve)}
      return query
    }})},
  })
  const result = await server.getOrganizationSwitcherContext('settings','company-b')
  assert.equal(result.organization.id,'company-b')
  assert.deepEqual(result.organizations.map(row=>row.id),['company-a','company-b'])
  await assert.rejects(server.getOrganizationSwitcherContext('settings','inactive'),/ORG_MEMBERSHIP_REQUIRED/)
  assert.deepEqual(calls,['company-b','inactive'])
})
