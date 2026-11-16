import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowLeft, MapPin } from 'lucide-react'
import ProjectSwitcher from '@/components/tasks/ProjectSwitcher'
import UppdragScope from '@/components/tasks/UppdragScope'
import { ProjectSaveProtectionProvider, useProjectSaveProtection } from '@/components/tasks/ProjectSaveProtection'
import type { ProjectSwitchOption } from '@/lib/action-cases/projectSwitcher'

const projects: ProjectSwitchOption[]=[{id:'one',title:'TEST - Exempelvägen 12',status:'in_progress'},{id:'two',title:'TEST - Sjögläntan, invändig renovering och tillbyggnad med ett långt projektnamn',status:'pricing'},{id:'three',title:'TEST - Ett avslutat projekt',status:'completed'}]
function View(){
  const [current,setCurrent]=useState(projects[0]),[text,setText]=useState(''),[saved,setSaved]=useState(''),[auto,setAuto]=useState(false),[url,setUrl]=useState('')
  useProjectSaveProtection({label:'Intern anteckning',pending:text!==saved,detail:'Anteckningen har inte sparats.',view:'overview',flush:async()=>{if(!auto)return false;setSaved(text);return true}})
  const change=(value:string)=>{setUrl(value);const next=projects.find(project=>value.endsWith('/'+project.id));if(next)setCurrent(next);setText('');setSaved('')}
  return <div className="gizmo-workspace"><main className="gizmo-project-page"><header className="gizmo-project-header"><div className="gizmo-project-navigation"><a className="gizmo-back" href="#project-list"><ArrowLeft size={17}/>Alla projekt</a><ProjectSwitcher key={current.id} current={current} projects={projects} error={location.search.includes('error')?'Projektlistan kunde inte hämtas.':null} onNavigate={change}/></div><div className="gizmo-project-title"><div><p className="gizmo-eyebrow">Gizmo · Projekt</p><h1>{current.title}</h1><p className="gizmo-address"><MapPin size={16}/>Exempelvägen 12, Stockholm</p></div></div></header><section className="py-6"><h2 className="text-xl font-semibold">Översikt</h2><p className="mt-3">Nästa steg</p><p className="mt-1 text-sm text-[#596368]">Boka platsbesök</p></section><section className="border-t py-6"><label className="block">Fiktiv anteckning<textarea aria-label="Fiktiv anteckning" value={text} onChange={event=>setText(event.target.value)} className="mt-2 block w-full max-w-lg rounded border p-3"/></label><label className="mt-3 flex gap-2"><input type="checkbox" checked={auto} onChange={event=>setAuto(event.target.checked)}/>Autospara testfältet</label><output id="navigation-result" className="mt-3 block text-sm">{url}</output></section></main></div>
}
createRoot(document.getElementById('root')!).render(<UppdragScope><ProjectSaveProtectionProvider onLocate={()=>{}}><View/></ProjectSaveProtectionProvider></UppdragScope>)
