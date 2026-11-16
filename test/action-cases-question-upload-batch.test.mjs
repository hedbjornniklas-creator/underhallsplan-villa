import test from 'node:test'
import assert from 'node:assert/strict'
import { runQuestionUploadBatch } from '../src/lib/action-cases/questionUploadBatch.ts'
const entry = (id,name) => ({id,file:new File(['fictitious'],name),status:'pending'})
test('a mixed PDF and image selection runs sequentially, retains failures and only retries unfinished files',async()=>{
  const entries=[entry('a','Ritning.pdf'),entry('b','Foto.jpg'),entry('c','Beskrivning.docx')],calls=[],progress=[]
  let fail=true,running=0
  const upload=async value=>{
    calls.push(value.id); assert.equal(++running,1)
    try { await new Promise(resolve=>setImmediate(resolve)); if(value.id==='b'&&fail)throw Error('Fiktivt nätfel'); return `attached-${value.id}` } finally {running--}
  }
  await runQuestionUploadBatch(entries,upload,values=>progress.push(values.map(v=>v.status)))
  assert.deepEqual(entries.map(v=>v.status),['done','error','done'])
  assert.equal(entries[1].file.name,'Foto.jpg'); assert.equal(entries[1].error,'Fiktivt nätfel')
  fail=false
  await runQuestionUploadBatch(entries,upload,()=>{})
  assert.deepEqual(calls,['a','b','c','b'])
  assert.deepEqual(entries.map(v=>v.attachmentId),['attached-a','attached-b','attached-c'])
  assert.deepEqual(progress.at(-1),['done','error','done'])
})
test('oversized and empty files fail independently without stopping other uploads',async()=>{
  const entries=[entry('a','A.pdf'),{id:'b',file:{name:'Too-large.jpg',size:25*1024*1024+1},status:'pending'},{id:'c',file:new File([],'Empty.pdf'),status:'pending'},entry('d','D.jpg')],calls=[]
  await runQuestionUploadBatch(entries,async e=>{calls.push(e.id);return e.id},()=>{})
  assert.deepEqual(calls,['a','d']);assert.deepEqual(entries.map(e=>e.status),['done','error','error','done'])
})
