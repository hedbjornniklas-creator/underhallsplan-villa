'use client'
import ActionCaseProjectList from '@/components/tasks/ActionCaseProjectList'
import { actionCase } from '@fixture/customer-offer-data'
import { projectFixture } from '@fixture/project-workspace-data'
export default function List() {
  const workspace = projectFixture(actionCase)
  return <><h1>Projekt</h1><ActionCaseProjectList cases={[...workspace.cases, { ...actionCase, id: '00000000-0000-4000-8000-000000000401', title: 'TEST: tillfälligt läsfel' }]} onCreate={() => {}} /></>
}
