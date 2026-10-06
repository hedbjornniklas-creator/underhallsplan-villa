import ActionCaseProject from '@/components/tasks/ActionCaseProject'
import UppdragScope from '@/components/tasks/UppdragScope'
import { actionCase, workspace } from '@fixture/customer-offer-data'
import { projectFixture } from '@fixture/project-workspace-data'
export const dynamic = 'force-dynamic'
let failedOnce = false
export default async function Page({ params, searchParams }) {
  const { caseId } = await params
  await new Promise(resolve => setTimeout(resolve, 6000))
  if (caseId.endsWith('401') && !failedOnce) { failedOnce = true; throw Error('Synthetic temporary read failure') }
  const projects = projectFixture(actionCase)
  projects.cases.push({ ...actionCase, id: '00000000-0000-4000-8000-000000000401', title: 'TEST: tillfälligt läsfel' })
  projects.cases.forEach(item => { item.attachments = [] })
  return <UppdragScope><div className="gizmo-workspace"><ActionCaseProject caseId={caseId} initialWorkspace={projects}
    initialOffer={workspace} initialView={(await searchParams).view ?? 'overview'} issuerName="Testföretag" replyEmail="test@example.test" /></div></UppdragScope>
}
