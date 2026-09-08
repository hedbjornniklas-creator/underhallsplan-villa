export type FlowNodeTone = 'stone' | 'sky' | 'emerald' | 'amber' | 'rose' | 'violet'

export type FlowNodeRef =
  | { type: 'actionType'; actionTypeId: string }
  | { type: 'rootQuestion'; actionTypeId: string; questionId: string }
  | { type: 'rootRequirement'; actionTypeId: string; documentTypeId: string }
  | { type: 'rootParticipant'; actionTypeId: string; participantRoleId: string }
  | { type: 'question'; questionId: string }
  | { type: 'option'; questionId: string; optionId: string }
  | { type: 'optionQuestionTrigger'; questionId: string; optionId: string; targetQuestionId: string }
  | { type: 'optionDocumentTrigger'; questionId: string; optionId: string; targetDocumentTypeId: string }
  | { type: 'optionParticipantTrigger'; questionId: string; optionId: string; targetParticipantRoleId: string }
  | { type: 'optionReviewFlagTrigger'; questionId: string; optionId: string; targetReviewFlagId: string }
  | { type: 'actionTypeReviewFlag'; actionTypeId: string; targetReviewFlagId: string }
  | { type: 'documentReviewFlag'; documentTypeId: string; targetReviewFlagId: string }
  | { type: 'participantReviewFlag'; participantRoleId: string; targetReviewFlagId: string }
  | { type: 'status' }

export type FlowTarget = { kind: 'action' | 'option' | 'document' | 'participant'; id: string }
export type FlowSource = {
  kind: 'action_question' | 'action_document' | 'action_participant' | 'option_trigger' | 'flag_link'
  id: string
  parentId: string
}
export type FlowMove = { source: FlowSource; target: FlowTarget }
export type FlowMovePreview = {
  version: string
  itemLabel: string
  fromLabel: string
  toLabel: string
  shared: boolean
}

export type FlowNode = {
  id: string
  kind: 'root' | 'question' | 'option' | 'document' | 'participant' | 'flag' | 'status'
  title: string
  badges: string[]
  tone: FlowNodeTone
  children: FlowNode[]
  ref: FlowNodeRef
  source?: FlowSource
}

export function flowTarget(node: FlowNode): FlowTarget | null {
  const ref = node.ref
  if (ref.type === 'actionType') return { kind: 'action', id: ref.actionTypeId }
  if (ref.type === 'option') return { kind: 'option', id: ref.optionId }
  if (ref.type === 'rootRequirement') return { kind: 'document', id: ref.documentTypeId }
  if (ref.type === 'optionDocumentTrigger') return { kind: 'document', id: ref.targetDocumentTypeId }
  if (ref.type === 'rootParticipant') return { kind: 'participant', id: ref.participantRoleId }
  if (ref.type === 'optionParticipantTrigger') return { kind: 'participant', id: ref.targetParticipantRoleId }
  return null
}

export function canDropFlowNode(node: FlowNode, target: FlowNode) {
  const destination = flowTarget(target)
  if (!node.source || !destination || node.id === target.id) return false
  if (node.source.parentId === destination.id) return false
  if (destination.kind === 'document' || destination.kind === 'participant') return node.kind === 'flag'
  return ['question', 'document', 'participant', 'flag'].includes(node.kind)
}

export type FlowOccurrence = { id: string; node: FlowNode; parentId: string | null }

export function flattenFlow(root: FlowNode, expandedIds: string[] | null): FlowOccurrence[] {
  const rows: FlowOccurrence[] = []
  const visit = (node: FlowNode, parentId: string | null, ancestry: string[]) => {
    // A shared question can occur under several answers. Each drawing needs its own ID.
    const path = [...ancestry, node.id]
    const id = JSON.stringify(path)
    rows.push({ id, node, parentId })
    if (!parentId || expandedIds === null || expandedIds.includes(node.id)) node.children.forEach(child => visit(child, id, path))
  }
  visit(root, null, [])
  return rows
}

export function flowSubtreeIds(rows: FlowOccurrence[], rootId: string) {
  const children = new Map<string, string[]>()
  for (const row of rows) if (row.parentId) children.set(row.parentId, [...(children.get(row.parentId) ?? []), row.id])
  const result = new Set<string>()
  const visit = (id: string) => {
    if (result.has(id)) return
    result.add(id)
    children.get(id)?.forEach(visit)
  }
  visit(rootId)
  return result
}

export function parseFlowMove(value: unknown): FlowMove & { version: string | null; apply: boolean } {
  if (!value || typeof value !== 'object') throw new Error('FLOW_MOVE_INVALID')
  const body = value as Record<string, unknown>
  const source = body.source as Partial<FlowSource> | null
  const target = body.target as Partial<FlowTarget> | null
  const uuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  if (!source || !target || !uuid(source.id) || !uuid(source.parentId) || !uuid(target.id)
    || !['action_question', 'action_document', 'action_participant', 'option_trigger', 'flag_link'].includes(source.kind ?? '')
    || !['action', 'option', 'document', 'participant'].includes(target.kind ?? '')
    || (body.apply !== undefined && typeof body.apply !== 'boolean')
    || (body.apply === true && (typeof body.version !== 'string' || !/^[a-f0-9]{32}$/.test(body.version)))) {
    throw new Error('FLOW_MOVE_INVALID')
  }
  return { source: source as FlowSource, target: target as FlowTarget, apply: body.apply === true,
    version: typeof body.version === 'string' ? body.version : null }
}
