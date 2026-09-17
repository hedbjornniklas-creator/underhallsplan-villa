import { createRoot } from 'react-dom/client'
import Applicant from '../../src/app/renoapp/brf/[slug]/apply/page'

const brf = { id: 'test', name: 'Lokal testförening', slug: 'test' }
const counts = { config: 0, draft: 0, saves: 0, removedForm: 0 }
const report = () => { document.getElementById('fixture-result')!.textContent = JSON.stringify(counts) }
let trackedInput: Element | null = null
new MutationObserver(() => {
  if (trackedInput && !trackedInput.isConnected) { counts.removedForm++; trackedInput = null; report() }
  trackedInput ??= document.querySelector('input[type="email"]')
}).observe(document.getElementById('root')!, { childList: true, subtree: true })

window.fetch = async (input, init) => {
  const path = String(input)
  if (path.startsWith('/api/renoapp/brf/test/public')) {
    counts.config++; report()
    return Response.json({ brf, actionTypes: [{ id: 'wall', key: 'wall', label: 'Riva vägg', requirements: [], participantRoles: [], questions: [] }], questionBank: [], renovationRules: null })
  }
  if (path.startsWith('/api/renoapp/public/applications/draft/')) {
    counts.draft++; report()
    const saved = JSON.parse(sessionStorage.getItem('draft-save-body') ?? '{}')
    return Response.json({ state: 'open', brf, access: { email: saved.applicantEmail, expiresAt: '2099-01-01' },
      case: { id: 'test', caseNumber: 'RA-TEST', status: saved.mode === 'submit' ? 'submitted' : 'draft', updatedAt: new Date().toISOString() },
      form: saved, documents: [], messages: [], completionRequest: { requestedDocuments: [], requestedParticipants: [], requestedClarifications: [] } })
  }
  if (path === '/api/renoapp/public/applications' && init?.method === 'POST') {
    counts.saves++; report()
    const body = JSON.parse(String(init.body))
    await new Promise(resolve => setTimeout(resolve, 2000))
    if ((document.getElementById('fixture-fail') as HTMLInputElement).checked) return Response.json({ error: 'Simulerat sparfel' }, { status: 500 })
    sessionStorage.setItem('draft-save-body', JSON.stringify(body))
    return Response.json({ caseId: 'test', caseNumber: 'RA-TEST', status: body.mode === 'submit' ? 'submitted' : 'draft',
      resumeUrl: '/renoapp/brf/test/apply?draft=local-test-token', accessUrl: '', emailSent: true, emailError: null })
  }
  throw new Error(`Unmocked request: ${path}`)
}
createRoot(document.getElementById('root')!).render(<div className="renoapp-scope"><Applicant /></div>)
