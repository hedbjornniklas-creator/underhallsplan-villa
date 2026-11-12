import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import ProjectOverview from '@/components/tasks/ProjectOverview'
import UppdragScope from '@/components/tasks/UppdragScope'
import type { ActionCaseView } from '@/lib/action-cases/contracts'
import { emptyCustomerOffer, type CustomerOfferWorkspace } from '@/lib/action-cases/customerOffers'

const project = { id: '00000000-0000-4000-8000-000000000001', title: 'Fiktivt navigeringstest', status: 'pricing', items: [], attachments: [] } as unknown as ActionCaseView
const offer = { draft: emptyCustomerOffer(), revision: 0, offers: [] } as CustomerOfferWorkspace
const counts = { questions: 0, schedule: 0 }
let failNext = false
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
window.fetch = async (input, options) => {
  const url = new URL(String(input), location.origin)
  if (url.origin !== location.origin || !url.pathname.startsWith('/api/action-cases/') || options?.method) throw Error('Only fictional local GET requests allowed')
  const endpoint = url.pathname.split('/').at(-1)
  if (endpoint === 'questions' || endpoint === 'schedule') {
    counts[endpoint]++
    await new Promise(resolve => setTimeout(resolve, 1200))
    if (options?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    if (failNext) { failNext = false; return json({ error: 'Fiktivt hämtningsfel' }, 503) }
  }
  if (endpoint === 'questions') return json({ userId: 'me', managerId: null, assignees: [], questions: [] })
  if (endpoint === 'schedule') return json({ available: true, rows: [] })
  if (endpoint === 'manager') return json({ managerId: null, managerName: '', canEdit: false, people: [] })
  if (endpoint === 'administration') return json({ revision: 1, status: 'pricing', canManage: false, workComplete: false, invoiced: false, openQuestions: 0, events: [] })
  throw Error('Unexpected fixture endpoint')
}
function View() {
  const [active, setActive] = useState(true), [refreshKey, setRefreshKey] = useState(0), [, inspect] = useState(0)
  return <UppdragScope><main style={{ maxWidth: 1200, padding: 24, margin: 'auto' }}>
    <h1>TEST · Navigering i Gizmo</h1>
    <nav className="my-4 flex gap-2"><button className="gizmo-button" onClick={() => setActive(true)}>Översikt</button><button className="gizmo-button" onClick={() => setActive(false)}>Annan flik</button></nav>
    <details><summary>Fiktiva testverktyg</summary><button className="gizmo-button" onClick={() => inspect(n => n + 1)}>Läs antal hämtningar</button><button className="gizmo-button" onClick={() => { failNext = true; setRefreshKey(n => n + 1) }}>Testa hämtningsfel</button><button className="gizmo-button" onClick={() => setRefreshKey(n => n + 1)}>Ändra refreshnyckel</button><output>Frågor: {counts.questions} · Tidsplan: {counts.schedule}</output></details>
    {!active && <p>Annan flik · översikten finns kvar monterad.</p>}
    <ProjectOverview project={project} offer={offer} active={active} refreshKey={refreshKey} questionsDirty={false} sharingDirty={false} completionBlocked={false} onManagerChanged={() => setRefreshKey(n => n + 1)} onNavigate={() => {}} onQuestion={() => {}} onStatus={() => {}} onCompletionDirty={() => {}} />
  </main></UppdragScope>
}
createRoot(document.getElementById('root')!).render(<View />)
