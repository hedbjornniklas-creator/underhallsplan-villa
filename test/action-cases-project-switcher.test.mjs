import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as model from '../src/lib/action-cases/projectSwitcher.ts'
import * as navigation from '../src/lib/action-cases/projectNavigation.ts'

const current={id:'current',title:'Åsvägen 12',status:'in_progress'}
test('project options keep the current renamed project, deduplicate IDs and group closed projects separately',()=>{
  const input=[{...current,title:'Old title'},{id:'other',title:'Projekt 2',status:'pricing'},{id:'closed',title:'Projekt 10',status:'completed'},{id:'cancelled',title:'Avbrutet projekt',status:'cancelled'}]
  const before=JSON.stringify(input),groups=model.projectSwitchGroups(input,current)
  assert.deepEqual(groups[0].projects.map(p=>p.title),['Projekt 2','Åsvägen 12'])
  assert.deepEqual(groups[1].projects.map(p=>p.id),['cancelled','closed'])
  assert.equal(JSON.stringify(input),before)
  assert.deepEqual(model.projectSwitchGroups([],current),[{label:'Aktiva projekt',projects:[current]}])
})

function load(file,deps,jsx=false){const mod={exports:{}};const code=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,...(jsx?{jsx:ts.JsxEmit.ReactJSX}:{})}}).outputText;new Function('require','module','exports',code)(name=>{assert.ok(name in deps,name);return deps[name]},mod,mod.exports);return mod.exports}
test('directory reads only names, IDs and statuses in the authorized organization and does not truncate at one page',async()=>{
  const reads=[],source=Array.from({length:501},(_,i)=>({id:String(i),title:`Projekt ${i}`,status:'pricing'}))
  const db={from(table){const read={table,filters:[]};reads.push(read);const q={select(columns){read.columns=columns;return q},eq(...v){read.filters.push(v);return q},order(){return q},async range(from,to){read.range=[from,to];return {data:source.slice(from,to+1),error:null}}};return q}}
  const api=load('../src/lib/action-cases/projectSwitcherServer.ts',{'server-only':{},'@/lib/supabase/admin':{createSupabaseAdminClient:()=>db}})
  assert.equal((await api.getProjectSwitchOptions({orgId:'allowed'})).length,501)
  assert.deepEqual(reads.map(r=>r.range),[[0,499],[500,999]])
  for(const r of reads){assert.equal(r.table,'action_cases');assert.equal(r.columns,'id,title,status');assert.deepEqual(r.filters,[['org_id','allowed']])}
})
test('directory errors are not returned as a partial successful list',async()=>{
  const db={from(){const q={select(){return q},eq(){return q},order(){return q},async range(){return {data:null,error:{message:'unavailable'}}}};return q}}
  const api=load('../src/lib/action-cases/projectSwitcherServer.ts',{'server-only':{},'@/lib/supabase/admin':{createSupabaseAdminClient:()=>db}})
  await assert.rejects(api.getProjectSwitchOptions({orgId:'allowed'}),/PROJECT_SWITCHER_READ_FAILED/)
})

test('switching uses the existing save guard, retains the original selection on cancellation and rejects unknown IDs',async()=>{
  let cursor=0,allowed=false,guardCalls=0;const slots=[],navigated=[]
  const state=value=>{const i=cursor++;if(!(i in slots))slots[i]=value;return[slots[i],v=>{slots[i]=v}]}
  const jsx=(type,props)=>({type,props}), react={useState:state,useRef:value=>state({current:value})[0],useId:()=> 'switch',useEffect:()=>{}}
  const api=load('../src/components/tasks/ProjectSwitcher.tsx',{react,'react/jsx-runtime':{jsx,jsxs:jsx},'lucide-react':{},'@/lib/action-cases/projectSwitcher':model,'@/lib/action-cases/projectNavigation':navigation,'./ProjectSaveProtection':{useProjectSaveNavigation:()=>async go=>{guardCalls++;if(allowed)go()}}},true)
  const props={current,projects:[current,{id:'other',title:'Annan',status:'pricing'}],onNavigate:url=>navigated.push(url)}
  const nodes=node=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(nodes):[node,...nodes(node.props?.children)]
  let tree;const render=()=>{cursor=0;tree=api.default(props)};const select=()=>nodes(tree).find(n=>n.type==='select')
  render();const change=async id=>{const target={value:id};select().props.onChange({target,currentTarget:target});assert.equal(target.value,current.id);await new Promise(resolve=>setImmediate(resolve));render()}
  await change('unknown');await change('current');assert.equal(guardCalls,0)
  await change('other');assert.equal(guardCalls,1);assert.deepEqual(navigated,[]);assert.equal(select().props.value,current.id);assert.equal(select().props.disabled,false)
  allowed=true;await change('other');assert.deepEqual(navigated,['/uppdrag/other']);assert.equal(select().props.disabled,true)
})

test('a missing project directory leaves the current project visible and provides retry feedback',()=>{
  const source=readFileSync(new URL('../src/app/(dashboard)/uppdrag/[caseId]/page.tsx',import.meta.url),'utf8')
  assert.match(source,/getProjectSwitchOptions\(ctx\)/);assert.match(source,/key=\{caseId\}/)
  const ui=readFileSync(new URL('../src/components/tasks/ProjectSwitcher.tsx',import.meta.url),'utf8')
  assert.match(ui,/Hämta projektlistan igen/);assert.match(ui,/pageshow/)
})
