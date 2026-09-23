import React from 'react'
import { createRoot } from 'react-dom/client'
import UppdragScope from '@/components/tasks/UppdragScope'
import TaskDashboardClient from '@/components/tasks/TaskDashboardClient'
import TaskRecipientClient from '@/components/tasks/TaskRecipientClient'
import RecipientPortalOverviewClient from '@/components/tasks/RecipientPortalOverviewClient'
import RecipientTaskAccessDenied from '@/components/tasks/RecipientTaskAccessDenied'
import Login from '@/app/mina-uppdrag/logga-in/page'
import Activation from '@/app/mina-uppdrag/aktivera/[token]/page'
import Rfq from '@/app/offertunderlag/[token]/page'
import CasePortal from '@/app/atgardsarende/[token]/page'
import { AppToastProvider } from '@/components/ui/AppToastProvider'
import RequestApp from './action-case-requests'
import { workspace, external, overview, cases } from './uppdrag-brand-data'

async function render() {
  const path = location.pathname
  const params = new URLSearchParams(location.search)
  const isExternal = path.startsWith('/offertunderlag/') || path.startsWith('/atgardsarende/')
  let page: React.ReactNode
  if (path === '/uppdrag') page = <TaskDashboardClient initialWorkspace={workspace} initialError={null} initialActionCases={cases} initialActionCasesError={null} />
  else if (path.endsWith('/logga-in')) page = <Login />
  else if (path.includes('/aktivera/')) page = <Activation />
  else if (path === '/mina-uppdrag') page = <RecipientPortalOverviewClient initialOverview={overview} />
  else if (path.startsWith('/offertunderlag/')) page = await Rfq({ params: Promise.resolve({ token: 'brand-test' }) })
  else if (path.startsWith('/atgardsarende/')) page = await CasePortal({ params: Promise.resolve({ token: 'brand-test' }) })
  else if (path === '/requests') page = <RequestApp />
  else if (params.has('denied')) page = <RecipientTaskAccessDenied taskId="brand-task" signedInEmail="test@example.test" />
  else page = <TaskRecipientClient initialWorkspace={{ ...external, accessState: params.has('expired') ? 'expired' : 'open' }} endpoint="/api/signe/brand-test" showRecipientAccountAction={path.startsWith('/signe/')} backHref={path.startsWith('/mina-uppdrag/') ? '/mina-uppdrag' : undefined} />
  createRoot(document.getElementById('root')!).render(<AppToastProvider>
    {path === '/legacy' ? <button className="bg-violet-700 text-white">Oförändrad modul</button> : <UppdragScope external={isExternal}>{page}</UppdragScope>}
  </AppToastProvider>)
}
void render()
