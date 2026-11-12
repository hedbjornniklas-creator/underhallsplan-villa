import { createRoot } from 'react-dom/client'
import QuestionDialogue from '../../src/components/tasks/QuestionDialogue'
import UppdragBrand from '../../src/components/tasks/UppdragBrand'
import type { QuestionDialogue as Dialogue } from '../../src/lib/action-cases/questionDialogue'

const data: Dialogue = {
  questionId:'fictional-question', version:1, sharedAt:'2026-11-12T08:00:00Z',
  snapshot:{ title:'Vilken kulör ska dörrarna ha?', description:'Vi behöver välja kulör till innerdörrarna innan beställning. Föredrar ni samma vita kulör som väggarna eller en kontrastkulör? Endast fiktiva testuppgifter.' },
  status:'open', canManage:false, viewerId:'bo', participants:[
    { id:'anna', kind:'profile', personId:'anna', name:'Anna Exempel', email:'anna@example.invalid', shared:true },
    { id:'bo', kind:'contact', personId:'bo', name:'Bo Exempel', email:'bo@example.invalid', shared:true },
  ], deliveries:[], messages:Array.from({length:5}, (_,i) => ({
    id:`message-${i}`, participantId:i % 2 ? 'bo' : 'anna', actorMethod:'personal_link', snapshot:null, actorName:i % 2 ? 'Bo Exempel' : 'Anna Exempel', operation:'reply',
    text:['Ska vi jämföra de två kulörerna?', 'Ja, gärna med ett färgprov.', 'Färgproven finns på plats.', 'Vi tittar på dem tillsammans i morgon.', 'Det går bra. Återkom med ert val efter besöket.'][i],
    createdAt:`2026-11-11T${String(8+i).padStart(2,'0')}:00:00Z`, files:[],
  })),
}
window.fetch = async (input, init) => {
  if (String(input) !== '/fixture-question') return Response.json({error:'Externa anrop är blockerade.'},{status:400})
  if (init?.method) {
    const body=JSON.parse(String(init.body))
    if (!data.messages.some(m=>m.id===body.requestId)) { data.messages.push({id:body.requestId,participantId:'bo',actorMethod:'personal_link',snapshot:null,actorName:'Bo Exempel',operation:'reply',text:body.text,createdAt:new Date().toISOString(),files:[]}); data.version++ }
    return Response.json({questionId:data.questionId,messageId:body.requestId})
  }
  return Response.json(structuredClone(data))
}
createRoot(document.getElementById('root')!).render(<main className="uppdrag-scope gizmo-question-public"><header><UppdragBrand /><p>Frågor och beslut</p></header><QuestionDialogue initial={data} endpoint="/fixture-question" fileBase="/fixture-files" publicView /></main>)
