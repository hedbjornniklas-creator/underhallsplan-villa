import test from 'node:test'
import assert from 'node:assert/strict'
import { signedContractResponse, signedContractFileIssue, uploadSignedContract } from '../src/lib/action-cases/contractSignedUpload.ts'

test('upload errors never expose a JSON syntax error or an infrastructure HTML page', async () => {
  for (const [status, text] of [[413,'Request Entity Too Large'],[500,'<html>Bad Gateway</html>'],[401,'Unauthorized'],[200,'not json']])
    await assert.rejects(signedContractResponse(new Response(text,{status})), error => !/Unexpected token|<html>/.test(error.message))
  await assert.rejects(signedContractResponse(Response.json({error:'Filen är ogiltig.'},{status:400})),/Filen är ogiltig/)
})
test('large files travel only to private storage; API requests carry small JSON metadata', async () => {
  const file=new File(['%PDF-'+ 'x'.repeat(11_487_237)],'Fiktivt.pdf',{type:'application/pdf'}), requests=[], writes=[]
  const attempt={file,revision:3}
  const request=async(url,options)=>{
    requests.push(options); const data=JSON.parse(options.body)
    return Response.json(data.operation==='prepare'?{upload:{bucket:'private',filePath:'test.pdf',token:'token',ticket:'ticket'}}:{revision:3,draft:{}})
  }
  const storage={from:bucket=>({uploadToSignedUrl:async(...args)=>{writes.push({bucket,args});return {error:null}}})}
  await uploadSignedContract('/signed',attempt,storage,request)
  assert.equal(writes.length,1); assert.equal(writes[0].args[2],file)
  assert.ok(requests.every(r=>typeof r.body==='string'&&r.body.length<1000))
  assert.deepEqual(requests.map(r=>JSON.parse(r.body).operation),['prepare','complete'])
  await uploadSignedContract('/signed',attempt,storage,request)
  assert.equal(writes.length,1)
  assert.equal(requests.length,3)
})
test('a failed completion retries the same object without uploading again or changing its version', async () => {
  let fail=true, writes=0
  const attempt={file:new File(['%PDF-'+'x'.repeat(100)],'Fiktivt.pdf',{type:'application/pdf'}),revision:8}
  const request=async(_,options)=>{
    const data=JSON.parse(options.body)
    if(data.operation==='prepare')return Response.json({upload:{bucket:'private',filePath:'one.pdf',token:'token',ticket:'ticket'}})
    assert.equal(data.revision,8)
    return fail?new Response('Requested resource unavailable',{status:503}):Response.json({revision:8})
  }
  const storage={from:()=>({uploadToSignedUrl:async()=>{writes++;return {error:null}}})}
  await assert.rejects(uploadSignedContract('/signed',attempt,storage,request),/kunde inte bekräftas/)
  fail=false
  assert.equal((await uploadSignedContract('/signed',attempt,storage,request)).revision,8)
  assert.equal(writes,1)
})
test('an uncertain storage acknowledgement checks registration and file selection accepts empty PDF MIME', async () => {
  const file=new File(['%PDF-'+'x'.repeat(100)],'Fiktivt.PDF'), attempt={file,revision:1}
  assert.equal(signedContractFileIssue(file),'')
  assert.match(signedContractFileIssue({name:'x.pdf',type:'application/pdf',size:20_000_001}),/20 MB/)
  const request=async(_,options)=>Response.json(JSON.parse(options.body).operation==='prepare'?{upload:{bucket:'private',filePath:'one.pdf',token:'token',ticket:'ticket'}}:{revision:1})
  const storage={from:()=>({uploadToSignedUrl:async()=>({error:{message:'Network error'}})})}
  assert.equal((await uploadSignedContract('/signed',attempt,storage,request)).revision,1)
})
