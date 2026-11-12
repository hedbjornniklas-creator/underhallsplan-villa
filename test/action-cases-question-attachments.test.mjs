import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { questionAttachmentIds, questionFileUpdateMutation, questionMutation, emptyQuestion } from '../src/lib/action-cases/projectQuestions.ts'
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const nodes=n=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(nodes):[n,...nodes(n.props?.children)]
const text=n=>typeof n==='string'?n:typeof n==='number'?String(n):Array.isArray(n)?n.map(text).join(''):n?.props?text(n.props.children):''
test('saved empty selection is authoritative; legacy notes and answers never become automatic attachments',()=>{
  const events=['create','update','send','note','answer'].map((operation,i)=>({operation,files:[{id:id(i),name:'Test'}]}))
  assert.deepEqual(questionAttachmentIds({events}),[id(0),id(1),id(2)])
  assert.deepEqual(questionAttachmentIds({events,attachmentIds:[]}),[])
  assert.deepEqual(questionAttachmentIds({events,attachmentIds:[id(9)]}),[id(9)])
})
test('supplement requests require versions, explicit consent, unique files and no spoofable recipient/body fields',()=>{
  const input={questionId:id(1),requestId:id(2),taskId:id(3),revision:3,taskVersion:7,operation:'share_files',confirmed:true,fileIds:[id(5)],recipient:{id:id(9)},body:{status:'closed'}}
  const clean=questionFileUpdateMutation(input);assert.equal(clean.recipient,undefined);assert.equal(clean.body,undefined)
  for(const patch of [{fileIds:[]},{fileIds:[id(5),id(5)]},{fileIds:Array.from({length:21},(_,i)=>id(50+i))},{taskVersion:0},{revision:0},{confirmed:false},{taskId:'bad'}]) assert.throws(()=>questionFileUpdateMutation({...input,...patch}))
  const create={questionId:id(1),requestId:id(2),revision:0,operation:'create',body:{...emptyQuestion(),title:'Test',description:'Fiktivt'},fileIds:[],attachmentSelection:1}
  assert.equal(questionMutation(create).attachmentSelection,1)
  assert.equal(questionMutation({...create,attachmentSelection:undefined}).attachmentSelection,undefined)
  assert.throws(()=>questionMutation({...create,attachmentSelection:2}))
})
test('attached list has no checkboxes, clear sharing status, existing image viewer and explicit source actions',()=>{
  let stateIndex=0;const states=[],changes=[]
  const jsx=(type,props)=>({type,props})
  const react={useState(initial){const i=stateIndex++;if(!(i in states))states[i]=initial;return[states[i],v=>{states[i]=typeof v==='function'?v(states[i]):v}]}}
  const dependencies={react,'lucide-react':{},'./ActionCaseImageViewer':{default:'viewer',ActionCaseAttachmentImage:'image'},'./QuestionDiaryImagePicker':{default:'bank'},'react/jsx-runtime':{jsx,jsxs:jsx}}
  const module={exports:{}};new Function('require','module','exports',ts.transpileModule(readFileSync(new URL('../src/components/tasks/QuestionAttachments.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText)(name=>{assert.ok(name in dependencies,name);return dependencies[name]},module,module.exports)
  const doc={id:id(1),fileName:'Ritning.pdf',type:'document'},image={id:id(2),fileName:'Foto.jpg',type:'image'},project={id:id(3),fileName:'Projektfil.pdf',type:'document'}
  const props={caseId:id(8),questionId:id(9),attachedIds:[doc.id,image.id],files:[doc,image,project],historicalFiles:[],projectFiles:[project],task:{id:id(10),assigneeName:'Testperson',files:[{id:id(11),sourceAttachmentId:doc.id,name:doc.fileName}]},disabled:false,readOnly:false,onChange:ids=>changes.push(ids),onUpload(){},onAttached(){},onWorking(){}}
  const render=()=>{stateIndex=0;return module.exports.default(props)};let tree=render()
  assert.equal(nodes(tree).filter(n=>n.type==='input'&&n.props.type==='checkbox').length,0)
  assert.match(readFileSync(new URL('../src/components/tasks/project-questions.css',import.meta.url),'utf8'),/\.gizmo-question-thumbnail\s*\{[^}]*position:relative/,'the shared absolute-positioned image must be contained by its thumbnail')
  assert.match(text(tree),/Bifogade filer/);assert.match(text(tree),/Inte delad med Testperson/);assert.match(text(tree),/Delad med Testperson/)
  assert.ok(nodes(tree).find(n=>n.type==='bank'&&n.props.buttonLabel==='Från bildbanken'))
  const button=label=>{const found=nodes(tree).find(n=>n.type==='button'&&(text(n)===label||n.props['aria-label']===label));assert.ok(found,`${label}: ${text(tree)}`);return found}
  button('Från projektet').props.onClick();tree=render();button(`Bifoga ${project.fileName}`).props.onClick();assert.deepEqual(changes.at(-1),[doc.id,image.id,project.id])
  button(`Ta bort ${image.fileName} från frågan`).props.onClick();assert.deepEqual(changes.at(-1),[doc.id])
  props.attachedIds=[image.id];tree=render();assert.match(text(tree),/Tidigare delade filer/)
  props.readOnly=true;tree=render();assert.equal(nodes(tree).filter(n=>n.type==='button'&&/Ladda upp|Ta bort|Från projektet/.test(text(n)+n.props['aria-label'])).length,0)
})
