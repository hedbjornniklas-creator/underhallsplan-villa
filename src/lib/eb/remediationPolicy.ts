export type RemediationRole = 'internal' | 'customer_owner' | 'contractor_admin' | 'contractor_viewer' | 'assignee'

export function ebRemediationAllowedStatuses(role: RemediationRole, paid: boolean): string[] {
  if (paid) {
    if (role === 'customer_owner') return ['returned']
    if (role === 'assignee' || role === 'contractor_admin') {
      return ['in_progress', 'reported_remedied', 'cannot_remedy']
    }
    return []
  }
  if (role === 'assignee') return ['in_progress', 'ready_for_review', 'cannot_remedy']
  if (role === 'contractor_admin') {
    return ['assigned', 'in_progress', 'ready_for_review', 'returned', 'reported_remedied', 'cannot_remedy']
  }
  return []
}

export function ebRemediationCanManage(role: RemediationRole, paid: boolean) {
  return role === 'internal' || (paid ? role === 'customer_owner' : role === 'contractor_admin')
}

export function ebRemediationCanComment(role: RemediationRole) {
  return role !== 'contractor_viewer'
}
