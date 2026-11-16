import type { ActionCaseStatus } from './contracts'

export type ProjectSwitchOption = { id: string; title: string; status: ActionCaseStatus }

export function projectSwitchGroups(options: ProjectSwitchOption[], current: ProjectSwitchOption) {
  const projects = [...new Map([...options, current].map(project => [project.id, project])).values()]
    .sort((a, b) => a.title.localeCompare(b.title, 'sv', { numeric: true }) || a.id.localeCompare(b.id))
  const closed = (project: ProjectSwitchOption) => ['completed', 'cancelled'].includes(project.status)
  return [
    { label: 'Aktiva projekt', projects: projects.filter(project => !closed(project)) },
    { label: 'Slutförda och avbrutna', projects: projects.filter(closed) },
  ].filter(group => group.projects.length)
}
