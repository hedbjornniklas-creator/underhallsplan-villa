import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

function queueHarness(protectUnload) {
  const slots=[],effects=[],listeners=new Set();let cursor=0,ei=0,api,finish
  const equal=(a,b)=>a&&b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]))
  const react={
    useState(value){const index=cursor++;if(!(index in slots))slots[index]=typeof value==='function'?value():value;return[slots[index],next=>{slots[index]=typeof next==='function'?next(slots[index]):next}]},
    useRef(value){const index=cursor++;return slots[index]??={current:value}},useCallback:fn=>fn,
    useEffect(fn,deps){const index=ei++;if(!effects[index]||!equal(effects[index].deps,deps))effects[index]={fn,deps,cleanup:effects[index]?.cleanup,pending:true}},
  }
  const window={addEventListener:(_name,fn)=>listeners.add(fn),removeEventListener:(_name,fn)=>listeners.delete(fn)}
  const module={exports:{}},code=ts.transpileModule(read('src/hooks/useAutosaveQueue.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  new Function('require','module','exports','window',code)(()=>react,module,module.exports,window)
  const render=()=>{cursor=0;ei=0;api=module.exports.useAutosaveQueue({save:()=>new Promise(resolve=>{finish=resolve}),...(protectUnload===undefined?{}:{protectUnload})});for(const effect of effects)if(effect.pending){effect.pending=false;effect.cleanup?.();effect.cleanup=effect.fn()}return api}
  const warns=()=>{let prevented=false;for(const listener of listeners)listener({preventDefault(){prevented=true},returnValue:''});return prevented}
  return{render,warns,finish:()=>finish(),dispose(){for(const effect of effects)effect.cleanup?.()}}
}
test('the shared queue still protects other Hushub modules by default and clears after acknowledgement',async()=>{
  const h=queueHarness()
  try{const pending=h.render().enqueue(true);h.render();assert.equal(h.warns(),true);h.finish();await pending;h.render();assert.equal(h.warns(),false)}finally{h.dispose()}
})
test('Gizmo can delegate the queue guard to its named editor without a second beforeunload warning',async()=>{
  const h=queueHarness(false)
  try{const pending=h.render().enqueue(true);h.render();assert.equal(h.warns(),false);h.finish();await pending;h.render();assert.equal(h.warns(),false)}finally{h.dispose()}
})
test('project protection names real pending editors, not an open request or a background GET',()=>{
  const workspace=read('src/components/tasks/ActionCaseWorkspace.tsx')
  const guard=workspace.match(/const guarded = ([^\n]+)/)?.[1]
  assert.ok(guard);assert.doesNotMatch(guard,/Boolean\(requestEditor\)|\bbusy\b/)
  assert.match(guard,/writePending/)
  for(const part of ['Omfattning','Kalkyl','Kundpris'])assert.ok(workspace.includes(`Projektarbete · ${part}`))
  assert.match(read('src/components/tasks/ActionCaseQuoteRequests.tsx'),/const formDirty = dirty && formBaseline !== JSON.stringify\(form\)/)
})
test('the coordinator only flushes existing queues and never mutates a project, sends a message or clears drafts',()=>{
  const source=read('src/components/tasks/ProjectSaveProtection.tsx')
  assert.doesNotMatch(source,/\bfetch\(|\.removeItem\(|\.clear\(/)
  assert.match(source,/entry\.flush\(\)/)
  assert.match(source,/entry\.lossRisk !== false/)
  assert.match(source,/approvedLeave\.current/)
  assert.match(source,/Stanna kvar/);assert.match(source,/Lämna ändå/)
})
