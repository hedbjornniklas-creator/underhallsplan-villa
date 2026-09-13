import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { createElement, type ComponentType } from 'react'
import * as React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
// @ts-expect-error Native Node tests require the .ts extension.
import { buildReportSpec } from '../src/lib/report/reportSpec.ts'

function load<T>(path: string, dependencies: Record<string, unknown>): T {
  const output = ts.transpileModule(readFileSync(new URL('../'+path,import.meta.url),'utf8'), {
    compilerOptions: {module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},
  }).outputText
  const compiled={exports:{}}
  new Function('require','module','exports',output)((name:string)=>{
    if(name==='next/server') return {NextResponse:Response}
    assert.ok(name in dependencies,'Unexpected dependency: '+name)
    return dependencies[name]
  },compiled,compiled.exports)
  return compiled.exports as T
}
const floors=load('src/lib/ob/floorModel.ts',{})
const mutation=load('src/lib/ob/roundMutationServer.ts',{'./overviewFloors':load('src/lib/ob/overviewFloors.ts',{})})
const commands=load('src/lib/ob/buildingCommands.ts',{'./floorModel':floors,'./roundMutationServer':mutation})
const root=randomUUID(), part=randomUUID(), actor=randomUUID(), org=randomUUID()
function api(authError?:string) {
  const calls:{name:string;args:Record<string,unknown>}[]=[]
  const route=load<typeof import('../src/app/api/ob/inspections/[id]/buildings/route')>('src/app/api/ob/inspections/[id]/buildings/route.ts',{
    '@/lib/assignments/server':{requireOrgContext:async()=>{if(authError)throw Error(authError);return {orgId:org,userId:actor}}},
    '@/lib/supabase/admin':{createSupabaseAdminClient:()=>{throw Error('Unexpected admin call')}},
    '@/lib/ob/assignmentWorkflowServer':{obWorkflowRpc:async(name:string,args:Record<string,unknown>)=>{calls.push({name,args});return {ok:true}}},
    '@/lib/ob/roundMutationServer':mutation,'@/lib/ob/buildingCommands':commands,'@/lib/ob/buildingStructure':{},
  })
  const post=(body:unknown)=>route.POST(new Request('http://localhost/api/test',{method:'POST',body:JSON.stringify(body)}),{params:Promise.resolve({id:root})})
  return {calls,post}
}
test('building API validates before RPC and uses server actor, org and root',async()=>{
  const a=api()
  const payload={partId:part,revision:1,requestId:randomUUID(),name:'Garage',actor:'untrusted',orgId:'untrusted'}
  assert.equal((await a.post({operation:'edit',payload:{...payload,partId:'bad'}})).status,400)
  assert.equal(a.calls.length,0)
  assert.equal((await a.post({operation:'edit',payload})).status,200)
  assert.equal(a.calls[0].args.p_actor,actor)
  assert.equal(a.calls[0].args.p_org_id,org)
  assert.equal(a.calls[0].args.p_inspection_id,root)
  assert.equal(a.calls[0].name,'ob_building_command')
  const denied=api('Unauthorized'); assert.notEqual((await denied.post({operation:'edit',payload})).status,200)
  assert.equal(denied.calls.length,0)
})
test('API rejects source/file rewrites and foreign cover paths',async()=>{
  const a=api()
  const base={partId:part,id:randomUUID(),revision:1,requestId:randomUUID(),table:'inspection_images',operation:'update'}
  for(const row of [{file_path:'replacement.jpg'},{origin_building_part_id:randomUUID()},{building_part_id:randomUUID()}]) {
    assert.equal((await a.post({operation:'row',payload:{...base,row}})).status,400)
  }
  assert.equal((await a.post({operation:'edit',payload:{...base,coverPath:root+'/building-covers/'+randomUUID()+'/photo.jpg'}})).status,400)
  assert.equal(a.calls.length,0)
})
test('building appendices have independent source paths, full note blocks and TOC entries',()=>{
  const legacy=buildReportSpec({inspectionSide:'buyer'})
  assert.deepEqual(buildReportSpec({inspectionSide:'buyer',dynamicAppendices:{buildings:[]}}),legacy)
  const buildings=[{id:'garage',name:'Garage'},{id:'guest',name:'Gästhus'},{id:'studio',name:'Studio'}]
  const spec=buildReportSpec({inspectionSide:'buyer',dynamicAppendices:{includeAreaMeasurement:true,includeMoistureControl:true,buildings}})
  for(const [index,building] of buildings.entries()) {
    const section=spec.find(s=>s.id==='appendix-building-'+building.id)!
    assert.equal(section.title,`Bilaga ${6+index}: ${building.name}`)
    assert.ok(section.blocks.some(b=>b.type==='inspectionBlocks'&&b.itemsPath===`mock.appendices.buildings.${index}.introduction`))
    for(const area of ['exterior','interior']) assert.ok(section.blocks.some(b=>b.type==='inspectionBlocks'&&b.itemsPath===`mock.appendices.buildings.${index}.${area}.blocks`))
    const toc=spec.find(s=>s.id==='toc')!.blocks.find(b=>b.type==='toc')!
    assert.ok(toc.type==='toc'&&toc.entries.some(e=>e.sectionId===section.id))
  }
  assert.deepEqual(buildReportSpec({inspectionSide:'buyer'}),legacy,'generating appendices must not mutate the global spec')
})

test('enrolled review renders the complete report and never mounts unscoped legacy editors',()=>{
  let active = true
  const dependencies: Record<string, unknown> = {
    react: React, 'react/jsx-runtime': jsxRuntime, 'lucide-react': { ExternalLink: () => null },
    './ObBuildingContext': { useObBuilding: () => active ? { overview: {
      structure: { revision: 7 }, parts: [{ name: 'Huvudbyggnad' }, { name: 'Garage' }],
    } } : null },
  }
  for (const name of ['ObStepAreamatning','ObStepForutsattningar','ObStepFuktkontroll','ObStepGrunddata','ObStepHandlingar','ObStepInsida','ObStepUtsida']) {
    dependencies['./'+name] = { default: () => createElement('div', { 'data-legacy-editor': name }) }
  }
  const { default: Review } = load<{default: ComponentType<Record<string, unknown>>}>('src/components/ob/ObStepGranska.tsx', dependencies)
  const props = { property: { id: 'property' }, inspection: { id: root }, availableSections: ['grunddata','forutsattningar','runda-ny'] }
  const scoped = renderToStaticMarkup(createElement(Review, props))
  assert.ok(scoped.includes(`/utlatande/property/${root}?embed=1&amp;revision=7`))
  assert.match(scoped, /Garage/)
  assert.doesNotMatch(scoped, /data-legacy-editor/)
  active = false
  const legacy = renderToStaticMarkup(createElement(Review, props))
  assert.match(legacy, /data-legacy-editor/)
  assert.doesNotMatch(legacy, /<iframe/)
})
