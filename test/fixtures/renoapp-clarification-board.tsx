import { createRoot } from 'react-dom/client'
import Board from '../../src/app/renoapp/app/cases/[id]/page'
import { item } from './renoapp-case-item'
import type { RenoAppCaseDetail } from '../../src/app/renoapp/app/cases/[id]/RenoAppCaseDecisionView'
import { clarificationItems } from '../../src/lib/renoapp/clarifications'

const current: RenoAppCaseDetail = { ...item, id:'case', status:'review', completion:null, clarifications:[{
  question_id:'11111111-1111-4111-8111-111111111111', question_key:'municipal',
  label:'Har du fått besked från kommunen om den planerade åtgärden kräver anmälan?',
  original_answer:'Jag behöver undersöka detta', answer_label:'Ja, kommunen har meddelat att anmälan krävs.',
  answer_note:'Jag har varit i kontakt med kommunen. Beskedet gäller den planerade ändringen.',
  state:'answered', requested:false, revision:0, review_note:null,
}] }
window.fetch = async (input, init) => {
  const url = String(input)
  if (url.endsWith('/consultant-review')) return Response.json({order:null})
  if (url.endsWith('/clarifications')) {
    const body = JSON.parse(String(init?.body))
    await new Promise(resolve => setTimeout(resolve,180))
    if (sessionStorage.getItem('clarification-fail')) return Response.json({error:'Tillfälligt sparfel.'},{status:500})
    const row = current.clarifications![0]
    if (row.revision !== body.revision) return Response.json({error:'Fel revision.'},{status:409})
    sessionStorage.setItem('board-last-clarification',JSON.stringify(body))
    if (body.action === 'request') row.requested = true
    if (body.action === 'not_requested') row.requested = false
    if (body.action === 'resolve' || body.action === 'not_relevant') {
      row.state = body.action === 'resolve' ? 'resolved' : 'not_relevant'
      row.review_note = body.note
      row.requested = false
    }
    row.revision++
    return Response.json({item:current})
  }
  if (url.endsWith('/case')) {
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body))
      sessionStorage.setItem('board-last-status',JSON.stringify(body))
      current.status=body.status
      if (body.status === 'need_info') current.completion = {id:body.completionRequestId,items:clarificationItems(current.clarifications!),message:'Begäran',created_at:'2026-09-16',submitted_at:null,delivery_status:'sent',delivery_error:null}
    }
    return Response.json({item:current})
  }
  throw new Error(`Unmocked request: ${url}`)
}
createRoot(document.getElementById('root')!).render(<div className="renoapp-scope"><main className="reno-portal-main"><Board /></main></div>)
