import assert from 'node:assert/strict'
import test from 'node:test'
import { createClient } from '@supabase/supabase-js'
// @ts-expect-error Native Node tests require the .ts extension.
import { createBuildingDataClient } from '../src/lib/ob/buildingDataClient.ts'
// @ts-expect-error Native Node tests require the .ts extension.
import { buildingCoverPath, buildingDraftScope } from '../src/lib/ob/buildingStructure.ts'
import type { ObBuildingPart } from '../src/lib/ob/buildingStructure'
import type { supabase } from '../src/lib/supabaseClient'

test('legacy draft keys and covers remain; extra buildings never fall back to the main cover',()=>{
  assert.equal(buildingDraftScope('root'), 'root')
  assert.notEqual(buildingDraftScope('root','a'),buildingDraftScope('root','b'))
  const main={id:'a',cover_path:null} as ObBuildingPart
  const extra={id:'b',cover_path:null} as ObBuildingPart
  assert.equal(buildingCoverPath(main,'a','old.jpg'),'old.jpg')
  assert.equal(buildingCoverPath(extra,'a','old.jpg'),null)
  assert.equal(buildingCoverPath({...extra,cover_path:'extra.jpg'},'a','old.jpg'),'extra.jpg')
})
test('scoped client reads one building and writes through revision-checked commands, not PostgREST',async()=>{
  const row={ id:'r',inspection_id:'root',building_part_id:'part',ob_revision:1,room_type_key:'hall',room_label:'Hall' }
  const reads:URL[]=[]; const writes:Record<string,unknown>[]=[]
  const db=createClient('https://synthetic.invalid','key',{auth:{persistSession:false}, global:{ fetch:async(input,init)=>{
    assert.equal(init?.method??'GET','GET'); reads.push(new URL(String(input))); return Response.json([row])
  }}})
  let fail=true
  const scoped=createBuildingDataClient(db as typeof supabase,'root','part',async(_op,payload)=>{
    writes.push(payload)
    if(fail) throw Error('network')
    return {...row,...payload.row as object,ob_revision:2}
  })
  const result=await scoped.client.from('inspection_interior_rooms').select('*').eq('inspection_id','root')
  assert.equal(result.error,null)
  assert.equal(reads[0].searchParams.get('building_part_id'),'eq.part')
  assert.equal(reads[0].searchParams.get('inspection_id'),'eq.root')
  const save=()=>scoped.client.from('inspection_interior_rooms').update({room_label:'Studio'}).eq('id','r').select('*').single()
  assert.ok((await save()).error)
  fail=false
  assert.equal((await save()).error,null)
  assert.deepEqual(writes[0],writes[1],'retry must reuse exact request id and revision')
  assert.equal(writes[0].revision,1)
  assert.equal(writes[0].partId,'part')
  assert.ok((await scoped.client.from('inspection_interior_rooms').update({room_label:'Wrong'}).eq('id','unknown')).error)
  assert.equal(writes.length,2)
})
test('new notes returned by atomic image-note commands can immediately be edited',async()=>{
  const db=createClient('https://synthetic.invalid','key',{auth:{persistSession:false},global:{fetch:async()=>{throw Error('No direct write')}}})
  let payload:Record<string,unknown>|null=null
  const row={id:'note',inspection_id:'root',building_part_id:'part',ob_revision:1,control_point_id:null,note:'Text'}
  const scoped=createBuildingDataClient(db as typeof supabase,'root','part',async(_op,p)=>{payload=p;return {...row,ob_revision:2}})
  scoped.remember({note:row,image:null})
  const result=await scoped.client.from('inspection_control_items').update({note:'New text'}).eq('id','note').select('*').single()
  assert.equal(result.error,null)
  assert.equal((payload as Record<string,unknown>|null)?.revision,1)
})
