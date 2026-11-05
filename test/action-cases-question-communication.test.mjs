import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const content = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(content).join('') : node?.props ? content(node.props.children) : ''
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)]
const tick = () => new Promise(resolve => setImmediate(resolve))
function harness(shared = false) {
  const states = [], refs = [], effects = [], memos = [], requests = [], storage = new Map()
  let si=0,ri=0,ei=0,mi=0,changed=false,tree,refreshes=0
  const original = { fetch: globalThis.fetch, localStorage: globalThis.localStorage, window: globalThis.window, document: globalThis.document }
  globalThis.localStorage = { getItem: key => storage.get(key) || null, setItem: (key,value) => storage.set(key,value), removeItem: key => storage.delete(key) }
  globalThis.window = { setInterval:()=>1,clearInterval(){},addEventListener(){},removeEventListener(){},confirm:()=>true }
  globalThis.document = { visibilityState:'visible' }
  const data = { questionId:id(1),version:1,sharedAt:shared?'2026-11-05T10:00:00Z':null,snapshot:null,status:'open',managerId:id(9),canManage:true,viewerId:id(90),participants:[{id:id(90),kind:'profile',personId:id(9),name:'Manager',email:'manager@example.invalid',shared},{id:id(91),kind:'contact',personId:id(10),name:'Recipient',email:'recipient@example.invalid',shared}],messages:[],deliveries:[] }
  globalThis.fetch = async (_url,options) => options?.method ? new Promise(resolve=>requests.push({body:JSON.parse(options.body),resolve})) : {ok:true,json:async()=>structuredClone(data)}
  const equal=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]))
  const react = {
    useState(value){const i=si++;if(i>=states.length)states[i]=typeof value==='function'?value():value;return [states[i],next=>{const value=typeof next==='function'?next(states[i]):next;if(!Object.is(value,states[i])){states[i]=value;changed=true}}]},
    useRef(value){return refs[ri++]??={current:value}},
    useCallback(fn,deps){const i=mi++;if(!memos[i]||!equal(memos[i].deps,deps))memos[i]={fn,deps};return memos[i].fn},
    useEffect(fn,deps){const i=ei++;if(!effects[i]||!equal(effects[i].deps,deps))effects[i]={fn,deps,cleanup:effects[i]?.cleanup,pending:true}},
  }
  const roster={seed:(_key,value)=>value,value:()=>[],revision:()=>1,isBusy:()=>false,isLocal:()=>true,flush:async()=>true,local:true,busy:false,error:'',dirty:false}
  const deps={react,'react-dom':{createPortal:node=>node},'lucide-react':{},'./project-questions.css':{},'@/lib/tasks/dateTime':{formatTaskDateTime:value=>value},'./useQuestionAutosave':{useQuestionAutosave:()=>roster},'./TaskContactFields':{},'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})}}
  const module={exports:{}},source=ts.transpileModule(readFileSync(new URL('../src/components/tasks/QuestionDialogue.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText
  new Function('require','module','exports',source)(key=>{assert.ok(key in deps,key);return deps[key]},module,module.exports)
  const props={endpoint:'/dialogue',fileBase:'/files',initial:data,storageKey:'fixture',taskReply:{taskId:id(50),name:'Recipient',recipient:{kind:'contact',id:id(10),email:'recipient@example.invalid'}},hasSharedDialogue:shared,onRefresh:async()=>{refreshes++},onNote:async()=>{throw Error('No notes expected')},internalEvents:[{id:id(70),actorName:'Manager',text:'OLD PRIVATE MESSAGE',createdAt:'2026-11-05T10:00:00Z',label:'Private',files:[]}]}
  const render=()=>{for(let n=0;n<20;n++){changed=false;si=ri=ei=mi=0;tree=module.exports.default(props);for(const effect of effects)if(effect.pending){effect.pending=false;effect.cleanup?.();effect.cleanup=effect.fn()}if(!changed)break}return tree}
  const button=name=>{const b=nodes(tree).find(n=>n.type==='button'&&(content(n)===name||n.props['aria-label']===name));assert.ok(b,name);return b}
  const field=()=>nodes(tree).find(n=>n.type==='textarea')
  render()
  return {props,data,requests,storage,render,button,field,text:()=>content(tree),refreshes:()=>refreshes,
    type(value){field().props.onChange({target:{value}});render()},
    radio(value){const input=nodes(tree).find(n=>n.type==='input'&&n.props.type==='radio'&&n.props.checked===false&&content(nodes(tree).find(label=>label.type==='label'&&nodes(label).includes(n))).includes(value));assert.ok(input,value);input.props.onChange();render()},
    async click(name){button(name).props.onClick();await tick();render()},
    async settle(index,error,code){requests[index].resolve({ok:!error,status:code?409:error?500:200,json:async()=>error?{error,code}:{questionId:data.questionId,messageId:requests[index].body.requestId}});await tick();render()},
    dispose(){for(const effect of effects)effect.cleanup?.();Object.assign(globalThis,original)},
  }
}
test('individual question can reply in Communication through the existing task without sharing private history',async()=>{
  const h=harness()
  try{
    assert.equal(h.field().props.disabled,false)
    h.type('NEW PRIVATE REPLY');await h.click('Skicka meddelande')
    assert.equal(h.requests[0].body.operation,'task_reply')
    assert.deepEqual(h.requests[0].body.recipient,{kind:'contact',id:id(10),email:'recipient@example.invalid'})
    assert.equal(h.requests[0].body.text,'NEW PRIVATE REPLY')
    assert.doesNotMatch(JSON.stringify(h.requests[0].body),/OLD PRIVATE MESSAGE/)
    assert.match(h.text(),/Skickar/)
    await h.settle(0)
    assert.equal(h.field().props.value,'')
    assert.equal(h.refreshes(),1)
    assert.match(h.text(),/enskilda uppgiften/)
    assert.equal(h.data.status,'open')
  }finally{h.dispose()}
})
test('a group defaults to shared replies; individual and internal drafts remain separate',async()=>{
  const h=harness(true)
  try{
    h.type('GROUP DRAFT')
    h.radio('Intern anteckning');h.type('INTERNAL DRAFT')
    h.radio('via Uppdrag');h.type('INDIVIDUAL DRAFT')
    h.radio('Meddelande till deltagarna')
    assert.equal(h.field().props.value,'GROUP DRAFT')
    await h.click('Skicka meddelande')
    assert.equal(h.requests[0].body.operation,'reply')
    assert.equal(h.requests[0].body.text,'GROUP DRAFT')
    assert.doesNotMatch(JSON.stringify(h.requests[0].body),/INTERNAL DRAFT|INDIVIDUAL DRAFT|OLD PRIVATE/)
    await h.settle(0)
  }finally{h.dispose()}
})
test('a changed recipient cannot silently receive an existing draft, and uncertain retries keep their exact recipient and identity',async()=>{
  const h=harness()
  try{
    h.type('DRAFT')
    h.props.taskReply={taskId:id(50),name:'Other recipient',recipient:{kind:'contact',id:id(11),email:'other@example.invalid'}};h.render()
    assert.equal(h.field().props.value,'DRAFT')
    assert.equal(h.button('Skicka meddelande').props.disabled,true)
    const confirm=nodes(h.render()).find(n=>n.type==='button'&&content(n).includes('Other recipient'))
    assert.ok(confirm);confirm.props.onClick();h.render()
    await h.click('Skicka meddelande')
    const first=h.requests[0].body
    await h.settle(0,'Network failure')
    assert.equal(h.field().props.value,'DRAFT')
    h.props.taskReply={taskId:id(50),name:'Third recipient',recipient:{kind:'contact',id:id(12),email:'third@example.invalid'}};h.render()
    await h.click('Försök igen')
    assert.deepEqual(h.requests[1].body,first)
    await h.settle(1)
  }finally{h.dispose()}
})
test('a definite recipient conflict releases only the rejected attempt and requires explicit recipient confirmation',async()=>{
  const h=harness()
  try{
    h.type('KEEP THIS DRAFT');await h.click('Skicka meddelande')
    const first=h.requests[0].body
    h.props.taskReply={taskId:id(50),name:'New recipient',recipient:{kind:'contact',id:id(11),email:'new@example.invalid'}}
    await h.settle(0,'Recipient changed','PROJECT_QUESTION_TASK_RECIPIENT_CHANGED')
    assert.equal(h.field().props.value,'KEEP THIS DRAFT')
    assert.equal(h.field().props.disabled,false)
    assert.equal(h.button('Skicka meddelande').props.disabled,true)
    assert.ok([...h.storage.values()].every(value=>JSON.parse(value).pending===null))
    const confirm=nodes(h.render()).find(n=>n.type==='button'&&content(n).includes('New recipient'))
    confirm.props.onClick();h.render();await h.click('Skicka meddelande')
    assert.notEqual(h.requests[1].body.requestId,first.requestId)
    assert.deepEqual(h.requests[1].body.recipient,h.props.taskReply.recipient)
    await h.settle(1)
  }finally{h.dispose()}
})
