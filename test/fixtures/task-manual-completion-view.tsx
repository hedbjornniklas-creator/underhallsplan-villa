import React, { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import TaskDetailSheet from '../../src/components/tasks/TaskDetailSheet'
import UppdragScope from '../../src/components/tasks/UppdragScope'
import { manualCompletionGaps, COMPLETION_EVIDENCE_LABELS } from '../../src/lib/tasks/manualCompletion'
import type { TaskView, TaskWorkspace } from '../../src/lib/tasks/contracts'

const initial: TaskView = {
  id: '00000000-0000-4000-8000-000000000001', parentTaskId: null, rootTaskId: '00000000-0000-4000-8000-000000000001', depth: 0,
  title: 'Fiktivt provuppdrag – ventilationskontroll', description: 'Endast fiktiva uppgifter. Inga meddelanden skickas.', contextLabel: 'Testprojekt', taskKind: 'warranty',
  status: 'assigned', risk: 'green', ballHolder: 'issuer', dueAt: '2026-11-03T15:00:00Z', dueTimeZone: 'Europe/Stockholm', nextFollowupAt: '2026-11-02T09:00:00Z',
  recurrenceInterval: null, recurrenceSequence: null, primaryChannel: 'email', fallbackChannel: null, evidenceRequirement: 'any', evidenceRequirements: ['photo', 'document', 'text'], initialDispatchPending: false,
  issuerId: 'issuer', issuerName: 'Anna Exempel', canDelete: false, canCompleteManually: true, completionMethod: null,
  assignee: { id: 'recipient', kind: 'contact', name: 'Bo Exempel', companyName: null, email: 'bo@example.test', phone: null, whatsappNumber: null, isActive: true },
  reviewRound: 0, version: 7, childCount: 0, openChildCount: 0,
  requirements: [{ id: '00000000-0000-4000-8000-000000000002', key: 'warranty_basis', label: 'Garantiunderlag är dokumenterat', status: 'pending', required: true, verifiedAt: null, verifiedByName: null }],
  events: [], deadlineRequests: [{ id: 'extension', requestedDueAt: '2026-11-04T15:00:00Z', reason: 'Fiktiv förlängning', status: 'pending', decidedAt: null, decisionNote: null, createdAt: '2026-10-30T09:00:00Z' }],
  attachments: [{ id: 'text', type: 'text', title: 'Fiktiv redovisning', fileName: null, contentType: null, textContent: 'Kontrollerat per telefon.', transcriptText: null, canEditTranscript: false, isCompletionEvidence: true, createdAt: '2026-10-30T09:00:00Z' }],
  aiSuggestions: [], unreadMessageCount: 0, latestMessage: null, latestIncomingMessageEventId: null, notificationDeliveries: [], notificationDeliveryProblemCount: 0,
  createdAt: '2026-10-30T09:00:00Z', updatedAt: '2026-10-30T09:00:00Z',
}

function Fixture() {
  const [task, setTask] = useState(initial), [open, setOpen] = useState(true), [mode, setMode] = useState('normal'), [userId, setUserId] = useState('issuer'), [calls, setCalls] = useState(0)
  const failed = useRef(false), committed = useRef(false)
  async function action(name: string, payload: Record<string, unknown>) {
    if (name !== 'complete_manually') return
    setCalls(count => count + 1)
    if (mode === 'error' && !failed.current) { failed.current = true; throw Error('Fiktivt sparfel. Kommentaren är kvar; försök igen.') }
    if (mode === 'stale' && task.version === 7) throw Error('Uppgiften har ändrats. Uppdatera underlaget och bekräfta igen.')
    if (mode === 'newgaps' && task.requirements.length === 1) throw Error('Kvarstående krav har ändrats. Uppdatera underlaget och bekräfta igen.')
    if (mode === 'lost' && !committed.current) { committed.current = true; throw Error('Sparsvaret förlorades. Försök igen med samma kommentar.') }
    const gaps = manualCompletionGaps(task)
    setTask(previous => ({ ...previous, status: 'approved', canCompleteManually: false, completionMethod: 'manual', version: previous.version + 1,
      deadlineRequests: previous.deadlineRequests.map(request => ({ ...request, status: 'cancelled' })),
      events: [{ id: 'manual-event', type: 'status_changed', actorName: 'Anna Exempel', message: `Klarmarkerad manuellt av uppdragsansvarig.\n${payload.comment}\nKvarstående kontrollpunkter: ${gaps.requirements.map(item => item.label).join(', ')}.\nSaknade färdigbevis: ${gaps.evidenceTypes.map(type => COMPLETION_EVIDENCE_LABELS[type]).join(', ')}.`, fromStatus: previous.status, toStatus: 'approved', createdAt: new Date().toISOString(), authorSide: 'self' }] }))
  }
  const workspace = { timeZone: 'Europe/Stockholm', currentUser: { id: userId, name: userId === 'issuer' ? 'Anna Exempel' : 'Bo Exempel', isOrgAdmin: userId === 'issuer' }, tasks: [task], people: [], limits: { maxDepth: 2, maxOpenChildren: 5 } } as unknown as TaskWorkspace
  return <UppdragScope><main className="min-h-screen bg-slate-50 p-5 text-slate-950">
    <h1 className="text-xl font-semibold">Fiktivt test: manuell klarmarkering</h1>
    <p>Inga riktiga uppgifter, avtal eller mejl används.</p>
    <div className="mt-4 flex flex-wrap gap-3">
      <label>Testläge <select aria-label="Testläge" value={mode} onChange={event => { const value = event.target.value; setMode(value); failed.current = false; committed.current = false; setTask({ ...initial, openChildCount: value === 'children' ? 1 : 0 }) }}>
        <option value="normal">Normalt</option><option value="error">Sparfel en gång</option><option value="stale">Nyare underlag</option><option value="newgaps">Nya krav utan versionsbyte</option><option value="lost">Tappat sparsvar</option><option value="children">Öppna underuppgifter</option>
      </select></label>
      <button onClick={() => setUserId(userId === 'issuer' ? 'recipient' : 'issuer')}>Byt användare</button>
      <button onClick={() => setOpen(true)}>Öppna uppgift</button>
      <output aria-label="Antal sparförsök">{calls} sparförsök</output>
    </div>
    {open ? <TaskDetailSheet task={task} workspace={workspace} busy={false} onClose={() => setOpen(false)} onAction={action}
      onReload={async () => setTask(previous => ({ ...previous, version: previous.version + (mode === 'newgaps' ? 0 : 1), requirements: [...previous.requirements, { ...initial.requirements[0], id: '00000000-0000-4000-8000-000000000003', label: 'Ny kontrollpunkt' }] }))}
      onUpload={async () => {}} onUpdateTranscript={async () => {}} onCreateSubtask={() => {}} onSelectTask={() => {}} /> : null}
  </main></UppdragScope>
}

createRoot(document.getElementById('root')!).render(<Fixture />)
