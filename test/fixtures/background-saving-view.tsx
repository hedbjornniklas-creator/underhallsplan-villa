import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AppToastProvider } from '@/components/ui/AppToastProvider'
import UppdragScope from '@/components/tasks/UppdragScope'
import ActionCaseWorkspace from '@/components/tasks/ActionCaseWorkspace'
import ProjectScheduleEditor from '@/components/tasks/ProjectScheduleEditor'
import type { ActionCaseWorkspace as Workspace } from '@/lib/action-cases/contracts'

function Preview({ workspace }: { workspace: Workspace }) {
  const [view, setView] = useState(() => new URLSearchParams(window.location.search).get('view') === 'schedule' ? 'schedule' : 'work'), [refresh, setRefresh] = useState(0)
  const project = workspace.cases[0]
  return <AppToastProvider><UppdragScope external><div className="gizmo-workspace">
    <header className="flex flex-wrap items-center gap-3 border-b p-4 text-sm">
      <strong>Fiktivt testprojekt</strong>
      <button onClick={() => setView('work')}>Projektarbete</button><button onClick={() => setView('schedule')}>Tidsplan</button>
      <button onClick={() => void fetch('/__test__/slow', { method: 'POST' })}>Nästa sparning: 8 sekunder</button>
      <button onClick={() => void fetch('/__test__/fail', { method: 'POST' })}>Nästa sparning: fel</button>
      <button onClick={() => setRefresh(value => value + 1)}>Simulera avtalsuppdatering</button>
    </header>
    <div hidden={view !== 'work'} className="p-4"><ActionCaseWorkspace initialWorkspace={workspace} initialError={null} caseId={project.id} section="work" customerRefresh={refresh} /></div>
    <div hidden={view !== 'schedule'} className="mx-auto max-w-5xl p-4"><ProjectScheduleEditor caseId={project.id} items={project.items} onDirty={() => {}} onShared={() => {}} customerRefresh={refresh} /></div>
  </div></UppdragScope></AppToastProvider>
}
void fetch('/fixture').then(response => response.json()).then(workspace => createRoot(document.getElementById('root')!).render(<Preview workspace={workspace} />))
