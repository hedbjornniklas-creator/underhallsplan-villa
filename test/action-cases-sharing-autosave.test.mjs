import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { customerSections, defaultCustomerVisibility } from '../src/lib/action-cases/customerSharing.ts'

function load(path,deps) {
  const m={exports:{}}
  new Function('require','module','exports',ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>{assert.ok(name in deps,name);return deps[name]},m,m.exports)
  return m.exports
}
const tick=()=>new Promise(resolve=>setImmediate(resolve))
function harness() {
  const states=[],refs=[],requests=[];let si=0,ri=0,hook
  const original=globalThis.fetch
  globalThis.fetch=async(url,options)=>new Promise(resolve=>requests.push({url,body:JSON.parse(options.body),resolve}))
  const react={useState(initial){const i=si++;if(i>=states.length)states[i]=typeof initial==='function'?initial():initial;return [states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value}]},useRef(initial){return refs[ri++]??= {current:initial}},useCallback:fn=>fn,useEffect(){}}
  const queue=load('../src/hooks/useAutosaveQueue.ts',{react})
  const module=load('../src/components/tasks/useCustomerSharingAutosave.ts',{react,'@/hooks/useAutosaveQueue':queue,'@/lib/action-cases/customerSharing':{customerSections}})
  const render=()=>{si=0;ri=0;return hook=module.useCustomerSharingAutosave('case')}
  render();hook.reset({revision:0,tabs:defaultCustomerVisibility(),canEdit:true,managerId:'manager',recipients:[],updatedAt:null,updatedBy:null});render()
  return {requests,render,get state(){return hook},change(key,value){hook.change(key,value);render()},async reply(index,error,other={}){const r=requests[index],revision=r.body.revision+1;const workspace={...hook.workspace,revision,tabs:{...hook.workspace.tabs,[r.body.section]:r.body.visible},...other};r.resolve({ok:!error,json:async()=>error?{error}:{requestId:r.body.requestId,acknowledgedRevision:revision,workspace}});await tick();render()},dispose(){globalThis.fetch=original}}
}
test('fast changes and undo serialize as single-field patches; a late save never restores an older visible state',async()=>{
  const h=harness();try{
    h.change('contract',false);h.change('contract',true);h.change('files',false)
    assert.equal(h.requests.length,1);assert.equal(h.state.edits.contract,true);assert.equal(h.state.busy,true)
    await h.reply(0);assert.equal(h.requests.length,2);assert.equal(h.requests[1].body.section,'contract');assert.equal(h.requests[1].body.visible,true);assert.equal(h.requests[1].body.revision,1)
    await h.reply(1);assert.equal(h.requests.length,3);assert.equal(h.requests[2].body.section,'files');assert.equal(h.requests[2].body.visible,false)
    await h.reply(2);assert.equal(h.state.workspace.tabs.contract,true);assert.equal(h.state.workspace.tabs.files,false);assert.equal(h.state.dirty,false);assert.equal(h.state.busy,false)
  }finally{h.dispose()}
})
test('failed saves keep intent and retry identity; changing another field cannot cause automatic retry or contract writes',async()=>{
  const h=harness();try{
    h.change('schedule',false);await h.reply(0,'Tillfälligt fel')
    assert.equal(h.state.dirty,true);assert.match(h.state.error,/Tillfälligt/)
    h.change('payments',false);assert.equal(h.requests.length,1)
    h.state.retry();h.render();assert.deepEqual(h.requests[1].body,h.requests[0].body)
    await h.reply(1);await h.reply(2)
    assert.equal(h.state.error,'');assert.equal(h.state.dirty,false)
    assert.ok(h.requests.every(r=>r.url.endsWith('/sharing')&&!('contractDraft' in r.body)))
  }finally{h.dispose()}
})
test('an acknowledged response adopts unrelated newer server fields instead of overwriting them with an old snapshot',async()=>{
  const h=harness();try{
    h.change('files',false)
    await h.reply(0,null,{revision:2,tabs:{...defaultCustomerVisibility(),files:false,choices:false}})
    assert.equal(h.requests.length,1);assert.equal(h.state.workspace.tabs.choices,false);assert.equal(h.state.dirty,false)
  }finally{h.dispose()}
})

test('a manager transfer stops the remaining queue without dropping unsaved intent',async()=>{
  const h=harness();try{
    h.change('files',false);h.change('choices',false)
    await h.reply(0,null,{canEdit:false,managerId:'new-manager'})
    assert.equal(h.requests.length,1);assert.equal(h.state.edits.choices,false)
    assert.equal(h.state.dirty,true);assert.match(h.state.error,/Projektansvarig/)
  }finally{h.dispose()}
})
