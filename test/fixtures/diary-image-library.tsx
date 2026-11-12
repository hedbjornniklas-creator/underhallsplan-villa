import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import ProjectQuestions from '@/components/tasks/ProjectQuestions'
import ActionCaseImageBank from '@/components/tasks/ActionCaseImageBank'
import UppdragScope from '@/components/tasks/UppdragScope'
import type { ActionCaseView } from '@/lib/action-cases/contracts'
import { emptyQuestion, type ProjectQuestion, type QuestionWorkspace } from '@/lib/action-cases/projectQuestions'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const caseId = id(3), manager = { id: id(2), kind: 'profile' as const, name: 'Testledare', email: 'manager@example.invalid' }
const createdAt = '2026-11-11T16:00:00Z', body = { ...emptyQuestion(), title: 'TEST – Bilder från dagboken', description: 'Fiktiv fråga om genomförandet. Inget riktigt projekt eller utskick.', assignee: manager }
const question: ProjectQuestion = { id: id(4), number: 1, body, revision: 1, createdAt, updatedAt: createdAt, events: [], participants: [], tasks: [], dialogueHistory: [] }
const key = 'diary-images-fixture-v1'
const initial: QuestionWorkspace = { questions: [question], assignees: [manager], userId: manager.id, managerId: manager.id, canManageParticipants: true, privateFiles: [] }
const state: QuestionWorkspace = JSON.parse(localStorage.getItem(key) || 'null') || initial
const photos = Array.from({ length: 5 }, (_, n) => ({ id: id(100 + n), entryId: id(50), name: `Arbetsplats-${n + 1}.jpg`, contentType: 'image/jpeg', size: 100, workDate: '2026-11-11', personName: n % 2 ? 'Erik Test' : 'Anna Exempel', company: 'Exempelbygg AB', itemId: id(8), itemTitle: 'Invändiga arbeten', receivedAt: createdAt }))
const projectFile = { id: id(20), type: 'image' as const, fileName: 'Projektbild.jpg', title: 'Projektbild', contentType: 'image/jpeg', fileSizeBytes: 100, createdAt, actionCaseItemId: null, grantedParticipantIds: [] }
let failNext = false, loseNext = false, sends = 0, messages: Array<Record<string, unknown>> = []
const persist = () => localStorage.setItem(key, JSON.stringify(state))
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
window.fetch = async (input, options) => {
  const url = new URL(String(input), location.origin)
  if (url.origin !== location.origin || !url.pathname.startsWith('/api/action-cases/')) throw Error('Only fictional local requests allowed')
  await new Promise(resolve => setTimeout(resolve, 250))
  if (options?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  if (!options?.method && url.pathname.endsWith('/diary/photos')) {
    if (failNext) { failNext = false; return json({ error: 'Fiktivt hämtningsfel. Bilderna behålls.' }, 503) }
    return json({ images: url.searchParams.has('cursor') ? photos.slice(3) : photos.slice(0, 3), nextCursor: url.searchParams.has('cursor') ? null : 'page-2' })
  }
  if (url.pathname.endsWith('/diary-photos')) {
    const request = JSON.parse(String(options?.body)), n = photos.findIndex(p => p.id === request.photoId)
    if (n < 0) return json({ error: 'Saknas' }, 404)
    const file = { ...projectFile, id: id(500 + n), title: `Dagbok · ${photos[n].personName}`, fileName: photos[n].name, questionId: id(4) }
    state.privateFiles = [...new Map([...(state.privateFiles || []), file].map(f => [f.id, f])).values()]; persist()
    if (loseNext) { loseNext = false; return json({ error: 'Fiktivt osäkert svar. Försök igen.' }, 503) }
    return json({ file })
  }
  if (url.pathname.endsWith('/dialogue')) {
    if (options?.method) {
      const d = JSON.parse(String(options.body)); sends++
      messages.push({ id: d.requestId, actorName: manager.name, operation: d.operation, text: d.text, files: d.fileIds.map((fid: string) => ({ id: fid, name: state.privateFiles?.find(f => f.id === fid)?.fileName })), createdAt: new Date().toISOString() })
      return json({ questionId: id(4), messageId: d.requestId })
    }
    return json({ questionId: id(4), version: 1, sharedAt: createdAt, snapshot: null, status: 'open', managerId: manager.id, canManage: true, viewerId: id(90), participants: [{ id: id(90), personId: manager.id, kind: manager.kind, name: manager.name, email: manager.email, shared: true }], messages, deliveries: [] })
  }
  if (!options?.method) return json(state)
  const d = JSON.parse(String(options.body)), q = state.questions[0]
  if (d.operation === 'send') sends++
  if (d.body) q.body = d.body
  q.revision++; q.updatedAt = new Date().toISOString()
  q.events.push({ id: d.requestId, operation: d.operation, actorName: manager.name, createdAt: q.updatedAt, body: q.body, text: d.text || '', reportedBy: '', files: d.fileIds.map((fid: string) => ({ id: fid, name: state.privateFiles?.find(f => f.id === fid)?.fileName || fid })), revision: q.revision, taskId: null })
  persist(); return json({ questionId: q.id })
}
function View() {
  const [view, setView] = useState('files'), [, render] = useState(0)
  return <UppdragScope><main style={{ maxWidth: 1050, padding: 20, margin: 'auto' }}><h1 className="text-xl font-semibold">TEST · Dagboksbilder och frågor</h1><p className="my-3 text-sm">Fiktivt projekt – ingen databas eller e-post</p><nav className="mb-5 flex gap-2"><button className="gizmo-button" onClick={() => setView('files')}>Bilder och filer</button><button className="gizmo-button" onClick={() => setView('questions')}>Frågor och beslut</button></nav><details className="mb-4"><summary>Fiktiva testverktyg</summary><button className="gizmo-button" onClick={() => { failNext = true }}>Nästa hämtning misslyckas</button><button className="gizmo-button" onClick={() => { loseNext = true }}>Tappa nästa kopieringssvar</button><button className="gizmo-button" onClick={() => render(n => n + 1)}>Läs testresultat</button><p>Privata bilagor: {state.privateFiles?.length} · Utskick: {sends}</p></details>{view === 'files' ? <ActionCaseImageBank actionCase={{ id: caseId, attachments: [projectFile], participants: [] } as unknown as ActionCaseView} busy={false} onAccess={() => {}} onDelete={() => {}} /> : <ProjectQuestions caseId={caseId} active files={[projectFile]} onFiles={() => {}} onDirty={() => {}} />}</main></UppdragScope>
}
createRoot(document.getElementById('root')!).render(<View />)
