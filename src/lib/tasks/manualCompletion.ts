import type { TaskCompletionEvidenceType, TaskView } from './contracts'

export const MANUAL_COMPLETION_STATUSES = ['assigned', 'in_progress', 'waiting', 'returned', 'ready_for_review'] as const
export const MANUAL_COMPLETION_COMMENT_LIMIT = 4000
export const COMPLETION_EVIDENCE_LABELS: Record<TaskCompletionEvidenceType | 'any', string> = {
  photo: 'Foto', document: 'Dokument', text: 'Textredovisning', any: 'Färdigbevis',
}

export function completionEvidenceSatisfied(type: TaskCompletionEvidenceType, task: Pick<TaskView, 'attachments'>) {
  return task.attachments.some(attachment => attachment.isCompletionEvidence && (
    attachment.type === type || (type === 'text' && attachment.type === 'audio' && Boolean(attachment.transcriptText?.trim()))
  ))
}

export function manualCompletionGaps(task: Pick<TaskView, 'requirements' | 'attachments' | 'evidenceRequirements' | 'evidenceRequirement'>) {
  const requirements = task.requirements.filter(item => item.required && !['verified', 'not_required', 'waived'].includes(item.status))
  const types = task.evidenceRequirements.length ? task.evidenceRequirements
    : ['photo', 'document', 'text'].includes(task.evidenceRequirement) ? [task.evidenceRequirement as TaskCompletionEvidenceType] : []
  const evidenceTypes: Array<TaskCompletionEvidenceType | 'any'> = types.filter(type => !completionEvidenceSatisfied(type, task))
  if (!types.length && task.evidenceRequirement === 'any' && !task.attachments.some(item => item.isCompletionEvidence)) evidenceTypes.push('any')
  return {
    requirements,
    evidenceTypes,
    acknowledgement: {
      requirementIds: requirements.map(item => item.id).sort(),
      evidenceTypes: [...evidenceTypes].sort(),
    },
    hasGaps: requirements.length > 0 || evidenceTypes.length > 0,
  }
}

export function canManuallyCompleteTask(task: TaskView, userId: string) {
  return task.canCompleteManually === true && task.issuerId === userId
    && (MANUAL_COMPLETION_STATUSES as readonly string[]).includes(task.status)
}
